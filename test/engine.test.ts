import { describe, expect, it } from "vitest";
import { Game, GameError } from "../src/engine/game";
import { seededRng } from "../src/engine/rng";
import { buildView } from "../src/engine/view";
import { blindLevel, sanitizeSettings } from "../src/shared/settings";
import { checkDownTo, makeGame, nextHand, rig, runTimers, seats, startGame, T0, toAct, totalChips } from "./helpers";

const NONE = new Set<string>();

describe("lobby", () => {
  it("creates a table with the host seated and lets others join by name", () => {
    const { game, ids } = makeGame(3);
    expect(game.s.status).toBe("lobby");
    expect(game.s.players.map((p) => p.name)).toEqual(["P0", "P1", "P2"]);
    expect(game.s.hostId).toBe(ids[0]);
    expect(() => game.join("p1", T0)).toThrow(/taken/);
    expect(() => game.join("   ", T0)).toThrow(/name/);
  });

  it("enforces the seat limit and locks seats once started", () => {
    const { game, ids } = makeGame(2, { maxSeats: 2 });
    expect(() => game.join("Late", T0)).toThrow(/full/);
    const g2 = makeGame(2).game;
    g2.start(g2.s.hostId, T0);
    expect(() => g2.join("Late", T0)).toThrow(/started/);
    expect(() => game.start(ids[1], T0)).toThrow(/host/);
  });

  it("only the host can kick, and only in the lobby", () => {
    const { game, ids } = makeGame(3);
    expect(() => game.kick(ids[1], ids[2], T0)).toThrow(/host/);
    game.kick(ids[0], ids[2], T0);
    expect(game.s.players).toHaveLength(2);
    expect(() => game.leave(ids[0], T0)).toThrow(/host/);
    game.leave(ids[1], T0);
    expect(game.s.players).toHaveLength(1);
    expect(() => game.start(ids[0], T0)).toThrow(/two players/);
  });

  it("sanitizes settings", () => {
    const s = sanitizeSettings({ maxSeats: 99, startingChips: 5, startingSmallBlind: 10, rebuys: -5, powers: ["xray", "bogus"] as never });
    expect(s.maxSeats).toBe(6);
    expect(s.startingChips).toBe(200); // at least 10 big blinds
    expect(s.rebuys).toBe(-1);
    expect(s.powers).toEqual(["xray"]);
  });
});

describe("blinds", () => {
  it("rises on a nice-number ladder", () => {
    const levels = Array.from({ length: 8 }, (_, i) => blindLevel(10, i).sb);
    expect(levels).toEqual([10, 15, 25, 40, 60, 100, 150, 250]);
    expect(blindLevel(10, 3).bb).toBe(80);
  });

  it("levels up on the clock between hands", () => {
    const ctx = startGame(3, { levelMinutes: 2 });
    const { game, clock } = ctx;
    expect(game.s.hand!.bb).toBe(20);
    clock.now += 2 * 60_000 + 1;
    // Finish the current hand by folding around.
    while (game.s.hand!.phase === "betting") {
      const id = toAct(game);
      const legal = game.legal(id)!;
      game.act(id, legal.canFold ? "fold" : "check", undefined, clock.now);
    }
    nextHand(ctx);
    expect(game.s.level).toBe(1);
    expect(game.s.hand!.bb).toBe(30);
  });
});

