import { estimateEquity } from "../../engine/equity";
import type { Rng } from "../../engine/rng";
import type { Card } from "../../shared/cards";
import type { PowerType } from "../../shared/powers";
import type { LegalActions, MyPowerView, TableView } from "../../shared/protocol";
import type { BotMove, BotPolicy } from "./localTable";

/** How a practice bot plays. Values are probabilities or multipliers around 1 = "normal". */
export interface Personality {
  name: string;
  /** Willingness to put money in (lower = plays more hands). */
  tightness: number;
  /** Chance of betting/raising when strong enough, and of bluffing. */
  aggression: number;
  /** Chance of using a power when its trigger fires. */
  powerAppetite: number;
}

export const PERSONALITIES: Personality[] = [
  { name: "Nova", tightness: 1.0, aggression: 0.55, powerAppetite: 0.75 },
  { name: "Bolt", tightness: 0.85, aggression: 0.8, powerAppetite: 0.9 },
  { name: "Echo", tightness: 1.15, aggression: 0.35, powerAppetite: 0.6 },
  { name: "Pixel", tightness: 0.95, aggression: 0.6, powerAppetite: 0.8 },
  { name: "Vega", tightness: 1.05, aggression: 0.45, powerAppetite: 0.7 },
];

const SIMS = 220;
const SIMS_QUICK = 140;

/** Everything a bot knows about the hand, taken from its own view. */
interface Situation {
  view: TableView;
  hole: Card[];
  board: Card[];
  opponents: (Card | null)[][];
  boardToCome: number;
  knownNext: Card[];
  street: string;
  legal: LegalActions;
  bb: number;
  stack: number;
  pot: number;
  rng: Rng;
}

function situation(view: TableView, rng: Rng): Situation | null {
  const h = view.hand;
  const me = view.me;
  if (!h || !me || !me.legal) return null;
  const opponents = view.players
    .filter((p) => !p.isYou && p.inHand && !p.folded)
    .map((p) => p.hole.map((c) => c.card));
  const standard = h.board.filter((b) => !b.deployed).length;
  const knownNext: Card[] = [];
  if (me.intelTop) knownNext.push(me.intelTop);
  else if (h.knownTop) knownNext.push(h.knownTop);
  return {
    view,
    hole: me.hole.map((c) => c.card),
    board: h.board.map((b) => b.card),
    opponents,
    boardToCome: Math.max(0, 5 - standard),
    knownNext,
    street: h.street,
    legal: me.legal,
    bb: view.level.bb,
    stack: view.players.find((p) => p.isYou)?.chips ?? 0,
    pot: h.pot,
    rng,
  };
}

function equity(s: Situation, overrides: Partial<Parameters<typeof estimateEquity>[0]> = {}, sims = SIMS): number {
  return estimateEquity({
    hole: s.hole,
    board: s.board,
    opponents: s.opponents,
    boardToCome: s.boardToCome,
    knownNext: s.knownNext,
    iterations: sims,
    rng: s.rng,
    ...overrides,
  });
}

const chance = (rng: Rng, p: number) => rng.int(1000) < Math.max(0, Math.min(1, p)) * 1000;

/* ------------------------------------------------------------------ */
/* Powers                                                              */
/* ------------------------------------------------------------------ */

function hasEnergyFor(view: TableView, p: MyPowerView): boolean {
  return p.playable && p.cost <= (view.me?.energy ?? 0);
}

