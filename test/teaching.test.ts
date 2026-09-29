import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adviceText } from "../src/client/practice/advice";
import type { Thought } from "../src/client/practice/bot";
import { Curriculum } from "../src/client/practice/curriculum";
import { LocalTable } from "../src/client/practice/localTable";
import { GOOD_WHEN, nextTip, type TipContext } from "../src/client/practice/tips";
import type { Player } from "../src/engine/state";
import { buildView } from "../src/engine/view";
import type { TableView } from "../src/shared/protocol";
import { givePowers, powerId, rig, seats, startGame, toAct } from "./helpers";
import { T0, config, drive, passive } from "./practice.helpers";

const ctx = (over: Partial<TipContext> = {}): TipContext => ({ handLimit: 9, selected: null, tried: 0, ...over });
const ALL = (ids: string[]) => new Set(ids);

describe("coach tips", () => {
  it("welcome the player first, then explain their first turn, each only once", () => {
    const t = new LocalTable(config(), T0, passive);
    const first = t.view(T0);
    const welcome = nextTip(first, null, new Set(), ctx())!;
    expect(welcome.id).toBe("welcome");
    expect(welcome.hold).toBe("turn");
    expect(welcome.text).toMatch(/You vs 2 bots/);
    const now = drive(t, T0, { until: (x) => !!x.view(T0).me?.legal, human: () => null });
    const turn = t.view(now);
    const tip = nextTip(turn, first, new Set(["welcome"]), ctx())!;
    expect(tip.id).toBe("first-turn");
    expect(tip.target).toBe("actions");
    expect(nextTip(turn, first, new Set(["welcome", "first-turn", "facing-bet", "energy-full"]), ctx())?.id).not.toBe("first-turn");
  });

  it("explain a power the first time the player picks it up", () => {
    const t = new LocalTable(config(), T0, passive);
    const now = drive(t, T0, { until: (x) => !!x.view(T0).me?.legal, human: () => null });
    const tip = nextTip(t.view(now), null, new Set(["welcome", "first-turn"]), ctx({ selected: "deploy" }))!;
    expect(tip.id).toBe("select-deploy");
    expect(tip.text).toMatch(/^Deploy: .*Good when you need one more card/);
  });

  it("name the cards when a bot plays a power", () => {
    const g = startGame(3, {}, 21, (game) => (game.s.buttonSeat = 0));
    const ids = seats(g.game);
    rig(g.game, { [ids[0]]: ["As", "Kd"] }, ["Qh", "Jh", "Th", "5c", "4d"]);
    const before = buildView(g.game, ids[1], g.clock.now, ALL(ids));
    // Everyone calls to the flop, then the first player destroys a flop card.
    while (g.game.s.hand!.street === "preflop") {
      const id = toAct(g.game);
      const l = g.game.legal(id)!;
      g.game.act(id, l.canCheck ? "check" : "call", undefined, g.clock.now);
    }
    const actor = toAct(g.game);
    givePowers(g.game, actor, ["disintegrate"]);
    g.game.playPower(actor, powerId(g.game, actor, "disintegrate"), { target: 0 }, g.clock.now);
    const viewer = ids.find((x) => x !== actor)!;
    const after = buildView(g.game, viewer, g.clock.now, ALL(ids));
    const seen = new Set(["welcome", "first-turn", "facing-bet", "flop", "energy", "exposed"]);
    const tip = nextTip(after, before, seen, ctx())!;
    expect(tip.id).toBe("bot-disintegrate");
    expect(tip.text).toMatch(/destroyed the Q♥, and the 5♣ replaced it/);
    expect(tip.hold).toBe("brief");
  });

  it("stay quiet while a choice or rebuy dialog is up, and stop holding the clock after a few hands", () => {
    const t = new LocalTable(config(), T0, passive);
    const v = t.view(T0);
    expect(nextTip({ ...v, me: { ...v.me!, rebuy: { deadline: T0, remaining: -1 } } }, null, new Set(), ctx())).toBeNull();
    expect(nextTip({ ...v, paused: true }, null, new Set(), ctx())).toBeNull();
    const late: TableView = { ...v, handNumber: 5 };
    expect(nextTip(late, null, new Set(), ctx())!.hold).toBe("none");
    // First-time power tips still hold late in the session.
    const withTurn = drive(t, T0, { until: (x) => !!x.view(T0).me?.legal, human: () => null });
    const turn = { ...t.view(withTurn), handNumber: 5 };
    expect(nextTip(turn, null, new Set(["welcome"]), ctx({ selected: "xray" }))!.hold).toBe("turn");
  });

  it("use this table's costs and energy rules", () => {
    const t = new LocalTable(config({ opponents: 4 }), T0, passive);
    const v = t.view(T0);
    const tip = nextTip(v, null, new Set(["welcome"]), ctx())!;
    expect(tip.id).toBe("double");
    expect(tip.text).toContain(`${v.rules.handSize} powers each, up to ${v.rules.maxEnergy}⚡`);
  });
});