describe("dealing and betting", () => {
  it("deals the classic game to three players", () => {
    const { game } = startGame(3);
    expect(game.s.mode).toBe("classic");
    for (const p of game.s.players) {
      expect(p.powers).toHaveLength(3);
      expect(new Set(p.powers.map((c) => c.type)).size).toBe(3);
      expect(p.energy).toBe(10);
    }
    const h = game.s.hand!;
    const order = seats(game);
    const btn = order.indexOf(game.s.players.find((p) => p.seat === h.buttonSeat)!.id);
    expect(h.sbSeat).toBe((btn + 1) % 3);
    expect(h.bbSeat).toBe((btn + 2) % 3);
    // Three-handed, the button is first to act preflop.
    expect(game.player(toAct(game)).seat).toBe(h.buttonSeat);
    expect(h.players.every((p) => p.hole.length === 2)).toBe(true);
    expect(totalChips(game)).toBe(3000);
  });

  it("deals the double game to four or more players", () => {
    const { game } = startGame(5);
    expect(game.s.mode).toBe("double");
    for (const p of game.s.players) expect(p.powers).toHaveLength(4);
    const view = buildView(game, game.s.players[0].id, T0, NONE);
    expect(view.rules.handSize).toBe(4);
    expect(view.rules.maxEnergy).toBe(20);
    expect(view.costs.xray).toBe(4);
    expect(view.costs.emp).toBe(4);
    expect(view.costs.deploy).toBe(2);
  });

  it("heads-up: the button posts the small blind and acts first preflop, last after", () => {
    const ctx = startGame(2);
    const { game, clock } = ctx;
    const h = game.s.hand!;
    expect(h.sbSeat).toBe(h.buttonSeat);
    const button = toAct(game);
    expect(game.player(button).seat).toBe(h.buttonSeat);
    game.act(button, "call", undefined, clock.now);
    const bb = toAct(game);
    game.act(bb, "check", undefined, clock.now);
    expect(h.street).toBe("flop");
    expect(toAct(game)).toBe(bb);
  });

  it("folding around gives the blinds to the big blind", () => {
    const { game, clock } = startGame(3);
    const h = game.s.hand!;
    const bbId = game.s.players.find((p) => p.seat === h.bbSeat)!.id;
    game.act(toAct(game), "fold", undefined, clock.now);
    game.act(toAct(game), "fold", undefined, clock.now);
    expect(h.phase).toBe("done");
    expect(game.player(bbId).chips).toBe(1010);
    expect(totalChips(game)).toBe(3000);
  });

  it("enforces minimum raises", () => {
    const { game, clock } = startGame(3);
    const a = toAct(game);
    expect(() => game.act(a, "raise", 30, clock.now)).toThrow(/minimum is 40/);
    game.act(a, "raise", 60, clock.now); // raise by 40
    const b = toAct(game);
    expect(game.legal(b)!.minRaiseTo).toBe(100);
    expect(() => game.act(b, "raise", 90, clock.now)).toThrow(GameError);
    game.act(b, "raise", 100, clock.now);
    expect(game.s.hand!.currentBet).toBe(100);
  });

  it("a short all-in raise does not reopen the betting", () => {
    const ctx = startGame(4, {}, 3, (g) => {
      g.s.buttonSeat = 0;
      // The small blind (seat 1) has 90 in total.
      g.s.players.find((p) => p.seat === 1)!.chips = 90;
    });
    const { game, clock } = ctx;
    const [btn, sb, bb, utg] = seats(game);
    game.act(utg, "raise", 60, clock.now);
    game.act(btn, "call", undefined, clock.now);
    game.act(sb, "raise", 90, clock.now); // all-in, only 30 more than 60: not a full raise
    game.act(bb, "fold", undefined, clock.now);
    // UTG and the button already acted and are only facing an incomplete raise.
    for (const id of [utg, btn]) {
      expect(toAct(game)).toBe(id);
      const legal = game.legal(id)!;
      expect(legal.canRaise).toBe(false);
      expect(legal.callAmount).toBe(30);
      game.act(id, "call", undefined, clock.now);
    }
    expect(game.s.hand!.street).toBe("flop");
  });

  it("a full all-in raise does reopen the betting", () => {
    const ctx = startGame(4, {}, 3, (g) => {
      g.s.buttonSeat = 0;
      g.s.players.find((p) => p.seat === 3)!.chips = 200;
    });
    const { game, clock } = ctx;
    const [, sb, bb, utg] = seats(game);
    game.act(utg, "raise", 60, clock.now);
    const btn = toAct(game);
    game.act(btn, "call", undefined, clock.now);
    game.act(sb, "fold", undefined, clock.now);
    game.act(bb, "call", undefined, clock.now);
    // Flop: bb bets, utg shoves for a full raise, the button may re-raise.
    expect(game.s.hand!.street).toBe("flop");
    game.act(bb, "raise", 20, clock.now);
    game.act(utg, "raise", 140, clock.now);
    expect(game.s.hand!.players.find((p) => p.id === utg)!.allIn).toBe(true);
    expect(game.legal(btn)!.canRaise).toBe(true);
  });

  it("builds side pots and returns uncalled chips", () => {
    const ctx = startGame(3, {}, 5, (g) => {
      g.s.buttonSeat = 0;
      const [a, b, c] = [...g.s.players].sort((x, y) => x.seat - y.seat);
      a.chips = 100;
      b.chips = 300;
      c.chips = 1000;
    });
    const { game, clock } = ctx;
    const [a, b, c] = seats(game);
    rig(game, { [a]: ["As", "Ah"], [b]: ["Ks", "Kh"], [c]: ["2c", "7d"] }, ["3c", "8d", "9s", "Jd", "4h"]);
    game.act(a, "raise", 100, clock.now);
    game.act(b, "raise", 300, clock.now);
    game.act(c, "call", undefined, clock.now);
    expect(game.s.hand!.phase).toBe("runout");
    runTimers(ctx);
    const h = game.s.hand!;
    expect(h.phase).toBe("done");
    expect(h.result!.pots.map((p) => p.amount)).toEqual([300, 400]);
    expect(game.player(a).chips).toBe(300);
    expect(game.player(b).chips).toBe(400);
    expect(game.player(c).chips).toBe(700);
  });

  it("splits a tied pot and gives the odd chip left of the button", () => {
    const ctx = startGame(3, { startingChips: 200 }, 7, (g) => {
      g.s.buttonSeat = 0;
      for (const p of g.s.players) p.chips = 101;
    });
    const { game, clock } = ctx;
    const [a, b, c] = seats(game);
    rig(game, { [a]: ["As", "Kd"], [b]: ["Ac", "Kh"], [c]: ["2c", "3d"] }, ["7s", "8h", "9c", "Jd", "4h"]);
    game.act(a, "raise", 101, clock.now);
    game.act(b, "call", undefined, clock.now);
    game.act(c, "call", undefined, clock.now);
    runTimers(ctx);
    expect(game.player(b).chips).toBe(152);
    expect(game.player(a).chips).toBe(151);
    expect(game.player(c).chips).toBe(0);
  });

  it("returns an uncalled all-in overbet", () => {
    const ctx = startGame(2, {}, 9, (g) => {
      g.s.buttonSeat = 0;
      g.s.players.find((p) => p.seat === 1)!.chips = 200;
    });
    const { game, clock } = ctx;
    const [btn, bb] = seats(game);
    game.act(btn, "raise", 1000, clock.now);
    game.act(bb, "call", undefined, clock.now);
    // Button's extra 800 was never called.
    expect(game.player(btn).chips).toBe(800);
    expect(game.s.hand!.players.reduce((s, p) => s + p.totalBet, 0)).toBe(400);
  });

  it("times out to check or fold and marks the player away", () => {
    const ctx = startGame(3);
    const { game, clock } = ctx;
    const first = toAct(game);
    clock.now = game.s.hand!.turnDeadline! + 1;
    game.tick(clock.now);
    expect(game.s.hand!.players.find((p) => p.id === first)!.folded).toBe(true);
    expect(game.player(first).away).toBe(true);
    game.setBack(first, clock.now);
    expect(game.player(first).away).toBe(false);
  });

  it("pausing freezes the clock and blocks play", () => {
    const { game, clock, ids } = startGame(3);
    const deadline = game.s.hand!.turnDeadline!;
    game.pause(ids[0], clock.now);
    expect(() => game.act(toAct(game), "call", undefined, clock.now)).toThrow(/paused/);
    clock.now += 60_000;
    expect(game.tick(clock.now)).toBe(false);
    game.resume(ids[0], clock.now);
    expect(game.s.hand!.turnDeadline).toBe(deadline + 60_000);
  });
});

