import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { newBotMemory, pickOpponents, practiceBot } from "../src/client/practice/bot";
import { LocalTable, type BotMove } from "../src/client/practice/localTable";
import { preflopEquity, preflopPercentile } from "../src/client/practice/preflop";
import type { Game } from "../src/engine/game";
import { seededRng } from "../src/engine/rng";
import { buildView } from "../src/engine/view";
import type { Card } from "../src/shared/cards";
import { givePowers, powerId, rig, seats, startGame, toAct, type Ctx } from "./helpers";
import { T0, config, drive } from "./practice.helpers";

const NOVA = 3;

/** What the practice bot does in this seat right now, from that seat's own view. */
function decide(game: Game, id: string, now: number, seed = 1, memory = newBotMemory(), profile = NOVA): BotMove | null {
  const view = structuredClone(buildView(game, id, now, new Set(game.s.players.map((p) => p.id))));
  return practiceBot(view, seededRng(seed), profile, memory);
}

/** Everyone checks or calls until `id` is to act on `street`. */
function untilTurn(ctx: Ctx, id: string, street: string): void {
  const { game, clock } = ctx;
  for (let guard = 0; guard < 60; guard++) {
    const h = game.s.hand!;
    if (h.street === street && h.toAct === id) return;
    const who = toAct(game);
    const legal = game.legal(who)!;
    game.act(who, legal.canCheck ? "check" : "call", undefined, clock.now);
  }
  throw new Error(`never reached ${id} on the ${street}`);
}

/** A practice session where the human seat is played by the bot policy too, timing every decision. */
function autoplay(opponents: number, seed: number, orbits: number) {
  const times: number[] = [];
  const foldsWhenFree: BotMove[] = [];
  const t = new LocalTable(config({ opponents, seed, orbits }), T0, (view, rng, profile, memory) => {
    const t0 = performance.now();
    const move = practiceBot(view, rng, profile, memory);
    times.push(performance.now() - t0);
    if (move?.t === "act" && move.action === "fold" && view.me?.legal?.canCheck) foldsWhenFree.push(move);
    return move;
  });
  const rng = seededRng(seed + 1000);
  const memory = newBotMemory();
  drive(t, T0, { human: (v) => practiceBot(v, rng, 4, memory) });
  return { t, times, foldsWhenFree };
}

describe("practice bots", () => {
  it("never make an illegal move, and never fold when they could check", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const powersSeen = new Set<string>();
    for (const [opponents, seed] of [[1, 1], [2, 2], [2, 3], [3, 4], [5, 5]] as const) {
      const { t, foldsWhenFree } = autoplay(opponents, seed, 5);
      expect(t.fallbacks).toBe(0);
      expect(foldsWhenFree).toEqual([]);
      expect(t.ended).toBe("orbits");
      for (const type of [...Object.keys(t.stats.powersPlayed), ...Object.keys(t.stats.powersFaced)]) powersSeen.add(type);
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    // Bots actually use a wide range of powers.
    expect(powersSeen.size).toBeGreaterThanOrEqual(9);
  }, 120_000);

  it("decide quickly enough for a phone", () => {
    const { times } = autoplay(5, 9, 2);
    times.sort((a, b) => a - b);
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(20);
  }, 60_000);

  it("make the same decision from the same view and seed", () => {
    const ctx = startGame(3, {}, 4);
    const id = toAct(ctx.game);
    expect(decide(ctx.game, id, ctx.clock.now, 9)).toEqual(decide(ctx.game, id, ctx.clock.now, 9));
  });

  it("never pick a name the player already has", () => {
    expect(pickOpponents("pixel", 5).map((b) => b.name)).not.toContain("Pixel");
    expect(new Set(pickOpponents("Bolt", 5).map((b) => b.name.toLowerCase())).size).toBe(5);
  });
});