/** Pick a power to play right now, if any is worth it. At most one per call; the driver asks again afterwards. */
function choosePower(s: Situation, personality: Personality, base: number): BotMove | null {
  const { view, rng } = s;
  const me = view.me!;
  const playable = me.powers.filter((p) => hasEnergyFor(view, p));
  if (!playable.length) return null;
  // Don't spend the whole bar in one hand every time: less appetite as energy runs low.
  const appetite = personality.powerAppetite * (me.energy >= 8 ? 1 : 0.6);
  const n = s.opponents.length;
  const fair = 1 / (n + 1);
  const strength = base / fair; // 1 = average hand for this many players
  const drawing = s.boardToCome > 0;
  const facingBet = s.legal.callAmount > 0;
  const opponentsExposed = s.view.players.filter((p) => !p.isYou && p.inHand && !p.folded && !p.hole.some((c) => c.exposed));

  const ideas: { move: BotMove; value: number }[] = [];
  const add = (type: PowerType, value: number, extra: Omit<Extract<BotMove, { t: "power" }>, "t" | "powerId"> = {}) => {
    const card = playable.find((p) => p.type === type);
    if (card && value > 0) ideas.push({ move: { t: "power", powerId: card.id, ...extra }, value });
  };

  for (const p of playable) {
    switch (p.type) {
      case "xray":
        // Information is most useful when facing a bet or before committing preflop.
        if (opponentsExposed.length && (facingBet || s.street === "preflop")) add("xray", 0.05 + 0.02 * opponentsExposed.length);
        break;
      case "intel":
        if (drawing && s.street !== "river") add("intel", 0.04);
        break;
      case "emp": {
        // Protect a strong hand from opponents who still have energy and a chance to act this street.
        const threats = view.players.filter((o) => !o.isYou && o.inHand && !o.folded && !o.allIn && o.energy >= 3 && o.powerCount > 0);
        if (strength > 1.3 && threats.length && drawing) add("emp", 0.05 * threats.length);
        break;
      }
      case "clone":
        if (view.hand?.lastPower && view.hand.lastPower !== "emp") add("clone", 0.03);
        break;
      case "scanner":
        if (drawing && strength < 1.6) add("scanner", 0.05);
        break;
      case "engineer":
        if (drawing && strength < 1.8) add("engineer", 0.07);
        break;
      case "reload": {
        const options: number[][] = [[0], [1], [0, 1]];
        let best: { gain: number; indices: number[] } | null = null;
        for (const indices of options) {
          const hole = s.hole.map((c, i) => (indices.includes(i) ? null : c));
          const gain = equity(s, { hole, dead: indices.map((i) => s.hole[i]) }, SIMS_QUICK) - base;
          if (!best || gain > best.gain) best = { gain, indices };
        }
        if (best && best.gain > 0.04) add("reload", best.gain, { indices: best.indices });
        break;
      }
      case "upgrade": {
        // An extra card to choose from is at least as good as reloading the weaker card, without the risk.
        let gain = 0;
        for (let i = 0; i < s.hole.length; i++) {
          const hole = s.hole.map((c, j) => (j === i ? null : c));
          gain = Math.max(gain, equity(s, { hole, dead: [s.hole[i]] }, SIMS_QUICK) - base);
        }
        if (gain > 0.02 || strength < 0.8) add("upgrade", Math.max(gain, 0.03) + 0.02);
        break;
      }
      case "disintegrate": {
        const targets = (view.hand?.board ?? []).flatMap((b, i) => (b.current && !b.locked ? [i] : []));
        let best: { gain: number; target: number } | null = null;
        for (const target of targets) {
          const board = s.board.map((c, i) => (i === target ? null : c));
          const gain = equity(s, { board, dead: [s.board[target]] }, SIMS_QUICK) - base;
          if (!best || gain > best.gain) best = { gain, target };
        }
        if (best && best.gain > 0.05) add("disintegrate", best.gain, { target: best.target });
        break;
      }
      case "deploy": {
        const gain = equity(s, { boardToCome: s.boardToCome + 1 }, SIMS_QUICK) - base;
        if (gain > 0.04) add("deploy", gain);
        break;
      }
    }
  }
  if (!ideas.length) return null;
  ideas.sort((a, b) => b.value - a.value);
  return chance(rng, appetite) ? ideas[0].move : null;
}