describe("tournament flow", () => {
  function bustHeadsUp(ctx: ReturnType<typeof startGame>, loser: string, winner: string) {
    const { game, clock } = ctx;
    rig(game, { [loser]: ["2c", "7d"], [winner]: ["As", "Ah"] }, ["3c", "8d", "9s", "Jd", "4h"]);
    const first = toAct(game);
    game.act(first, "raise", game.legal(first)!.maxRaiseTo, clock.now);
    game.act(toAct(game), "call", undefined, clock.now);
    runTimers(ctx);
  }

  it("offers a rebuy, then eliminates and crowns a winner", () => {
    const ctx = startGame(2, { rebuys: 1 });
    const { game, clock } = ctx;
    const [x, y] = seats(game);
    bustHeadsUp(ctx, x, y);
    expect(game.player(x).status).toBe("busted");
    const view = buildView(game, x, clock.now, NONE);
    expect(view.me!.rebuy!.remaining).toBe(1);
    game.rebuy(x, true, clock.now);
    expect(game.player(x).chips).toBe(1000);
    nextHand(ctx);
    expect(game.s.hand!.number).toBe(2);
    bustHeadsUp(ctx, x, y);
    // No rebuys left: straight out.
    expect(game.player(x).status).toBe("out");
    expect(game.player(x).place).toBe(2);
    expect(game.s.status).toBe("finished");
    expect(game.s.winnerId).toBe(y);
    expect(totalChips(game)).toBe(3000);
  });

  it("eliminates a player who lets the rebuy clock run out", () => {
    const ctx = startGame(2, { rebuys: 2 });
    const { game, clock } = ctx;
    const [x, y] = seats(game);
    bustHeadsUp(ctx, x, y);
    clock.now = game.player(x).rebuyDeadline! + 1;
    game.tick(clock.now);
    expect(game.player(x).status).toBe("out");
    expect(game.s.winnerId).toBe(y);
  });

  it("orders simultaneous eliminations by starting stack", () => {
    const ctx = startGame(3, {}, 11, (g) => {
      g.s.buttonSeat = 0;
      const [a, b] = [...g.s.players].sort((x, y) => x.seat - y.seat);
      a.chips = 100;
      b.chips = 300;
    });
    const { game, clock } = ctx;
    const [a, b, c] = seats(game);
    rig(game, { [a]: ["2c", "7d"], [b]: ["3c", "8h"], [c]: ["As", "Ah"] }, ["4c", "9d", "Ts", "Jd", "5h"]);
    game.act(a, "raise", 100, clock.now);
    game.act(b, "raise", 300, clock.now);
    game.act(c, "call", undefined, clock.now);
    runTimers(ctx);
    expect(game.player(a).place).toBe(3);
    expect(game.player(b).place).toBe(2);
    expect(game.player(c).place).toBe(1);
    expect(game.s.status).toBe("finished");
  });

  it("rematch returns everyone to the lobby", () => {
    const ctx = startGame(2);
    const { game, clock } = ctx;
    const [x, y] = seats(game);
    bustHeadsUp(ctx, x, y);
    expect(game.s.status).toBe("finished");
    game.rematch(game.s.hostId, clock.now);
    expect(game.s.status).toBe("lobby");
    expect(game.s.players.every((p) => p.status === "waiting")).toBe(true);
    game.start(game.s.hostId, clock.now);
    expect(game.s.status).toBe("running");
  });

  it("regenerates energy each hand up to the cap and tops powers back up", () => {
    const ctx = startGame(3);
    const { game, clock } = ctx;
    const energies: number[] = [];
    for (let i = 0; i < 5; i++) {
      energies.push(game.s.players[0].energy);
      while (game.s.hand!.phase === "betting") {
        const id = toAct(game);
        const legal = game.legal(id)!;
        game.act(id, legal.canFold ? "fold" : "check", undefined, clock.now);
      }
      nextHand(ctx);
    }
    expect(energies).toEqual([10, 12, 14, 15, 15]);
  });
});

