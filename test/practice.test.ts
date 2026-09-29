import { describe, expect, it } from "vitest";
import { LocalTable, type BotPolicy } from "../src/client/practice/localTable";
import { seededRng } from "../src/engine/rng";
import type { TableView } from "../src/shared/protocol";
import { FakeClock } from "./practice.helpers";

/** Always check or call; always rebuy. */
const passive: BotPolicy = (view) => {
  const me = view.me!;
  if (me.rebuy) return { t: "rebuy", accept: true };
  if (me.scanner) return { t: "choose", index: null };
  if (me.upgrade) return { t: "choose", index: 2 };
  if (me.engineer) return { t: "choose", index: 0 };
  if (!me.legal) return null;
  return { t: "act", action: me.legal.canCheck ? "check" : "call" };
};

function setup(opponents: number, policy: BotPolicy = passive) {
  const clock = new FakeClock();
  const views: TableView[] = [];
  const errors: string[] = [];
  const table = new LocalTable(
    { name: "You", botNames: ["Ada", "Bo", "Cy", "Di", "Ed"].slice(0, opponents), settings: { turnSeconds: 60, rebuys: -1 } },
    seededRng(5),
    policy,
    clock,
    (v) => views.push(v),
    (e) => errors.push(e),
  );
  return { clock, views, errors, table, last: () => views[views.length - 1] };
}

describe("practice table", () => {
  it("starts a game with the human and bots, classic or double by table size", () => {
    const three = setup(2);
    expect(three.last().status).toBe("running");
    expect(three.last().mode).toBe("classic");
    expect(three.last().youId).toBe(three.table.humanId);
    expect(setup(4).last().mode).toBe("double");
  });

  it("plays hands on its own clock: bots act, the human is prompted, hands continue", () => {
    const { clock, table, last, errors } = setup(2);
    for (let steps = 0; steps < 2000 && (last().hand?.number ?? 0) < 6; steps++) {
      const v = last();
      if (v.me?.legal) table.send({ t: "act", action: v.me.legal.canCheck ? "check" : "call" });
      else if (!clock.runNext()) break;
    }
    expect(last().hand!.number).toBeGreaterThanOrEqual(6);
    expect(errors).toEqual([]);
  });

  it("only ever shows the human their own cards", () => {
    const { clock, last } = setup(3);
    for (let i = 0; i < 50 && clock.runNext(); i++) {
      for (const p of last().players) {
        if (p.isYou) continue;
        for (const c of p.hole) if (c.card) expect(c.exposed || last().hand?.phase === "done").toBe(true);
      }
    }
  });

  it("times the human out like a real table and keeps going", () => {
    const { clock, last } = setup(2);
    // Never act: the human is timed out, marked away and auto-folded; the game carries on.
    for (let i = 0; i < 500 && (last().hand?.number ?? 0) < 4; i++) if (!clock.runNext()) break;
    expect(last().hand!.number).toBeGreaterThanOrEqual(4);
    expect(last().players.find((p) => p.isYou)!.away).toBe(true);
  });

  it("pauses while hidden and resumes", () => {
    const { clock, table, last } = setup(2);
    table.setHidden(true);
    expect(last().paused).toBe(true);
    expect(clock.pending).toBe(0);
    table.setHidden(false);
    expect(last().paused).toBe(false);
    expect(clock.pending).toBeGreaterThan(0);
  });

  it("stops everything on dispose", () => {
    const { clock, table } = setup(2);
    table.dispose();
    let ran = 0;
    while (clock.runNext()) ran++;
    expect(ran).toBeLessThan(3);
  });
});