/** Follow-up choices after Scanner, Upgrade and Engineer: pick whatever gives the best equity. */
function chooseFollowUp(view: TableView, rng: Rng): BotMove | null {
  const me = view.me!;
  const h = view.hand;
  if (!h) return null;
  const opponents = view.players.filter((p) => !p.isYou && p.inHand && !p.folded).map((p) => p.hole.map((c) => c.card));
  const board = h.board.map((b) => b.card);
  const boardToCome = Math.max(0, 5 - h.board.filter((b) => !b.deployed).length);
  const eq = (hole: (Card | null)[], knownNext: Card[], dead: Card[] = []) =>
    estimateEquity({ hole, board, opponents, boardToCome, knownNext, dead, iterations: SIMS_QUICK, rng });

  if (me.scanner) {
    const [a, b] = me.scanner;
    const options: { index: number | null; next: Card[]; dead: Card[] }[] = [
      { index: null, next: [a, b], dead: [] },
      { index: 0, next: [b], dead: [a] },
      { index: 1, next: [a], dead: [b] },
    ];
    let best = options[0];
    let bestEq = -1;
    for (const o of options) {
      const e = eq(me.hole.map((c) => c.card), o.next, o.dead);
      if (e > bestEq + 0.01) {
        best = o;
        bestEq = e;
      }
    }
    return { t: "choose", index: best.index };
  }
  if (me.upgrade) {
    let best = 0;
    let bestEq = -1;
    me.hole.forEach((_, discard) => {
      const hole = me.hole.filter((__, i) => i !== discard).map((c) => c.card);
      const e = eq(hole, [], [me.hole[discard].card]);
      if (e > bestEq) {
        best = discard;
        bestEq = e;
      }
    });
    return { t: "choose", index: best };
  }
  if (me.engineer) {
    let best = 0;
    let bestEq = -1;
    me.engineer.forEach((card, i) => {
      const e = eq(me.hole.map((c) => c.card), [card], me.engineer!.filter((c) => c !== card));
      if (e > bestEq) {
        best = i;
        bestEq = e;
      }
    });
    return { t: "choose", index: best };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Betting                                                             */
/* ------------------------------------------------------------------ */

function raiseTo(s: Situation, fractionOfPot: number): number {
  const { legal } = s;
  const afterCall = legal.pot + legal.callAmount;
  const target = legal.streetBet + legal.callAmount + afterCall * fractionOfPot;
  return Math.round(Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, target)));
}

function bet(s: Situation, personality: Personality, eq: number): BotMove {
  const { legal, rng } = s;
  const n = s.opponents.length;
  const strength = eq * (n + 1) * (1 / personality.tightness);
  const stackBBs = s.stack / Math.max(1, s.bb);
  const toCall = legal.callAmount;
  const potOdds = toCall / Math.max(1, s.pot + toCall);
  const noise = (rng.int(21) - 10) / 100; // ±0.10 so bots aren't perfectly predictable

  // Short stacks play push-or-fold.
  if (stackBBs <= 10 && legal.canRaise) {
    if (strength + noise > 1.15) return { t: "act", action: "raise", amount: legal.maxRaiseTo };
    return legal.canCheck ? { t: "act", action: "check" } : { t: "act", action: "fold" };
  }

  if (legal.canCheck) {
    const value = strength + noise > 1.35;
    const bluff = s.street !== "preflop" && strength < 0.7 && chance(rng, personality.aggression * 0.18);
    if (legal.canRaise && (value || bluff) && chance(rng, 0.35 + personality.aggression * 0.6)) {
      const size = s.street === "preflop" ? raiseTo(s, 0.6) : raiseTo(s, 0.5 + rng.int(4) / 10);
      return { t: "act", action: "raise", amount: size };
    }
    return { t: "act", action: "check" };
  }

  // Facing a bet.
  const margin = 0.03 + (personality.tightness - 1) * 0.1;
  if (legal.canRaise && strength + noise > 1.75 && chance(rng, personality.aggression)) {
    return { t: "act", action: "raise", amount: raiseTo(s, 0.75 + rng.int(4) / 10) };
  }
  if (eq + noise * 0.5 > potOdds + margin) return { t: "act", action: "call" };
  // A little curiosity for small bets, especially preflop.
  if (toCall <= s.bb && chance(rng, 0.35)) return { t: "act", action: "call" };
  return { t: "act", action: "fold" };
}

/* ------------------------------------------------------------------ */

/** The practice bot: follow-up choices first, then maybe a power, then a betting decision. */
export const practiceBot: BotPolicy = (view, rng, botIndex) => {
  const me = view.me;
  if (!me) return null;
  if (me.rebuy) return { t: "rebuy", accept: true };
  if (me.scanner || me.upgrade || me.engineer) return chooseFollowUp(view, rng);
  const s = situation(view, rng);
  if (!s) return null;
  const personality = PERSONALITIES[botIndex % PERSONALITIES.length];
  const eq = equity(s);
  return choosePower(s, personality, eq) ?? bet(s, personality, eq);
};