describe("views", () => {
  it("hides other players' hole cards and the deck", () => {
    const { game } = startGame(3);
    const [a, b] = seats(game);
    const view = buildView(game, a, T0, NONE);
    const me = view.players.find((p) => p.id === a)!;
    const other = view.players.find((p) => p.id === b)!;
    expect(me.hole.every((c) => c.card)).toBe(true);
    expect(other.hole.every((c) => c.card === null)).toBe(true);
    const spectator = buildView(game, null, T0, NONE);
    expect(spectator.me).toBeNull();
    expect(spectator.players.every((p) => p.hole.every((c) => c.card === null))).toBe(true);
    const json = JSON.stringify(spectator);
    expect(json).not.toContain(game.s.players[0].token);
    for (const card of game.s.hand!.deck.slice(0, 5)) expect(json).not.toContain(`"${card}"`);
  });

  it("reveals live hands at showdown only", () => {
    const ctx = startGame(2);
    const { game, clock } = ctx;
    checkDownTo(ctx, "river");
    const [a, b] = seats(game);
    game.act(toAct(game), "check", undefined, clock.now);
    game.act(toAct(game), "check", undefined, clock.now);
    expect(game.s.hand!.phase).toBe("done");
    const view = buildView(game, null, clock.now, NONE);
    for (const id of [a, b]) {
      const p = view.players.find((x) => x.id === id)!;
      expect(p.hole.every((c) => c.card !== null)).toBe(true);
      expect(p.handLabel).toBeTruthy();
    }
  });
});

