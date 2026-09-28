import { describe, expect, it } from "vitest";
import { TIMING } from "../src/engine/game";
import { buildView } from "../src/engine/view";
import { checkDownTo, givePowers, powerId, rig, seats, startGame, toAct } from "./helpers";

const NONE = new Set<string>();

/** Three-handed game, button (seat 0) first to act, everyone rich in energy. */
function setup(n = 3) {
  const ctx = startGame(n, {}, 21, (g) => {
    g.s.buttonSeat = 0;
  });
  const ids = seats(ctx.game);
  rig(ctx.game, { [ids[0]]: ["As", "Kd"], [ids[1]]: ["7h", "7c"], [ids[2]]: ["2s", "9d"] }, ["Qh", "Jh", "Th", "5c", "4d", "3s", "8c", "6h"]);
  return { ...ctx, ids };
}

describe("X-Ray", () => {
  it("exposes one random hole card of every opponent to the whole table", () => {
    const { game, clock, ids } = setup();
    const [a, b, c] = ids;
    givePowers(game, a, ["xray", "clone"]);
    game.playPower(a, powerId(game, a, "xray"), {}, clock.now);
    expect(game.player(a).energy).toBe(13);
    const spectator = buildView(game, null, clock.now, NONE);
    for (const id of [b, c]) {
      const shown = spectator.players.find((p) => p.id === id)!.hole.filter((h) => h.card);
      expect(shown).toHaveLength(1);
      expect(shown[0].exposed).toBe(true);
    }
    // Everyone already has an exposed card, so a second X-Ray has no target.
    givePowers(game, a, ["xray"]);
    expect(game.powerBlockReason(a, "xray")).toMatch(/No opponent/);
  });
});

describe("EMP", () => {
  it("blocks opponents (not the player) for the rest of the street", () => {
    const { game, clock, ids } = setup();
    const [a, b] = ids;
    givePowers(game, a, ["emp", "intel"]);
    givePowers(game, b, ["intel"]);
    game.playPower(a, powerId(game, a, "emp"), {}, clock.now);
    // The EMP player can keep playing powers.
    expect(game.powerBlockReason(a, "intel")).toBeNull();
    game.act(a, "call", undefined, clock.now);
    expect(toAct(game)).toBe(b);
    expect(game.powerBlockReason(b, "intel")).toMatch(/EMP/);
    expect(() => game.playPower(b, powerId(game, b, "intel"), {}, clock.now)).toThrow(/EMP/);
    const view = buildView(game, b, clock.now, NONE);
    expect(view.hand!.empBy).toBe(a);
    // Next street the EMP wears off.
    checkDownTo({ game, clock, ids, rng: undefined as never }, "flop");
    const firstPostflop = toAct(game);
    givePowers(game, firstPostflop, ["intel"]);
    expect(game.powerBlockReason(firstPostflop, "intel")).toBeNull();
  });
});

describe("Disintegrate", () => {
  it("only targets unshielded cards dealt this street and replaces them from the deck", () => {
    const ctx = setup();
    const { game, clock, ids } = ctx;
    givePowers(game, ids[0], ["disintegrate"]);
    expect(game.powerBlockReason(ids[0], "disintegrate")).toMatch(/No unshielded card/);
    checkDownTo(ctx, "flop");
    expect(game.s.hand!.board.map((b) => b.card)).toEqual(["Qh", "Jh", "Th"]);
    const id = toAct(game);
    givePowers(game, id, ["disintegrate"]);
    const [first] = game.player(id).powers.map((c) => c.id);
    expect(() => game.playPower(id, first, { target: 7 }, clock.now)).toThrow(/Pick an unshielded/);
    game.playPower(id, first, { target: 1 }, clock.now);
    expect(game.s.hand!.board.map((b) => b.card)).toEqual(["Qh", "5c", "Th"]);
    expect(game.s.hand!.muck).toContain("Jh");
    // Turn: flop cards are no longer "this street".
    game.act(id, "check", undefined, clock.now);
    checkDownTo(ctx, "turn");
    const turnActor = toAct(game);
    givePowers(game, turnActor, ["disintegrate"]);
    expect(game.disintegrateTargets()).toEqual([3]);
  });

  it("is blocked by the all-in shield", () => {
    const ctx = startGame(3, {}, 4, (g) => {
      g.s.buttonSeat = 0;
      g.s.players.find((p) => p.seat === 1)!.chips = 300;
    });
    const { game, clock } = ctx;
    const [a, b, c] = seats(game);
    game.act(a, "call", undefined, clock.now);
    game.act(b, "call", undefined, clock.now);
    game.act(c, "check", undefined, clock.now);
    expect(game.s.hand!.street).toBe("flop");
    // b (small blind) acts first after the flop and shoves.
    expect(toAct(game)).toBe(b);
    game.act(b, "raise", 280, clock.now);
    expect(game.s.hand!.board.every((x) => x.locked)).toBe(true);
    givePowers(game, c, ["disintegrate"]);
    expect(game.powerBlockReason(c, "disintegrate")).toMatch(/No unshielded/);
    const view = buildView(game, c, clock.now, NONE);
    expect(view.hand!.board.every((x) => x.locked)).toBe(true);
  });
});

