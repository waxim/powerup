import { fullDeck, type Card } from "../shared/cards";
import { handScore } from "./evaluator";
import type { Rng } from "./rng";

export interface EquityInput {
  /** The hero's hole cards. */
  hole: Card[];
  /** Community cards already out (including deployed ones). */
  board: Card[];
  /** One entry per opponent still in the hand: their known (exposed) cards, `null` for each unknown card. */
  opponents: (Card | null)[][];
  /** Standard board cards still to be dealt (flop/turn/river). */
  boardToCome: number;
  /** Cards known to come off the deck next, in order (Intel, Engineer, Scanner). They fill the board first. */
  knownNext?: Card[];
  /** Other cards known to be out of play (e.g. seen and discarded). */
  dead?: Card[];
  iterations: number;
  rng: Rng;
}

/**
 * The hero's expected share of the pot (0..1, ties split) against the given opponents, by Monte Carlo
 * simulation over everything the hero can't see. Uses only the information passed in.
 */
export function estimateEquity(input: EquityInput): number {
  const { hole, board, opponents, boardToCome, rng } = input;
  if (opponents.length === 0) return 1;
  const knownNext = (input.knownNext ?? []).slice(0, boardToCome);
  const known = new Set<Card>([...hole, ...board, ...knownNext, ...(input.dead ?? [])]);
  for (const opp of opponents) for (const c of opp) if (c) known.add(c);
  const unknown = fullDeck().filter((c) => !known.has(c));
  const randomBoard = boardToCome - knownNext.length;
  const need = randomBoard + opponents.reduce((n, o) => n + o.filter((c) => c === null).length, 0);
  if (need > unknown.length) return 0.5;

  let share = 0;
  const pool = unknown.slice();
  for (let it = 0; it < input.iterations; it++) {
    // Partial Fisher-Yates: the first `need` entries of `pool` become the sample.
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(pool.length - i);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    let k = 0;
    const fullBoard = board.concat(knownNext);
    for (let i = 0; i < randomBoard; i++) fullBoard.push(pool[k++]);
    const mine = handScore(hole.concat(fullBoard));
    let best = mine;
    let tied = 1;
    let lost = false;
    for (const opp of opponents) {
      const cards = opp.map((c) => c ?? pool[k++]);
      const score = handScore(cards.concat(fullBoard));
      if (score > best) {
        lost = true;
        break;
      }
      if (score === best) tied++;
    }
    if (!lost) share += 1 / tied;
  }
  return share / input.iterations;
}