describe("randomised play", () => {
  it("keeps chips and cards consistent across many random games with powers", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const rng = seededRng(seed * 7919);
      const n = 2 + (seed % 5);
      const ctx = startGame(n, { rebuys: seed % 3, startingChips: 400, levelMinutes: 3 }, seed);
      const { game, clock } = ctx;
      let buyIns = n * 400;
      for (let step = 0; step < 4000 && game.s.status === "running"; step++) {
        const h = game.s.hand;
        // Busted players decide on rebuys.
        for (const p of game.s.players) {
          if (p.status === "busted" && !p.rebuyDeclined) {
            if (rng.int(2) === 0) {
              game.rebuy(p.id, true, clock.now);
              buyIns += 400;
            } else game.rebuy(p.id, false, clock.now);
          }
        }
        if (h && h.phase === "betting" && h.toAct) {
          const id = h.toAct;
          if (h.pending) {
            const k = h.pending.kind;
            const idx = k === "scanner" ? [null, 0, 1][rng.int(3)] : rng.int(k === "upgrade" ? 3 : 3);
            game.choose(id, idx, clock.now);
          } else {
            const playable = game.player(id).powers.filter((c) => game.powerBlockReason(id, c.type) === null);
            if (playable.length && rng.int(3) === 0) {
              const card = playable[rng.int(playable.length)];
              const targets = game.disintegrateTargets();
              game.playPower(
                id,
                card.id,
                { target: targets[rng.int(Math.max(1, targets.length))], indices: rng.int(2) ? [0] : [0, 1] },
                clock.now,
              );
            } else {
              const legal = game.legal(id)!;
              const r = rng.int(10);
              if (r < 2 && legal.canFold) game.act(id, "fold", undefined, clock.now);
              else if (r < 4 && legal.canRaise) {
                const span = legal.maxRaiseTo - legal.minRaiseTo;
                game.act(id, "raise", legal.minRaiseTo + rng.int(span + 1), clock.now);
              } else game.act(id, legal.canCheck ? "check" : "call", undefined, clock.now);
            }
          }
          if (game.s.hand && game.s.hand.phase !== "done") expect(game.allCards().length).toBe(52);
          if (game.s.hand) expect(new Set(game.allCards()).size).toBe(game.allCards().length);
        } else {
          const next = game.nextWakeAt();
          if (next === null) break;
          clock.now = Math.max(clock.now, next);
          game.tick(clock.now);
        }
        expect(totalChips(game)).toBe(buyIns);
        for (const p of game.s.players) {
          expect(p.chips).toBeGreaterThanOrEqual(0);
          expect(p.energy).toBeGreaterThanOrEqual(0);
          expect(p.energy).toBeLessThanOrEqual(20);
        }
      }
      expect(game.s.status).toBe("finished");
      const places = game.s.players.map((p) => p.place).sort();
      expect(places).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    }
  });
});