describe("Engineer", () => {
  it("shows three options to everyone and puts the chosen card on top", () => {
    const { game, clock, ids } = setup();
    const [a, b] = ids;
    givePowers(game, a, ["engineer"]);
    game.playPower(a, powerId(game, a, "engineer"), {}, clock.now);
    const other = buildView(game, b, clock.now, NONE);
    expect(other.hand!.engineer!.cards).toEqual(["Qh", "Jh", "Th"]);
    expect(() => game.act(a, "call", undefined, clock.now)).toThrow(/Finish your power/);
    expect(() => game.choose(b, 0, clock.now)).toThrow(/nothing to choose/);
    game.choose(a, 2, clock.now);
    expect(game.s.hand!.deck[0]).toBe("Th");
    expect(game.s.hand!.muck).toEqual(expect.arrayContaining(["Qh", "Jh"]));
    // The chosen card is public knowledge until it leaves the top of the deck.
    expect(buildView(game, b, clock.now, NONE).hand!.knownTop).toBe("Th");
    expect(buildView(game, null, clock.now, NONE).hand!.knownTop).toBe("Th");
  });

  it("defaults to the first option if the clock runs out", () => {
    const { game, clock, ids } = setup();
    givePowers(game, ids[0], ["engineer"]);
    game.playPower(ids[0], powerId(game, ids[0], "engineer"), {}, clock.now);
    expect(game.s.hand!.turnDeadline! - clock.now).toBeGreaterThanOrEqual(TIMING.minChoiceTime);
    clock.now = game.s.hand!.turnDeadline! + 1;
    game.tick(clock.now);
    expect(game.s.hand!.pending).toBeNull();
    expect(game.s.hand!.deck[0]).toBe("Qh");
  });
});

describe("Scanner", () => {
  it("is private, and discards at most one of the top two cards", () => {
    const { game, clock, ids } = setup();
    const [a, b] = ids;
    givePowers(game, a, ["scanner", "scanner"]);
    const [s1, s2] = game.player(a).powers.map((c) => c.id);
    game.playPower(a, s1, {}, clock.now);
    expect(buildView(game, a, clock.now, NONE).me!.scanner).toEqual(["Qh", "Jh"]);
    expect(buildView(game, b, clock.now, NONE).me!.scanner).toBeNull();
    expect(JSON.stringify(buildView(game, b, clock.now, NONE))).not.toContain('"Jh"');
    expect(() => game.choose(a, 2, clock.now)).toThrow();
    game.choose(a, 0, clock.now);
    expect(game.s.hand!.deck.slice(0, 2)).toEqual(["Jh", "Th"]);
    game.playPower(a, s2, {}, clock.now);
    game.choose(a, null, clock.now);
    expect(game.s.hand!.deck.slice(0, 2)).toEqual(["Jh", "Th"]);
    expect(game.s.log.at(-1)!.text).toMatch(/keeps both/);
  });
});

