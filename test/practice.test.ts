import { describe, expect, it, vi } from "vitest";
import { practiceBot } from "../src/client/practice/bot";
import { LocalTable, type BotPolicy } from "../src/client/practice/localTable";
import { GameError } from "../src/engine/game";
import { seededRng } from "../src/engine/rng";
import { buildView } from "../src/engine/view";
import type { Card } from "../src/shared/cards";
import { T0, config, drive, needsHuman, passive } from "./practice.helpers";

const table = (over: Parameters<typeof config>[0] = {}, policy: BotPolicy = passive) => new LocalTable(config(over), T0, policy);

describe("practice table", () => {
  it("seats the human and the bots, classic or double by table size", () => {
    const t = table();
    const v = t.view(T0);
    expect(v.status).toBe("running");
    expect(v.mode).toBe("classic");
    expect(v.youId).toBe(t.humanId);
    expect(v.players.map((p) => p.name)).toEqual(expect.arrayContaining(["Ann", "Pixel", "Bolt"]));
    // Every seat counts as connected, so no offline markers.
    expect(v.players.every((p) => p.connected)).toBe(true);
    expect(table({ opponents: 4 }).view(T0).mode).toBe("double");
    expect(t.handLimit).toBe(9);
  });

  it("gives the bots other names when the player takes one of theirs", () => {
    for (const name of ["nova", "PIXEL", " Bolt ", "Juno"]) {
      const t = table({ name, opponents: 5 });
      const names = t.game.s.players.map((p) => p.name.toLowerCase());
      expect(new Set(names).size).toBe(6);
    }
    // A name that cleans to nothing still gets a seat.
    expect(table({ name: "   " }).view(T0).players.find((p) => p.isYou)!.name).toBe("Player");
  });

  it("plays hands with the bots and ends after the chosen number of orbits", () => {
    const t = table({ orbits: 2 });
    let maxHand = 0;
    const end = drive(t, T0, { onStep: () => (maxHand = Math.max(maxHand, t.game.s.handNumber)) });
    expect(t.ended).toBe("orbits");
    expect(t.game.s.handNumber).toBe(6);
    expect(maxHand).toBe(6);
    expect(t.game.s.hand!.phase).toBe("done");
    expect(t.nextWakeAt()).toBeNull();
    expect(t.fallbacks).toBe(0);
    // Nothing more happens however long we wait.
    expect(t.advance(end + 3_600_000)).toBe(false);
    expect(t.game.s.handNumber).toBe(6);
    expect(() => t.send({ t: "act", action: "fold" }, end)).toThrow(GameError);

    // Keep playing: the next hand is dealt straight away and the session runs one more orbit.
    t.extend();
    expect(t.ended).toBeNull();
    t.advance(end + 1);
    expect(t.game.s.handNumber).toBe(7);
    drive(t, end + 1);
    expect(t.ended).toBe("orbits");
    expect(t.game.s.handNumber).toBe(9);
  });

  it("ends the session when the human declines a rebuy", () => {
    const t = table();
    // Shove every hand until busted, then walk away.
    drive(t, T0, {
      human: (v) => {
        if (v.me?.rebuy) return { t: "rebuy", accept: false };
        const l = v.me?.legal;
        if (l?.canRaise) return { t: "act", action: "raise", amount: l.maxRaiseTo };
        if (l) return { t: "act", action: l.canCheck ? "check" : "call" };
        return null;
      },
    });
    expect(t.ended).toBe("out");
    expect(t.nextWakeAt()).toBeNull();
  });

  it("times the human out like a real table and keeps going", () => {
    const t = table({ orbits: 5 });
    drive(t, T0, { human: () => null, until: (x) => x.game.s.handNumber >= 4 });
    expect(t.game.s.handNumber).toBeGreaterThanOrEqual(4);
    expect(t.game.s.players.find((p) => p.id === t.humanId)!.away).toBe(true);
  });

  it("rolls back a refused move and leaves the state untouched", () => {
    const t = table();
    const now = drive(t, T0, { until: (x) => needsHuman(x.view(T0)) && !!x.view(T0).me?.legal, human: () => null });
    t.advance(now);
    const before = structuredClone(t.game.s);
    expect(() => t.send({ t: "act", action: "raise", amount: 1 }, now)).toThrow(GameError);
    expect(() => t.send({ t: "power", powerId: "nope" }, now)).toThrow(GameError);
    expect(() => t.send({ t: "join", name: "x" }, now)).toThrow(GameError);
    expect(() => t.send({ t: "start" }, now)).toThrow(GameError);
    expect(t.game.s).toEqual(before);
  });

  it("recovers from a broken bot without stalling", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let calls = 0;
    const broken: BotPolicy = (view, rng, profile) => {
      calls++;
      if (calls % 3 === 0) throw new Error("bot bug");
      if (calls % 3 === 1) return { t: "act", action: "raise", amount: -5 };
      return passive(view, rng, profile);
    };
    const t = table({ orbits: 2 }, broken);
    drive(t, T0);
    expect(t.ended).toBe("orbits");
    expect(t.fallbacks).toBeGreaterThan(0);
    warn.mockRestore();
  });

  it("hands each bot a private copy of its own view and nothing more", () => {
    let checked = 0;
    let t!: LocalTable;
    const spy: BotPolicy = (view, rng, profile) => {
      const s = t.game.s;
      const h = s.hand;
      const botId = view.youId!;
      // Exactly what buildView gives that bot right now...
      expect(view).toEqual(buildView(t.game, botId, view.serverNow, new Set(s.players.map((p) => p.id))));
      // ...with no hidden card anywhere in it.
      if (h && h.phase === "betting") {
        const json = JSON.stringify(view);
        const allowed = new Set<Card>([
          ...(h.players.find((p) => p.id === botId)?.hole.map((c) => c.card) ?? []),
          ...h.players.flatMap((p) => p.hole.filter((c) => c.exposed).map((c) => c.card)),
          ...h.board.map((b) => b.card),
          ...(view.me?.intelTop ? [view.me.intelTop] : []),
          ...(view.me?.scanner ?? []),
          ...(h.pending?.kind === "engineer" ? h.pending.cards : []),
          ...(h.knownTop ? [h.knownTop] : []),
        ]);
        const hidden = [...h.players.flatMap((p) => p.hole.map((c) => c.card)), ...h.deck, ...h.muck].filter((c) => !allowed.has(c));
        for (const c of hidden) expect(json).not.toContain(`"${c}"`);
        checked++;
      }
      // Scribbling on the copy changes nothing real.
      const before = JSON.stringify(s);
      view.players.forEach((p) => (p.chips = 0));
      view.settings.startingChips = 1;
      view.hand?.board.splice(0);
      view.log.splice(0);
      expect(JSON.stringify(s)).toBe(before);
      return practiceBot(structuredClone(buildView(t.game, botId, view.serverNow, new Set(s.players.map((p) => p.id)))), rng, profile);
    };
    t = table({ opponents: 3, orbits: 2 }, spy);
    drive(t, T0, { human: (v) => practiceBot(v, seededRng(1), 0) });
    expect(checked).toBeGreaterThan(20);
    expect(t.fallbacks).toBe(0);
  });

  it("runs each event at its own time, bots before timers on a tie", () => {
    const t = table();
    // Before the first hand, the only thing scheduled is the deal.
    const deal = t.nextWakeAt()!;
    expect(t.advance(deal - 1)).toBe(false);
    expect(t.game.s.handNumber).toBe(0);
    // A single late wake-up still replays every step in order, each with its own timestamp.
    t.advance(deal + 5 * 60_000);
    const times = t.game.s.log.map((l) => l.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times.filter((x) => x > deal)).size).toBeGreaterThan(1);
  });

  it("stands still while the human has paused, and carries on after", () => {
    const t = table();
    let now = drive(t, T0, { until: (x) => x.game.s.handNumber >= 2 && !!x.view(T0).me?.legal, human: () => null });
    t.send({ t: "pause" }, now);
    const seq = t.game.s.logSeq;
    expect(t.nextWakeAt()).toBeNull();
    now += 10 * 60_000;
    expect(t.advance(now)).toBe(false);
    expect(t.game.s.logSeq).toBe(seq);
    t.send({ t: "resume" }, now);
    const left = t.game.s.hand!.turnDeadline! - now;
    expect(left).toBeGreaterThan(0);
    drive(t, now, { until: (x) => x.game.s.handNumber >= 3 });
    expect(t.game.s.handNumber).toBe(3);
  });

  it("replays exactly from a seed, and deals differently with another", () => {
    const logOf = (seed: number) => {
      const t = table({ seed, orbits: 2 }, practiceBot);
      drive(t, T0, { human: (v) => practiceBot(v, seededRng(99), 0) });
      return t.game.s.log.map((l) => `${l.at} ${l.text}`);
    };
    expect(logOf(3)).toEqual(logOf(3));
    expect(logOf(3)).not.toEqual(logOf(4));
  });

  it("keeps score of the human's session from hand results", () => {
    const t = table({ orbits: 3 }, practiceBot);
    const played: Record<string, number> = {};
    let seen = 0;
    drive(t, T0, {
      human: (v) => practiceBot(v, seededRng(5), 0),
      onStep: () => {
        const h = t.game.s.hand;
        if (h?.phase === "done" && h.number > seen) {
          seen = h.number;
          for (const p of h.powerHistory) if (p.playerId === t.humanId) played[p.type] = (played[p.type] ?? 0) + 1;
        }
      },
    });
    expect(t.stats.hands).toBe(9);
    expect(t.stats.powersPlayed).toEqual(played);
    expect(t.stats.handsWon).toBeGreaterThan(0);
    expect(t.stats.handsWon).toBeLessThanOrEqual(9);
    expect(Object.keys(t.stats.powersFaced).length).toBeGreaterThan(0);
  });
});
