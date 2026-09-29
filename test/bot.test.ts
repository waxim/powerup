import { describe, expect, it, vi } from "vitest";
import { practiceBot } from "../src/client/practice/bot";
import { LocalTable } from "../src/client/practice/localTable";
import { seededRng } from "../src/engine/rng";
import type { ClientMessage, TableView } from "../src/shared/protocol";
import { FakeClock } from "./practice.helpers";

/** Run a practice table where the human seat is also played by the bot policy. */
function autoplay(opponents: number, seed: number, hands: number) {
  const clock = new FakeClock();
  let last: TableView | null = null;
  const errors: string[] = [];
  const table = new LocalTable(
    { name: "You", botNames: ["Ada", "Bo", "Cy", "Di", "Eli"].slice(0, opponents), settings: { turnSeconds: 60, rebuys: -1, startingChips: 1500 } },
    seededRng(seed),
    practiceBot,
    clock,
    (v) => (last = v),
    (e) => errors.push(e),
  );
  const rng = seededRng(seed + 1000);
  let decisions = 0;
  let decisionMs = 0;
  for (let step = 0; step < 20_000 && (last!.hand?.number ?? 0) <= hands; step++) {
    const v: TableView = last!;
    const needsHuman = v.me?.legal || v.me?.rebuy || v.me?.scanner || v.me?.upgrade || v.me?.engineer;
    if (needsHuman) {
      const t0 = performance.now();
      const move = practiceBot(v, rng, 4);
      decisionMs += performance.now() - t0;
      decisions++;
      if (move) table.send(move as ClientMessage);
      else break;
    } else if (!clock.runNext()) break;
  }
  const log = table.game.s.log;
  return { table, errors, last: last!, decisions, avgMs: decisionMs / Math.max(1, decisions), log };
}

describe("practice bots", () => {
  it("never make an illegal move across many hands, at every table size", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const powersSeen = new Set<string>();
    for (const [opponents, seed] of [[1, 1], [2, 2], [2, 3], [3, 4], [5, 5]] as const) {
      const run = autoplay(opponents, seed, 25);
      expect(run.errors).toEqual([]);
      expect(run.last.hand!.number).toBeGreaterThan(25);
      for (const l of run.log) if (l.power) powersSeen.add(l.power);
    }
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
    // Bots actually use a wide range of powers.
    expect(powersSeen.size).toBeGreaterThanOrEqual(8);
  }, 120_000);

  it("decide quickly enough for a phone", () => {
    const run = autoplay(2, 9, 10);
    expect(run.avgMs).toBeLessThan(40);
  }, 60_000);
});