describe("Upgrade and Reload", () => {
  it("Upgrade draws a third card, then one is discarded", () => {
    const { game, clock, ids } = setup();
    const [a] = ids;
    givePowers(game, a, ["upgrade"]);
    game.playPower(a, powerId(game, a, "upgrade"), {}, clock.now);
    expect(game.s.hand!.players[0].hole.map((c) => c.card)).toEqual(["As", "Kd", "Qh"]);
    expect(buildView(game, a, clock.now, NONE).me!.upgrade).toBe(true);
    game.choose(a, 1, clock.now);
    expect(game.s.hand!.players[0].hole.map((c) => c.card)).toEqual(["As", "Qh"]);
    game.act(a, "call", undefined, clock.now);
  });

  it("Reload swaps the chosen hole cards, and new cards are face down", () => {
    const { game, clock, ids } = setup();
    const [a, b] = ids;
    givePowers(game, b, ["xray"]);
    givePowers(game, a, ["reload", "reload"]);
    const [r1, r2] = game.player(a).powers.map((c) => c.id);
    expect(() => game.playPower(a, r1, { indices: [5] }, clock.now)).toThrow(/Pick one or both/);
    game.playPower(a, r1, { indices: [1] }, clock.now);
    expect(game.s.hand!.players[0].hole.map((c) => c.card)).toEqual(["As", "Qh"]);
    game.act(a, "call", undefined, clock.now);
    // b X-Rays a, then a reloads both: the exposed card is replaced face down.
    game.playPower(b, powerId(game, b, "xray"), {}, clock.now);
    expect(game.s.hand!.players[0].hole.some((c) => c.exposed)).toBe(true);
    game.act(b, "call", undefined, clock.now);
    game.act(toAct(game), "check", undefined, clock.now);
    const flopActor = toAct(game);
    if (flopActor !== a) {
      game.act(flopActor, "check", undefined, clock.now);
    }
    while (toAct(game) !== a) game.act(toAct(game), "check", undefined, clock.now);
    game.playPower(a, r2, { indices: [0, 1] }, clock.now);
    expect(game.s.hand!.players[0].hole.every((c) => !c.exposed)).toBe(true);
    expect(buildView(game, b, clock.now, NONE).players.find((p) => p.id === a)!.hole.every((c) => c.card === null)).toBe(true);
  });
});

describe("Intel", () => {
  it("shows only its player the live top card for the rest of the hand", () => {
    const ctx = setup();
    const { game, clock, ids } = ctx;
    const [a, b] = ids;
    givePowers(game, a, ["intel"]);
    game.playPower(a, powerId(game, a, "intel"), {}, clock.now);
    expect(buildView(game, a, clock.now, NONE).me!.intelTop).toBe("Qh");
    expect(buildView(game, b, clock.now, NONE).me!.intelTop).toBeNull();
    checkDownTo(ctx, "flop");
    expect(buildView(game, a, clock.now, NONE).me!.intelTop).toBe("5c");
    expect(buildView(game, null, clock.now, NONE).players.find((p) => p.id === a)!.intel).toBe(true);
  });
});

describe("Clone", () => {
  it("copies the last non-Clone power played this hand", () => {
    const { game, clock, ids } = setup();
    const [a, b] = ids;
    givePowers(game, a, ["clone", "intel"]);
    expect(game.powerBlockReason(a, "clone")).toMatch(/No power/);
    game.playPower(a, powerId(game, a, "intel"), {}, clock.now);
    game.playPower(a, powerId(game, a, "clone"), {}, clock.now);
    expect(game.player(a).powers.map((c) => c.type)).toEqual(["intel"]);
    game.act(a, "call", undefined, clock.now);
    givePowers(game, b, ["clone"]);
    game.playPower(b, powerId(game, b, "clone"), {}, clock.now);
    expect(game.player(b).powers.map((c) => c.type)).toEqual(["intel"]);
  });
});

