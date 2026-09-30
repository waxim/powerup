import { fullDeck, type Card } from "../shared/cards";
import { handScore } from "./evaluator";
import type { Rng } from "./rng";

export interface EquityInput {
  /** The hero's hole cards; `null` means "a fresh card from the deck" (e.g. evaluating a Reload). */
  hole: (Card | null)[];
  /** Community cards already out; `null` means "replaced by a fresh card" (e.g. evaluating a Disintegrate). */
  board: (Card | null)[];
  /** One entry per opponent still in the hand: their known (exposed) cards, `null` for each unknown card. */
  opponents: (Card | null)[][];
  /** Further board cards still to be dealt (flop/turn/river, or an extra Deploy). */
  boardToCome: number;
  /** Cards known to come off the deck next, in order (Intel, Engineer, Scanner). Fresh cards use these first. */
  knownNext?: Card[];
  /** Cards known to be out of play (e.g. discarded). */
  dead?: Card[];
  iterations: number;
  rng: Rng;
}

/**
 * The hero's expected share of the pot (0..1, ties split) by Monte Carlo simulation over everything the hero
 * can't see. Fresh cards for the hero and the board are drawn in dealing order: hole replacements, then board
 * replacements, then the cards still to come; known next cards are used before random ones.
 */
export function estimateEquity(input: EquityInput): number {
  const { hole, board, opponents, boardToCome, rng } = input;
  if (opponents.length === 0) return 1;
  const freshForHero = hole.filter((c) => c === null).length + board.filter((c) => c === null).length + boardToCome;
  const knownNext = (input.knownNext ?? []).slice(0, freshForHero);
  const known = new Set<Card>(input.dead ?? []);
  for (const c of [...hole, ...board, ...knownNext]) if (c) known.add(c);
  for (const opp of opponents) for (const c of opp) if (c) known.add(c);
  const unknown = fullDeck().filter((c) => !known.has(c));
  const randomFresh = freshForHero - knownNext.length;
  const need = randomFresh + opponents.reduce((n, o) => n + o.filter((c) => c === null).length, 0);
  if (need > unknown.length) return 0.5;

  let share = 0;
  const pool = unknown.slice();
  for (let it = 0; it < input.iterations; it++) {
    // Partial Fisher-Yates: the first `need` entries of `pool` become this sample's unseen cards.
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(pool.length - i);
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
    }
    let next = 0;
    let k = 0;
    const draw = (): Card => (next < knownNext.length ? knownNext[next++] : pool[k++]);
    const myHole = hole.map((c) => c ?? draw());
    const fullBoard = board.map((c) => c ?? draw());
    for (let i = 0; i < boardToCome; i++) fullBoard.push(draw());
    const mine = handScore(myHole.concat(fullBoard));
    let tied = 1;
    let lost = false;
    for (const opp of opponents) {
      const cards = opp.map((c) => c ?? pool[k++]);
      const score = handScore(cards.concat(fullBoard));
      if (score > mine) {
        lost = true;
        break;
      }
      if (score === mine) tied++;
    }
    if (!lost) share += 1 / tied;
  }
  return share / input.iterations;
}