describe("hint wording", () => {
  const view = () => {
    const t = new LocalTable(config(), T0, passive);
    const now = drive(t, T0, { until: (x) => !!x.view(T0).me?.legal, human: () => null });
    return t.view(now);
  };
  const thought = (over: Partial<Thought>): Thought => ({ move: { t: "act", action: "check" }, power: null, equity: 0.5, need: 0, percentile: null, ...over });

  it("explains folds and calls with the numbers", () => {
    const v = view();
    const l = v.me!.legal!;
    expect(adviceText(thought({ move: { t: "act", action: "fold" }, equity: 0.19, need: 0.26 }), v)).toMatch(/about 19% .* needs 26%, so folding is fine/);
    expect(adviceText(thought({ move: { t: "act", action: "call" }, equity: 0.4, need: 0.25 }), v)).toContain(`to call ${l.callAmount.toLocaleString("en-GB")}`);
  });

  it("describes a starting hand and suggests powers with this table's cost", () => {
    const v = view();
    expect(adviceText(thought({ move: { t: "act", action: "raise", amount: 50 }, percentile: 0.04 }), v)).toMatch(/top 4% of starting hands\. From your seat, raising to 50/);
    const reload = v.me!.powers.find((p) => p.type === "reload")!;
    const text = adviceText(thought({ move: { t: "power", powerId: reload.id, indices: [0, 1] }, power: "reload" }), v);
    expect(text).toBe(`Try Reload (${v.costs.reload}⚡): swap both of your cards for fresh ones. Then decide your bet.`);
  });
});

describe("power curriculum", () => {
  const player = (id: string, types: string[] = []) => ({ id, powers: types.map((type, i) => ({ id: `${i}`, type })) }) as unknown as Player;

  it("deals the starters first, then powers the player hasn't held, and ignores everyone else", () => {
    const c = new Curriculum("classic");
    c.humanId = "me";
    const all = ["xray", "upgrade", "scanner", "reload", "intel", "engineer", "emp", "disintegrate", "clone", "deploy"] as const;
    expect(c.pickPower(player("bot"), all, 0)).toBeUndefined();
    expect(c.pickPower(player("me"), all, 0)).toBe("xray");
    expect(c.pickPower(player("me", ["xray"]), all, 0)).toBe("reload");
    expect(c.pickPower(player("me", ["xray", "reload"]), all, 0)).toBe("deploy");
    // Later hands: the next power in the order that the player has never held.
    expect(c.pickPower(player("me", ["reload", "deploy"]), all, 2)).toBe("upgrade");
    expect(c.pickPower(player("me", ["reload", "deploy"]), all.filter((t) => t !== "upgrade"), 3)).toBe("scanner");
    const d = new Curriculum("double");
    d.humanId = "me";
    expect(d.pickPower(player("me", ["xray", "reload", "deploy"]), all, 0)).toBe("intel");
  });

  it("falls back to normal dealing once every power has been met", () => {
    const c = new Curriculum("classic");
    c.humanId = "me";
    const all = ["xray", "upgrade", "scanner", "reload", "intel", "engineer", "emp", "disintegrate", "clone", "deploy"] as const;
    let held: string[] = [];
    for (let i = 0; i < 10; i++) {
      const t = c.pickPower(player("me", held), all, i === 0 ? 0 : i);
      held = t ? [t] : held;
    }
    expect(c.pickPower(player("me", []), all, 20)).toBeUndefined();
  });
});

describe("repository hygiene", () => {
  it("has no two modules that differ only by case (they collide on macOS and Windows)", () => {
    const walk = (dir: string): void => {
      const names = readdirSync(dir);
      const seen = new Map<string, string>();
      for (const name of names) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        const key = name.replace(/\.(tsx?|css)$/, "").toLowerCase();
        expect(seen.get(key), `${full} collides with ${seen.get(key)}`).toBeUndefined();
        seen.set(key, full);
      }
    };
    walk(new URL("../src", import.meta.url).pathname);
  });
});

describe("coach tips, after review", () => {
  it("say the big blind was posted, not bet, and name the real bettor otherwise", () => {
    const g = startGame(3, {}, 21, (game) => (game.s.buttonSeat = 0));
    const ids = seats(g.game);
    const first = toAct(g.game);
    const v = buildView(g.game, first, g.clock.now, ALL(ids));
    const tip = nextTip(v, null, new Set(["welcome", "first-turn"]), ctx())!;
    expect(tip.id).toBe("facing-bet");
    expect(tip.text).toMatch(/posted the big blind/);
    g.game.act(first, "raise", 60, g.clock.now);
    const next = toAct(g.game);
    const v2 = buildView(g.game, next, g.clock.now, ALL(ids));
    const raiser = g.game.player(first).name;
    expect(nextTip(v2, null, new Set(["welcome", "first-turn"]), ctx())!.text).toMatch(new RegExp(`^${raiser} bet`));
  });

  it("only mention a power the player still holds, ready to play", () => {
    const t = new LocalTable(config(), T0, passive);
    const now = drive(t, T0, { until: (x) => !!x.view(T0).me?.legal, human: () => null });
    expect(nextTip(t.view(now), null, new Set(["welcome", "first-turn", "facing-bet"]), ctx({ selected: "engineer" }))?.id).not.toBe("select-engineer");
  });

  it("teach that a flush takes five cards", () => {
    expect(GOOD_WHEN.deploy).toMatch(/fifth heart/);
    expect(GOOD_WHEN.engineer).toMatch(/fifth heart/);
  });
});