describe("Deploy", () => {
  it("adds up to two community cards that count for everyone", () => {
    const ctx = setup();
    const { game, clock, ids } = ctx;
    const [a] = ids;
    givePowers(game, a, ["deploy", "deploy", "deploy"]);
    const [d1, d2] = game.player(a).powers.map((c) => c.id);
    game.playPower(a, d1, {}, clock.now);
    expect(game.s.hand!.board).toEqual([{ card: "Qh", street: "preflop", deployed: true, locked: false }]);
    // A card deployed this street can be disintegrated this street.
    expect(game.disintegrateTargets()).toEqual([0]);
    game.playPower(a, d2, {}, clock.now);
    expect(game.powerBlockReason(a, "deploy")).toMatch(/two cards/);
    checkDownTo(ctx, "river");
    while (game.s.hand!.phase === "betting") game.act(toAct(game), "check", undefined, clock.now);
    expect(game.s.hand!.board).toHaveLength(7);
    expect(game.s.hand!.result!.showdown).toBe(true);
  });
});

describe("energy, deck and refills", () => {
  it("rejects powers without enough energy or out of turn", () => {
    const { game, clock, ids } = setup();
    const [a, b] = ids;
    givePowers(game, a, ["engineer"], 4);
    expect(game.powerBlockReason(a, "engineer")).toMatch(/Needs 5 energy/);
    expect(() => game.playPower(a, powerId(game, a, "engineer"), {}, clock.now)).toThrow(/energy/);
    givePowers(game, b, ["intel"]);
    expect(game.powerBlockReason(b, "intel")).toMatch(/turn/);
  });

  it("keeps enough cards in the deck to finish the board", () => {
    const { game, ids } = setup();
    const h = game.s.hand!;
    h.muck.push(...h.deck.splice(6)); // leave 6 cards; 5 are needed for the board
    givePowers(game, ids[0], ["engineer", "reload", "deploy", "upgrade", "scanner"]);
    expect(game.powerBlockReason(ids[0], "engineer")).toMatch(/Not enough cards/);
    expect(game.powerBlockReason(ids[0], "scanner")).toBeNull();
    expect(game.powerBlockReason(ids[0], "deploy")).toBeNull();
    h.muck.push(...h.deck.splice(5));
    expect(game.powerBlockReason(ids[0], "deploy")).toMatch(/Not enough cards/);
    expect(game.powerBlockReason(ids[0], "upgrade")).toMatch(/Not enough cards/);
  });

  it("refills powers to the hand size without duplicates at the next hand", () => {
    const ctx = setup();
    const { game, clock, ids } = ctx;
    const [a] = ids;
    game.player(a).energy = 15;
    const card = game.player(a).powers.find((c) => game.powerBlockReason(a, c.type) === null && c.type !== "reload" && c.type !== "disintegrate")!;
    game.playPower(a, card.id, {}, clock.now);
    if (game.s.hand!.pending) game.choose(a, game.s.hand!.pending.kind === "scanner" ? null : 0, clock.now);
    expect(game.player(a).powers.length).toBeLessThanOrEqual(3);
    while (game.s.hand!.phase === "betting") {
      const id = toAct(game);
      const legal = game.legal(id)!;
      game.act(id, legal.canFold ? "fold" : "check", undefined, clock.now);
    }
    clock.now = game.s.nextHandAt!;
    game.tick(clock.now);
    for (const p of game.s.players) {
      expect(p.powers).toHaveLength(3);
      expect(new Set(p.powers.map((c) => c.type)).size).toBe(3);
    }
  });

  it("uses double-game costs with four or more players", () => {
    const ctx = startGame(4, {}, 2);
    const { game, clock } = ctx;
    const id = toAct(game);
    givePowers(game, id, ["xray", "emp", "deploy", "intel"], 20);
    game.playPower(id, powerId(game, id, "xray"), {}, clock.now);
    expect(game.player(id).energy).toBe(16);
    game.playPower(id, powerId(game, id, "deploy"), {}, clock.now);
    expect(game.player(id).energy).toBe(14);
    game.playPower(id, powerId(game, id, "emp"), {}, clock.now);
    expect(game.player(id).energy).toBe(10);
  });

  it("only offers enabled powers", () => {
    const ctx = startGame(3, { powers: ["xray", "intel", "clone"] }, 8);
    for (const p of ctx.game.s.players) {
      expect(p.powers.map((c) => c.type).sort()).toEqual(["clone", "intel", "xray"]);
    }
  });
});