describe("persistence", () => {
  it("survives a JSON round trip mid-hand", () => {
    const { game, clock } = startGame(3);
    const copy = new Game(JSON.parse(JSON.stringify(game.s)), seededRng(1));
    const id = toAct(copy);
    copy.act(id, "call", undefined, clock.now);
    expect(copy.s.hand!.toAct).not.toBe(id);
  });
});


describe("auto pause", () => {
  it("pauses an abandoned game and lets any player resume", () => {
    const { game, clock, ids } = startGame(3);
    const deadline = game.s.hand!.turnDeadline!;
    game.autoPause(clock.now);
    expect(game.s.paused).toBe(true);
    expect(game.nextWakeAt()).toBeNull();
    clock.now += 10_000;
    const notHost = ids.find((id) => id !== game.s.hostId)!;
    game.resume(notHost, clock.now);
    expect(game.s.paused).toBe(false);
    expect(game.s.hand!.turnDeadline).toBe(deadline + 10_000);
    // A host pause can only be lifted by the host.
    game.pause(game.s.hostId, clock.now);
    expect(() => game.resume(notHost, clock.now)).toThrow(/host/);
  });
});

describe("review regressions", () => {
  it("several short all-ins that add up to a full raise reopen the betting (TDA 47)", () => {
    // Blinds 10/20, button seat 0 -> SB 1, BB 2, UTG 3, MP 4, CO 5.
    const ctx = startGame(6, {}, 3, (g) => {
      g.s.buttonSeat = 0;
      g.s.players.find((p) => p.seat === 5)!.chips = 150;
      g.s.players.find((p) => p.seat === 0)!.chips = 200;
    });
    const { game, clock } = ctx;
    const [btn, sb, bb, utg, mp, co] = seats(game);
    game.act(utg, "raise", 100, clock.now); // full raise of 80
    game.act(mp, "call", undefined, clock.now); // still has chips behind
    game.act(co, "raise", 150, clock.now); // all-in, +50: not a full raise on its own
    game.act(btn, "raise", 200, clock.now); // all-in, +50: together +100 over the 100 bet
    game.act(sb, "fold", undefined, clock.now);
    game.act(bb, "fold", undefined, clock.now);
    for (const id of [utg, mp]) {
      expect(toAct(game)).toBe(id);
      expect(game.legal(id)!.canRaise).toBe(true);
      game.act(id, "call", undefined, clock.now);
    }
  });

  it("a single short all-in still doesn't reopen the betting", () => {
    const ctx = startGame(6, {}, 3, (g) => {
      g.s.buttonSeat = 0;
      g.s.players.find((p) => p.seat === 5)!.chips = 150;
    });
    const { game, clock } = ctx;
    const [btn, sb, bb, utg, mp, co] = seats(game);
    game.act(utg, "raise", 100, clock.now);
    game.act(mp, "call", undefined, clock.now);
    game.act(co, "raise", 150, clock.now); // +50 < 80
    game.act(btn, "fold", undefined, clock.now);
    game.act(sb, "fold", undefined, clock.now);
    game.act(bb, "fold", undefined, clock.now);
    expect(game.legal(utg)!.canRaise).toBe(false);
  });

  it("any seated player can resume a host pause once the host has gone", () => {
    const { game, clock, ids } = startGame(3);
    game.pause(game.s.hostId, clock.now);
    const other = ids.find((id) => id !== game.s.hostId)!;
    expect(() => game.resume(other, clock.now)).toThrow(/host/);
    game.resume(other, clock.now, { hostAbsent: true });
    expect(game.s.paused).toBe(false);
  });

  it("keeps the 10 big blind minimum even at the chip cap", () => {
    const s = sanitizeSettings({ startingSmallBlind: 1_000_000, startingChips: 99_000_000 });
    expect(s.startingSmallBlind).toBe(500_000);
    expect(s.startingChips).toBeGreaterThanOrEqual(s.startingSmallBlind * 20);
  });
});