describe("practice bot decisions", () => {
  it("know a good starting hand from a bad one", () => {
    expect(preflopEquity("As", "Ah", 1)).toBeCloseTo(0.85, 1);
    expect(preflopEquity("7c", "2d", 1)).toBeCloseTo(0.35, 1);
    expect(preflopPercentile("As", "Ah", 2)).toBeLessThan(0.01);
    expect(preflopPercentile("7c", "2d", 2)).toBeGreaterThan(0.9);
  });

  it("raise aces heads-up and fold junk to a raise", () => {
    let raises = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = startGame(2, {}, seed);
      const id = toAct(ctx.game);
      rig(ctx.game, { [id]: ["As", "Ah"] });
      givePowers(ctx.game, id, []);
      const move = decide(ctx.game, id, ctx.clock.now, seed);
      if (move?.t === "act" && move.action === "raise") raises++;
    }
    expect(raises).toBeGreaterThanOrEqual(17);

    let folds = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = startGame(6, {}, seed);
      const opener = toAct(ctx.game);
      ctx.game.act(opener, "raise", 60, ctx.clock.now);
      const id = toAct(ctx.game);
      rig(ctx.game, { [id]: ["7c", "2d"] });
      givePowers(ctx.game, id, []);
      const move = decide(ctx.game, id, ctx.clock.now, seed);
      if (move?.t === "act" && move.action === "fold") folds++;
    }
    expect(folds).toBe(20);
  });

  it("bet the nuts on the river", () => {
    let bets = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const ctx = startGame(3, {}, seed);
      const ids = seats(ctx.game);
      const hero = ids[1];
      rig(ctx.game, { [hero]: ["As", "Ks"], [ids[0]]: ["7h", "7c"], [ids[2]]: ["9d", "8d"] }, ["Qs", "Js", "Ts", "5c", "4d"]);
      givePowers(ctx.game, hero, []);
      untilTurn(ctx, hero, "river");
      const move = decide(ctx.game, hero, ctx.clock.now, seed);
      if (move?.t === "act" && move.action === "raise") bets++;
    }
    expect(bets).toBeGreaterThanOrEqual(18);
  });

  /** Hero holds the ace-king of hearts on a two-heart flop; `top` follows the flop. */
  function flushDraw(street: "flop" | "turn", top: Card[], powers: Parameters<typeof givePowers>[2]) {
    const ctx = startGame(2, {}, 3);
    const ids = seats(ctx.game);
    const hero = toAct(ctx.game);
    const villain = ids.find((x) => x !== hero)!;
    const board: Card[] = street === "flop" ? ["2h", "7h", "9c"] : ["2h", "7h", "9c", "5d"];
    rig(ctx.game, { [hero]: ["Ah", "Kh"], [villain]: ["9s", "9d"] }, [...board, ...top]);
    givePowers(ctx.game, hero, powers);
    untilTurn(ctx, hero, street);
    return { ...ctx, hero };
  }

  it("Engineer: choose the card that makes the flush", () => {
    const { game, clock, hero } = flushDraw("flop", ["3c", "Qh", "8d"], ["engineer"]);
    game.playPower(hero, powerId(game, hero, "engineer"), {}, clock.now);
    expect(decide(game, hero, clock.now)).toEqual({ t: "choose", index: 1 });
  });

  it("Scanner: throw away a blank to bring the flush card forward, and remember what's coming", () => {
    const { game, clock, hero } = flushDraw("turn", ["3c", "Qh"], ["scanner"]);
    game.playPower(hero, powerId(game, hero, "scanner"), {}, clock.now);
    const memory = newBotMemory();
    expect(decide(game, hero, clock.now, 1, memory)).toEqual({ t: "choose", index: 0 });
    expect(memory.prefix).toEqual(["Qh"]);
  });

  it("Scanner: keep both when the flush card is already next", () => {
    const { game, clock, hero } = flushDraw("turn", ["Qh", "3c"], ["scanner"]);
    game.playPower(hero, powerId(game, hero, "scanner"), {}, clock.now);
    const memory = newBotMemory();
    expect(decide(game, hero, clock.now, 1, memory)).toEqual({ t: "choose", index: null });
    expect(memory.prefix).toEqual(["Qh", "3c"]);
  });

  it("Upgrade: keep the card that helps", () => {
    const ctx = startGame(2, {}, 5);
    const hero = toAct(ctx.game);
    const villain = seats(ctx.game).find((x) => x !== hero)!;
    rig(ctx.game, { [hero]: ["7c", "2d"], [villain]: ["Kd", "Qd"] }, ["As", "Ks", "5h", "Ad"]);
    givePowers(ctx.game, hero, ["upgrade"]);
    untilTurn(ctx, hero, "flop");
    ctx.game.playPower(hero, powerId(ctx.game, hero, "upgrade"), {}, ctx.clock.now);
    const move = decide(ctx.game, hero, ctx.clock.now);
    expect(move?.t).toBe("choose");
    // The drawn ace (index 2) makes trips: throw away a small card instead.
    expect((move as { index: number }).index).not.toBe(2);
  });

  it("only use what they're allowed to see", () => {
    // The bot's code can't reach the engine's hidden state: it's handed a view, nothing else.
    for (const file of ["bot.ts", "worlds.ts", "preflop.ts", "coach.ts"]) {
      const src = readFileSync(new URL(`../src/client/practice/${file}`, import.meta.url), "utf8");
      expect(src, file).not.toMatch(/engine\/(game|state|view|dispatch)"/);
      expect(src, file).not.toMatch(/Math\.random|Date\.now/);
    }
    for (const file of ["localTable.ts", "runner.ts", "clock.ts"]) {
      const src = readFileSync(new URL(`../src/client/practice/${file}`, import.meta.url), "utf8");
      expect(src, file).not.toMatch(/Math\.random/);
    }
  });
});
