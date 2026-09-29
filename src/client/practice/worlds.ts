import { handScore } from "../../engine/evaluator";
import type { Rng } from "../../engine/rng";
import { fullDeck, type Card } from "../../shared/cards";

/**
 * One guess at everything a bot can't see: the opponents' face-down cards and the order of the deck.
 * Comparing options on the same set of worlds ("common random numbers") makes small differences
 * between them meaningful, where separate simulations would drown them in noise.
 */
export interface World {
  /** Each live opponent's two hole cards. */
  opp: Card[][];
  /** The next cards off the deck, in order (known cards first). */
  stream: Card[];
}

export interface WorldsInput {
  /** Cards the bot knows are in play: its hole cards and the board. */
  seen: Card[];
  /** Live opponents' hole cards: exposed ones known, `null` for face down. */
  opponents: (Card | null)[][];
  /** Cards known to be next off the deck, in order (Intel, Scanner, Engineer). */
  prefix: Card[];
  /** Cards known to be out of play. */
  dead: Card[];
  /** How many deck cards each world needs. */
  streamLength: number;
  count: number;
  rng: Rng;
}

export function sampleWorlds(input: WorldsInput): World[] {
  const known = new Set<Card>([...input.seen, ...input.prefix, ...input.dead]);
  for (const o of input.opponents) for (const c of o) if (c) known.add(c);
  const pool = fullDeck().filter((c) => !known.has(c));
  const oppNeed = input.opponents.reduce((n, o) => n + o.filter((c) => c === null).length, 0);
  const streamRandom = Math.max(0, input.streamLength - input.prefix.length);
  const need = Math.min(pool.length, oppNeed + streamRandom);
  const worlds: World[] = [];
  for (let w = 0; w < input.count; w++) {
    // Partial Fisher-Yates: the first `need` cards of the pool are this world's unseen cards.
    for (let i = 0; i < need; i++) {
      const j = i + input.rng.int(pool.length - i);
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    let k = 0;
    const opp = input.opponents.map((o) => o.map((c) => c ?? pool[k++]));
    const stream = input.prefix.slice(0, input.streamLength);
    while (stream.length < input.streamLength && k < need) stream.push(pool[k++]);
    worlds.push({ opp, stream });
  }
  return worlds;
}

/** The hero's share of the pot in one world (ties split). */
export function shareOf(hole: Card[], board: Card[], opp: Card[][]): number {
  const mine = handScore(hole.concat(board));
  let tied = 1;
  for (const o of opp) {
    const s = handScore(o.concat(board));
    if (s > mine) return 0;
    if (s === mine) tied++;
  }
  return 1 / tied;
}

/** A way the hand could play out: the hero's final hole cards and board in a given world. */
export type Outcome = (w: World) => { hole: Card[]; board: Card[] } | null;

/** The hero's share in every world for one outcome (worlds the outcome can't use score as a loss). */
export function shares(worlds: World[], outcome: Outcome): number[] {
  return worlds.map((w) => {
    const o = outcome(w);
    return o ? shareOf(o.hole, o.board, w.opp) : 0;
  });
}

export function mean(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return xs.length ? s / xs.length : 0;
}

/** Average improvement of `b` over `a`, world by world, with its standard error. */
export function pairedGain(a: number[], b: number[]): { gain: number; se: number } {
  const n = Math.min(a.length, b.length);
  if (n < 2) return { gain: 0, se: 1 };
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const d = b[i] - a[i];
    s += d;
    s2 += d * d;
  }
  const m = s / n;
  const variance = Math.max(0, s2 / n - m * m);
  return { gain: m, se: Math.sqrt(variance / (n - 1)) };
}
