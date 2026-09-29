import { rankName, rankOf, suitOf, type Card } from "../shared/cards";

export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;

export interface HandValue {
  /** Higher is better; comparable across any hands. */
  score: number;
  category: number;
  /** Tie-break ranks, most significant first. */
  ranks: number[];
  /** The cards that make the hand (up to five). */
  cards: Card[];
  label: string;
}

const BASE = 15;

function makeScore(category: number, ranks: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * BASE + (ranks[i] ?? 0);
  return score;
}

/** Group ranks by count (desc) then rank (desc): e.g. [[13,3],[7,2]] for kings full of sevens. */
function groupRanks(ranks: number[]): [number, number][] {
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
}

function straightHigh(sortedDesc: number[]): number {
  const uniq = [...new Set(sortedDesc)];
  if (uniq.length !== 5) return 0;
  if (uniq[0] - uniq[4] === 4) return uniq[0];
  if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) return 5; // wheel: A-2-3-4-5
  return 0;
}

function evaluateFive(cards: Card[]): { category: number; ranks: number[] } {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const high = straightHigh(ranks);
  const groups = groupRanks(ranks);
  if (high && flush) return { category: HandCategory.StraightFlush, ranks: [high] };
  if (groups[0][1] === 4) return { category: HandCategory.Quads, ranks: [groups[0][0], groups[1][0]] };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { category: HandCategory.FullHouse, ranks: [groups[0][0], groups[1][0]] };
  if (flush) return { category: HandCategory.Flush, ranks };
  if (high) return { category: HandCategory.Straight, ranks: [high] };
  if (groups[0][1] === 3) return { category: HandCategory.Trips, ranks: groups.map((g) => g[0]) };
  if (groups[0][1] === 2 && groups[1][1] === 2) return { category: HandCategory.TwoPair, ranks: groups.map((g) => g[0]) };
  if (groups[0][1] === 2) return { category: HandCategory.Pair, ranks: groups.map((g) => g[0]) };
  return { category: HandCategory.HighCard, ranks };
}

/** Hands with fewer than five cards (e.g. preflop): only pairs, trips and quads count. */
function evaluatePartial(cards: Card[]): { category: number; ranks: number[] } {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const groups = groupRanks(ranks);
  const flat = groups.map((g) => g[0]);
  if (groups[0]?.[1] === 4) return { category: HandCategory.Quads, ranks: flat };
  if (groups[0]?.[1] === 3) return { category: HandCategory.Trips, ranks: flat };
  if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) return { category: HandCategory.TwoPair, ranks: flat };
  if (groups[0]?.[1] === 2) return { category: HandCategory.Pair, ranks: flat };
  return { category: HandCategory.HighCard, ranks };
}

export function describeHand(category: number, ranks: number[]): string {
  const [a, b] = ranks;
  switch (category) {
    case HandCategory.StraightFlush:
      return a === 14 ? "Royal Flush" : `Straight Flush, ${rankName(a)} high`;
    case HandCategory.Quads:
      return `Four of a Kind, ${rankName(a, true)}`;
    case HandCategory.FullHouse:
      return `Full House, ${rankName(a, true)} full of ${rankName(b, true)}`;
    case HandCategory.Flush:
      return `Flush, ${rankName(a)} high`;
    case HandCategory.Straight:
      return `Straight, ${rankName(a)} high`;
    case HandCategory.Trips:
      return `Three of a Kind, ${rankName(a, true)}`;
    case HandCategory.TwoPair:
      return `Two Pair, ${rankName(a, true)} and ${rankName(b, true)}`;
    case HandCategory.Pair:
      return `Pair of ${rankName(a, true)}`;
    default:
      return a ? `High Card, ${rankName(a)}` : "Nothing";
  }
}

function* combinations<T>(items: T[], k: number, start = 0, picked: T[] = []): Generator<T[]> {
  if (picked.length === k) {
    yield picked;
    return;
  }
  for (let i = start; i <= items.length - (k - picked.length); i++) {
    yield* combinations(items, k, i + 1, [...picked, items[i]]);
  }
}

