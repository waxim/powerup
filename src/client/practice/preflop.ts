import { rankOf, suitOf, type Card } from "../../shared/cards";
import { PREFLOP_EQUITY } from "./preflopTable";

/** "AKs", "72o", "TT": the 169 starting-hand classes. */
export function handClass(a: Card, b: Card): string {
  const [hi, lo] = rankOf(a) >= rankOf(b) ? [a, b] : [b, a];
  if (hi[0] === lo[0]) return hi[0] + lo[0];
  return hi[0] + lo[0] + (suitOf(hi) === suitOf(lo) ? "s" : "o");
}

const combos = (cls: string) => (cls.length === 2 ? 6 : cls.endsWith("s") ? 4 : 12);

/** Equity of a starting hand against `opponents` random hands (1 to 5). */
export function preflopEquity(a: Card, b: Card, opponents: number): number {
  const row = PREFLOP_EQUITY[handClass(a, b)];
  return row ? row[Math.min(5, Math.max(1, opponents)) - 1] / 1000 : 1 / (opponents + 1);
}

/** For each opponent count, every class's percentile: 0 is the best hand, 1 the worst. */
const PERCENTILES: Map<string, number>[] = [1, 2, 3, 4, 5].map((n) => {
  const classes = Object.keys(PREFLOP_EQUITY).sort((x, y) => PREFLOP_EQUITY[y][n - 1] - PREFLOP_EQUITY[x][n - 1]);
  const total = classes.reduce((s, c) => s + combos(c), 0);
  const out = new Map<string, number>();
  let above = 0;
  for (const c of classes) {
    out.set(c, (above + combos(c) / 2) / total);
    above += combos(c);
  }
  return out;
});

/** How good a starting hand is against `opponents` others: 0.02 is a top-2% hand, 0.9 is trash. */
export function preflopPercentile(a: Card, b: Card, opponents: number): number {
  return PERCENTILES[Math.min(5, Math.max(1, opponents)) - 1].get(handClass(a, b)) ?? 0.5;
}

/** Average equity of a random starting hand, the baseline for Reload-both. */
export function averagePreflopEquity(opponents: number): number {
  const n = Math.min(5, Math.max(1, opponents)) - 1;
  let sum = 0;
  let total = 0;
  for (const [cls, row] of Object.entries(PREFLOP_EQUITY)) {
    sum += row[n] * combos(cls);
    total += combos(cls);
  }
  return sum / total / 1000;
}