/** Best poker hand from any number of cards (hole + board, up to 9 with Deploy/Upgrade). */
export function bestHand(cards: Card[]): HandValue {
  if (cards.length < 5) {
    const { category, ranks } = evaluatePartial(cards);
    return { score: makeScore(category, ranks), category, ranks, cards: [...cards], label: describeHand(category, ranks) };
  }
  let best: HandValue | null = null;
  for (const combo of combinations(cards, 5)) {
    const { category, ranks } = evaluateFive(combo);
    const score = makeScore(category, ranks);
    if (!best || score > best.score) best = { score, category, ranks, cards: combo, label: "" };
  }
  best!.label = describeHand(best!.category, best!.ranks);
  return best!;
}

/** Highest straight in a set of ranks (14..2), or 0. Handles the A-2-3-4-5 wheel. */
function highestStraight(present: boolean[]): number {
  for (let high = 14; high >= 6; high--) {
    if (present[high] && present[high - 1] && present[high - 2] && present[high - 3] && present[high - 4]) return high;
  }
  return present[14] && present[2] && present[3] && present[4] && present[5] ? 5 : 0;
}

/**
 * Score of the best five-card hand, identical to `bestHand(cards).score` but computed in one pass
 * without enumerating subsets. Used where speed matters (bot equity simulations).
 */
export function handScore(cards: Card[]): number {
  if (cards.length < 5) return bestHand(cards).score;
  const counts = new Array<number>(15).fill(0);
  const bySuit: Record<string, number[]> = { s: [], h: [], d: [], c: [] };
  for (const c of cards) {
    const r = rankOf(c);
    counts[r]++;
    bySuit[suitOf(c)].push(r);
  }
  for (const suit of ["s", "h", "d", "c"]) {
    const ranks = bySuit[suit];
    if (ranks.length < 5) continue;
    const present = new Array<boolean>(15).fill(false);
    for (const r of ranks) present[r] = true;
    const sf = highestStraight(present);
    if (sf) return makeScore(HandCategory.StraightFlush, [sf]);
    // At most one suit can hold five or more of nine cards; remember it for the flush check below.
    const flush = ranks.sort((a, b) => b - a).slice(0, 5);
    return scoreWithoutFlush(counts, flush);
  }
  return scoreWithoutFlush(counts, null);
}

function scoreWithoutFlush(counts: number[], flush: number[] | null): number {
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  const present = new Array<boolean>(15).fill(false);
  for (let r = 14; r >= 2; r--) {
    const n = counts[r];
    if (!n) continue;
    present[r] = true;
    if (n === 4) quads.push(r);
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
    else singles.push(r);
  }
  const bestOthers = (exclude: number[], take: number): number[] => {
    const out: number[] = [];
    for (let r = 14; r >= 2 && out.length < take; r--) if (counts[r] && !exclude.includes(r)) out.push(r);
    return out;
  };
  if (quads.length) return makeScore(HandCategory.Quads, [quads[0], ...bestOthers([quads[0]], 1)]);
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0];
    const p = Math.max(trips[1] ?? 0, pairs[0] ?? 0);
    return makeScore(HandCategory.FullHouse, [t, p]);
  }
  if (flush) return makeScore(HandCategory.Flush, flush);
  const straight = highestStraight(present);
  if (straight) return makeScore(HandCategory.Straight, [straight]);
  if (trips.length) return makeScore(HandCategory.Trips, [trips[0], ...bestOthers([trips[0]], 2)]);
  if (pairs.length >= 2) return makeScore(HandCategory.TwoPair, [pairs[0], pairs[1], ...bestOthers([pairs[0], pairs[1]], 1)]);
  if (pairs.length) return makeScore(HandCategory.Pair, [pairs[0], ...bestOthers([pairs[0]], 3)]);
  return makeScore(HandCategory.HighCard, singles.slice(0, 5));
}
