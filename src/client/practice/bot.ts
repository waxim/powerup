import { handScore } from "../../engine/evaluator";
import type { Rng } from "../../engine/rng";
import { fullDeck, type Card } from "../../shared/cards";
import type { PowerType } from "../../shared/powers";
import type { LegalActions, MyPowerView, TableView } from "../../shared/protocol";
import type { BotMove, BotPolicy } from "./localTable";
import { averagePreflopEquity, preflopEquity, preflopPercentile } from "./preflop";
import { mean, pairedGain, sampleWorlds, shares, type Outcome, type World } from "./worlds";

/* ------------------------------------------------------------------ */
/* Personalities                                                       */
/* ------------------------------------------------------------------ */

/** How a practice bot plays. Probabilities are 0..1; the rest are small adjustments around "normal". */
export interface Personality {
  name: string;
  /** A few words for the setup screen. */
  style: string;
  /** Share of starting hands opened with a raise from early, middle and late position, the small blind, and heads-up. */
  open: [number, number, number, number, number];
  /** Extra share of hands limped in. */
  limp: number;
  threeBet: number;
  callRaise: number;
  /** Extra calling range in the big blind. */
  bbDefend: number;
  /** Chance of raising a strong hand rather than just calling. */
  aggression: number;
  cbet: number;
  barrel: number;
  bluff: number;
  semiBluff: number;
  /** Bets thinner for value (lower threshold). */
  valueThin: number;
  /** Calls a little lighter than the odds say. */
  sticky: number;
  slowplay: number;
  /** Bet size multiplier. */
  sizing: number;
  /** Random error in its read of its own equity. */
  wobble: number;
  /** Chance of looking at its powers at all on a given decision. */
  appetite: number;
  /** How much it values saving energy (higher = thriftier). */
  thrift: number;
  maxPowers: number;
  /** Favourite powers are valued higher. */
  affinity: Partial<Record<PowerType, number>>;
}

/** Seats fill in this order. Pixel loves powers, so even heads-up you see plenty of them. */
export const PERSONALITIES: Personality[] = [
  {
    name: "Pixel",
    style: "loves a power",
    open: [0.16, 0.22, 0.38, 0.34, 0.7],
    limp: 0.04,
    threeBet: 0.07,
    callRaise: 0.2,
    bbDefend: 0.35,
    aggression: 0.6,
    cbet: 0.62,
    barrel: 0.42,
    bluff: 0.18,
    semiBluff: 0.35,
    valueThin: 0.02,
    sticky: 0.02,
    slowplay: 0.1,
    sizing: 1,
    wobble: 0.04,
    appetite: 0.95,
    thrift: 0.7,
    maxPowers: 3,
    affinity: { intel: 1.5, engineer: 1.5, scanner: 1.4, deploy: 1.3, disintegrate: 1.2 },
  },
  {
    name: "Bolt",
    style: "bluffs a lot",
    open: [0.24, 0.32, 0.55, 0.46, 0.85],
    limp: 0.02,
    threeBet: 0.14,
    callRaise: 0.22,
    bbDefend: 0.4,
    aggression: 0.85,
    cbet: 0.8,
    barrel: 0.6,
    bluff: 0.35,
    semiBluff: 0.55,
    valueThin: 0.05,
    sticky: 0,
    slowplay: 0.05,
    sizing: 1.15,
    wobble: 0.05,
    appetite: 0.85,
    thrift: 1,
    maxPowers: 2,
    affinity: { emp: 1.6, disintegrate: 1.4, xray: 0.8 },
  },
  {
    name: "Echo",
    style: "likes to see flops",
    open: [0.12, 0.16, 0.28, 0.26, 0.6],
    limp: 0.3,
    threeBet: 0.03,
    callRaise: 0.45,
    bbDefend: 0.7,
    aggression: 0.35,
    cbet: 0.35,
    barrel: 0.25,
    bluff: 0.08,
    semiBluff: 0.15,
    valueThin: -0.02,
    sticky: 0.08,
    slowplay: 0.15,
    sizing: 0.9,
    wobble: 0.06,
    appetite: 0.8,
    thrift: 1,
    maxPowers: 2,
    affinity: { xray: 1.5, intel: 1.4, reload: 1.3, upgrade: 1.2, emp: 0.6 },
  },
  {
    name: "Nova",
    style: "balanced",
    open: [0.15, 0.2, 0.36, 0.32, 0.65],
    limp: 0.03,
    threeBet: 0.07,
    callRaise: 0.22,
    bbDefend: 0.45,
    aggression: 0.55,
    cbet: 0.6,
    barrel: 0.4,
    bluff: 0.18,
    semiBluff: 0.3,
    valueThin: 0.02,
    sticky: 0.02,
    slowplay: 0.1,
    sizing: 1,
    wobble: 0.04,
    appetite: 0.8,
    thrift: 1,
    maxPowers: 2,
    affinity: { upgrade: 1.3, reload: 1.2, xray: 1.2 },
  },
  {
    name: "Vega",
    style: "patient",
    open: [0.11, 0.14, 0.26, 0.22, 0.55],
    limp: 0,
    threeBet: 0.06,
    callRaise: 0.16,
    bbDefend: 0.35,
    aggression: 0.5,
    cbet: 0.55,
    barrel: 0.35,
    bluff: 0.1,
    semiBluff: 0.2,
    valueThin: 0,
    sticky: 0,
    slowplay: 0.3,
    sizing: 1.2,
    wobble: 0.03,
    appetite: 0.6,
    thrift: 1.5,
    maxPowers: 3,
    affinity: { clone: 1.5, emp: 1.4, engineer: 1.2 },
  },
];

/** Stand-in names for when the player has taken a bot's name. */
const SPARE_NAMES = ["Juno", "Rook", "Zed", "Orbit", "Flux", "Quark"];

/** The bots for a practice table: one per personality, never sharing a name with the player. */
export function pickOpponents(playerName: string, count: number): { name: string; profile: number }[] {
  const taken = new Set([playerName.trim().toLowerCase()]);
  const spares = SPARE_NAMES.filter((n) => !taken.has(n.toLowerCase()));
  return PERSONALITIES.slice(0, count).map((p, profile) => {
    const name = taken.has(p.name.toLowerCase()) ? spares.shift()! : p.name;
    taken.add(name.toLowerCase());
    return { name, profile };
  });
}

/* ------------------------------------------------------------------ */
/* Memory: only what this bot has seen for itself                      */
/* ------------------------------------------------------------------ */

export interface BotMemory {
  hand: number;
  street: string;
  powersThisStreet: number;
  powersThisHand: number;
  /** It made the last preflop raise, so it's the one expected to bet the flop. */
  aggressor: boolean;
  /** The next cards off the deck, as far as this bot knows (its own Scanner). */
  prefix: Card[];
  deckCount: number;
  boardLength: number;
  lastSeq: number;
  /** Cards it knows are out of play (its own discards). */
  dead: Card[];
  /** Its stack when the hand began, to know when it's committed. */
  startStack: number;
  /** The bet it meant to make after an EMP, so an EMP is never followed by a fold. */
  plan: { street: string; move: BotMove } | null;
  /** Power types seen at the table this session; unseen ones are a little more tempting (it's a demo). */
  seen: Set<PowerType>;
}

export function newBotMemory(): BotMemory {
  return {
    hand: -1,
    street: "",
    powersThisStreet: 0,
    powersThisHand: 0,
    aggressor: false,
    prefix: [],
    deckCount: 0,
    boardLength: 0,
    lastSeq: -1,
    dead: [],
    startStack: 0,
    plan: null,
    seen: new Set(),
  };
}

/** Catch up on what happened since this bot last looked. */
function observe(mem: BotMemory, view: TableView): void {
  const h = view.hand;
  const fresh = view.log.filter((l) => l.seq > mem.lastSeq);
  for (const l of fresh) if (l.power) mem.seen.add(l.power);
  // Missed some of the log: don't trust what we thought we knew about the deck.
  const gap = view.log.length > 0 && mem.lastSeq >= 0 && view.log[0].seq > mem.lastSeq + 1;
  if (view.log.length) mem.lastSeq = view.log[view.log.length - 1].seq;
  if (!h) return;
  if (mem.hand !== h.number) {
    const self = view.players.find((x) => x.isYou);
    Object.assign(mem, {
      hand: h.number,
      street: h.street,
      powersThisStreet: 0,
      powersThisHand: 0,
      aggressor: false,
      prefix: [],
      dead: [],
      plan: null,
      deckCount: h.deckCount,
      boardLength: h.board.length,
      startStack: (self?.chips ?? 0) + (self?.streetBet ?? 0),
    });
  }
  if (mem.street !== h.street) {
    mem.street = h.street;
    mem.powersThisStreet = 0;
    mem.plan = null;
  }
  // Someone else reshuffled the top of the deck: what we knew about it no longer holds.
  if (gap || fresh.some((l) => l.playerId !== view.youId && (l.power === "engineer" || /discards one of the top/.test(l.text)))) {
    mem.prefix = [];
  }
  // Everything else takes cards off the top in order: check the new board cards are the ones we expected.
  const drawn = mem.deckCount - h.deckCount;
  if (drawn > 0 && mem.prefix.length) {
    const used = mem.prefix.slice(0, drawn);
    const dealt = h.board.slice(mem.boardLength).map((b) => b.card);
    mem.prefix = dealt.every((c) => used.includes(c)) || used.length < dealt.length ? mem.prefix.slice(drawn) : [];
  }
  mem.deckCount = h.deckCount;
  mem.boardLength = h.board.length;
  // Intel and a public Engineer card are always right about the top card.
  const top = view.me?.intelTop ?? h.knownTop;
  if (top && mem.prefix[0] !== top) mem.prefix = [top];
}

/* ------------------------------------------------------------------ */
/* The situation, from the bot's own view                              */
/* ------------------------------------------------------------------ */

interface Spot {
  view: TableView;
  legal: LegalActions;
  p: Personality;
  mem: BotMemory;
  /** Randomness for simulations. */
  rng: Rng;
  /** Randomness for choices (fixed at the midpoint for the coach, which always gives the same advice). */
  dice: Rng;
  /** The first hands of a session: bots play gently while the newcomer finds their feet. */
  warmup: boolean;
  hole: Card[];
  board: Card[];
  /** Live opponents' cards: exposed ones known, null for face down. */
  opponents: (Card | null)[][];
  n: number;
  street: string;
  /** Standard board cards still to come. */
  toCome: number;
  /** Next cards off the deck that this bot knows. */
  known: Card[];
  bb: number;
  pot: number;
  toCall: number;
  chips: number;
  /** Chips this bot could still win or lose against the biggest live stack. */
  eff: number;
  streetsLeft: number;
  /** How believable a hand is for each live opponent, given how they've bet. */
  accept: (i: number, hole: Card[]) => number;
}

const STREETS_LEFT: Record<string, number> = { preflop: 3, flop: 2, turn: 1, river: 0 };

function spotFor(view: TableView, p: Personality, mem: BotMemory, rng: Rng, dice: Rng, warmup: boolean): Spot | null {
  const h = view.hand;
  const me = view.me;
  if (!h || !me?.legal) return null;
  const live = view.players.filter((x) => !x.isYou && x.inHand && !x.folded);
  const self = view.players.find((x) => x.isYou)!;
  const standard = h.board.filter((b) => !b.deployed).length;
  const biggest = Math.max(0, ...live.map((x) => x.chips + x.streetBet));
  const board = h.board.map((b) => b.card);
  return {
    view,
    legal: me.legal,
    p,
    mem,
    rng,
    dice,
    warmup,
    hole: me.hole.map((c) => c.card),
    board,
    opponents: live.map((x) => x.hole.map((c) => c.card)),
    n: live.length,
    street: h.street,
    toCome: Math.max(0, 5 - standard),
    known: mem.prefix,
    bb: view.level.bb,
    pot: me.legal.pot,
    toCall: me.legal.callAmount,
    chips: self.chips,
    eff: Math.min(self.chips + self.streetBet, biggest),
    streetsLeft: STREETS_LEFT[h.street] ?? 0,
    accept: rangeReader(view, live.map((x) => x.id), board),
  };
}

const WARMUP_HANDS = 2;

/* ------------------------------------------------------------------ */
/* Reading opponents                                                   */
/* ------------------------------------------------------------------ */

type PreflopAction = "raise" | "call-raise" | "limp" | "check";

/** How each player has acted this hand, from the public log (actions since this hand was dealt). */
export function readActions(view: TableView): { preflop: Map<string, PreflopAction>; raisers: Set<string>; bettors: Set<string> } {
  const preflop = new Map<string, PreflopAction>();
  const raisers = new Set<string>();
  const bettors = new Set<string>();
  const log = view.log;
  let start = -1;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].kind === "deal" && log[i].text.startsWith(`Hand #${view.handNumber}:`)) {
      start = i;
      break;
    }
  }
  if (start < 0) return { preflop, raisers, bettors };
  let street = "preflop";
  let raised = false;
  for (let i = start + 1; i < log.length; i++) {
    const l = log[i];
    if (l.kind === "deal") {
      street = l.text.split(":")[0].toLowerCase();
      bettors.clear();
      continue;
    }
    if (l.kind !== "action" || !l.playerId) continue;
    const raise = / (raises to|bets) /.test(l.text);
    if (street === "preflop") {
      if (raise) {
        preflop.set(l.playerId, "raise");
        raisers.add(l.playerId);
        raised = true;
      } else if (/ calls /.test(l.text)) preflop.set(l.playerId, raised ? "call-raise" : "limp");
      else if (/ checks$/.test(l.text)) preflop.set(l.playerId, "check");
    } else if (raise) bettors.add(l.playerId);
  }
  return { preflop, raisers, bettors };
}

const category = (cards: Card[]) => Math.floor(handScore(cards) / 15 ** 5);

/** A weight for how well a hand fits what an opponent has done: raisers raise good hands, bettors have something. */
function rangeReader(view: TableView, ids: string[], board: Card[]): (i: number, hole: Card[]) => number {
  const { preflop, bettors } = readActions(view);
  const n = Math.max(1, view.players.filter((x) => x.inHand).length - 1);
  const boardCategory = board.length >= 3 ? category(board) : 0;
  return (i, hole) => {
    let w = 1;
    const pct = preflopPercentile(hole[0], hole[1], n);
    switch (preflop.get(ids[i])) {
      case "raise":
        w *= pct <= 0.3 ? 1 : 0.25;
        break;
      case "call-raise":
        w *= pct <= 0.45 ? 1 : 0.4;
        break;
      case "limp":
      case "check":
        w *= pct > 0.85 ? 0.5 : 1;
        break;
    }
    if (board.length >= 3 && bettors.has(ids[i])) {
      const made = category([...hole, ...board]) > boardCategory;
      const suits = [...hole, ...board].map((c) => c[1]);
      const flushDraw = hole.some((c) => suits.filter((x) => x === c[1]).length >= 4);
      w *= made || flushDraw ? 1 : 0.35;
    }
    return w;
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const uniform = (rng: Rng) => rng.int(1_000_000) / 1_000_000;
const chance = (rng: Rng, p: number) => uniform(rng) < clamp(p, 0, 1);
/** Roughly normal noise with standard deviation 1. */
const noise = (rng: Rng) => (uniform(rng) + uniform(rng) + uniform(rng) - 1.5) * 2;
/** A soft threshold: almost always true well below `edge`, almost never well above it. */
const below = (rng: Rng, x: number, edge: number, width = 0.025) => chance(rng, 1 / (1 + Math.exp((x - edge) / width)));

const check = (): BotMove => ({ t: "act", action: "check" });
const call = (): BotMove => ({ t: "act", action: "call" });
const foldOrCheck = (s: Spot): BotMove => (s.legal.canCheck ? check() : { t: "act", action: "fold" });

/** Raise (or bet) to a total street bet of about `to`, rounded, and shoving rather than leaving a sliver behind. */
function raiseTo(s: Spot, to: number): BotMove {
  const { legal } = s;
  if (!legal.canRaise) return legal.canCheck ? check() : call();
  const step = Math.max(1, Math.round(s.bb / 2));
  let amount = Math.round(to / step) * step;
  amount = clamp(amount, legal.minRaiseTo, legal.maxRaiseTo);
  if (amount >= 0.8 * legal.maxRaiseTo) amount = legal.maxRaiseTo;
  return { t: "act", action: "raise", amount };
}

/** Bet a fraction of the pot (or raise by that much over a call). */
function potBet(s: Spot, fraction: number): BotMove {
  const { legal } = s;
  const afterCall = legal.pot + legal.callAmount;
  // Warm-up hands keep the bets small.
  const f = Math.min(s.warmup ? 0.5 : Infinity, fraction * s.p.sizing * (0.9 + 0.2 * uniform(s.dice)));
  return raiseTo(s, legal.streetBet + legal.callAmount + afterCall * f);
}

type Intent = "fold" | "check" | "call" | "bet";
const intentOf = (m: BotMove): Intent => (m.t !== "act" ? "check" : m.action === "raise" ? "bet" : m.action);

/* ------------------------------------------------------------------ */
/* Preflop                                                             */
/* ------------------------------------------------------------------ */

type Position = "ep" | "mp" | "lp" | "sb" | "bb" | "hu";

function position(view: TableView): Position {
  const dealt = view.players.filter((x) => x.inHand).sort((a, b) => a.seat - b.seat);
  const me = dealt.find((x) => x.isYou)!;
  if (dealt.length === 2) return "hu";
  if (me.isSmallBlind) return "sb";
  if (me.isBigBlind) return "bb";
  const button = dealt.findIndex((x) => x.isButton);
  const fromButton = (button - dealt.indexOf(me) + dealt.length) % dealt.length;
  return fromButton <= 1 ? "lp" : fromButton === 2 ? "mp" : "ep";
}

const OPEN_INDEX: Record<Position, number> = { ep: 0, mp: 1, lp: 2, sb: 3, hu: 4, bb: 2 };

function preflop(s: Spot): BotMove {
  const { view, legal, p, dice, bb } = s;
  const [a, b] = s.hole;
  const pct = preflopPercentile(a, b, s.n);
  const eq = preflopEquity(a, b, s.n);
  const pos = position(view);
  const highest = view.hand!.currentBet;
  // Raises from the log: an all-in call also shows as "All-in" on the seat, but it isn't a raise.
  const raised = readActions(view).raisers;
  const raisers = view.players.filter((x) => !x.isYou && x.inHand && !x.folded && raised.has(x.id)).length;
  const effBB = s.eff / bb;
  const odds = s.toCall / (s.pot + s.toCall);

  // Short stacked: all in or fold.
  if (effBB <= 12) {
    if (highest > bb) return eq >= odds + 0.08 || pct <= 0.08 ? (pct <= 0.05 ? raiseTo(s, legal.maxRaiseTo) : call()) : foldOrCheck(s);
    const folded = view.players.filter((x) => !x.isYou && x.inHand && x.folded).length;
    const base = pos === "hu" ? (effBB <= 5 ? 0.8 : effBB <= 8 ? 0.6 : 0.45) : effBB <= 5 ? 0.55 : effBB <= 8 ? 0.35 : 0.22;
    if (below(dice, pct, base * 1.15 ** folded)) return raiseTo(s, legal.maxRaiseTo);
    return foldOrCheck(s);
  }

  if (highest <= bb) {
    const limpers = view.players.filter((x) => !x.isYou && x.inHand && !x.folded && x.streetBet === bb && !x.isBigBlind).length;
    const openTo = (pos === "hu" ? 2.2 : 2.5 + limpers) * bb * p.sizing;
    if (legal.canCheck) return below(dice, pct, p.open[OPEN_INDEX[pos]] * 0.5) ? raiseTo(s, openTo + bb) : check();
    if (below(dice, pct, p.open[OPEN_INDEX[pos]])) return raiseTo(s, openTo);
    if (below(dice, pct, p.open[OPEN_INDEX[pos]] + p.limp)) return call();
    if (pos === "sb" && below(dice, pct, 0.4 + p.limp)) return call();
    return foldOrCheck(s);
  }

  const raiseSize = highest / bb;
  if (raisers <= 1 && !s.mem.aggressor) {
    const adj = clamp(3 / raiseSize, 0.4, 1.3);
    // No re-raising while the newcomer finds their feet.
    if (below(dice, pct, p.threeBet * adj)) return s.warmup ? call() : threeBet(s, highest, pos);
    const inBigBlind = pos === "bb" || (pos === "hu" && view.players.find((x) => x.isYou)!.isBigBlind);
    const range = p.callRaise * adj + (inBigBlind ? p.bbDefend * adj : 0);
    if (below(dice, pct, range) || (s.toCall <= bb && eq >= odds)) return call();
    return foldOrCheck(s);
  }
  // Facing a re-raise.
  if (pct <= 0.035) return s.warmup ? call() : threeBet(s, highest, pos);
  if (pct <= (effBB > 40 ? 0.1 : 0.06) || eq >= odds + 0.1) return call();
  return foldOrCheck(s);
}

function threeBet(s: Spot, highest: number, pos: Position): BotMove {
  const to = highest * (pos === "lp" || pos === "hu" ? 3 : 3.8);
  // Commit fully rather than raise most of the stack.
  return raiseTo(s, to > 0.4 * (s.chips + s.legal.streetBet) ? s.legal.maxRaiseTo : to);
}

/* ------------------------------------------------------------------ */
/* After the flop                                                      */
/* ------------------------------------------------------------------ */

function postflop(s: Spot, e: number, drawing: boolean): BotMove {
  const { legal, p, dice, n, mem } = s;
  const river = s.street === "river";
  e = clamp(e + noise(dice) * p.wobble, 0, 1);
  const pick = (lo: number, hi: number) => lo + (hi - lo) * uniform(dice);

  if (legal.canCheck) {
    if (e >= 0.58 + 0.07 * (n - 1) - p.valueThin) {
      if (e >= 0.9 && !river && chance(dice, p.slowplay)) return check();
      return potBet(s, river ? pick(0.65, 1) : pick(0.5, 0.75));
    }
    if (mem.aggressor && s.street === "flop" && chance(dice, p.cbet * (n > 1 ? 0.5 : 1))) return potBet(s, pick(0.33, 0.5));
    if (mem.aggressor && s.street === "turn" && e >= 0.35 && chance(dice, p.barrel)) return potBet(s, pick(0.6, 0.75));
    if (drawing && !river && chance(dice, p.semiBluff * 0.5)) return potBet(s, pick(0.5, 0.66));
    if (river && e < 0.25 && n === 1 && chance(dice, p.bluff)) return potBet(s, pick(0.65, 1));
    return check();
  }

  const need = s.toCall / (s.pot + s.toCall);
  const allInCall = s.toCall >= s.chips;
  if (!allInCall && e >= 0.72 + 0.05 * (n - 1) && chance(dice, p.aggression)) return s.warmup ? call() : potBet(s, pick(0.7, 0.9));
  const implied = drawing && !river && s.eff > 3 * s.pot ? (s.street === "flop" ? 0.07 : 0.04) : 0;
  // Warm-up bots call a little lighter, so the newcomer sees more flops and showdowns.
  if (e >= need - implied - p.sticky - (s.warmup ? 0.05 : 0)) return call();
  if (s.toCall <= 0.2 * s.pot && e >= 0.15) return call();
  // Too much in the pot to give up now.
  if (s.mem.startStack - s.chips >= 0.4 * s.mem.startStack && e >= 0.25) return call();
  if (drawing && !river && n === 1 && !allInCall && chance(dice, p.semiBluff * 0.3)) return potBet(s, pick(0.7, 0.9));
  return foldOrCheck(s);
}

/* ------------------------------------------------------------------ */
/* Powers                                                              */
/* ------------------------------------------------------------------ */

interface Idea {
  power: MyPowerView;
  /** Expected chips gained, net of the energy spent. */
  value: number;
  move: BotMove;
  /** Information powers go before the ones that change cards; EMP goes last. */
  order: number;
}

/** Hand evaluations the bot allows itself per decision: a few milliseconds even on a phone. */
const EVAL_BUDGET = 3600;

const byScore = (hole: Card[], board: Card[]) => handScore(hole.concat(board));

/** What the bot would keep from three hole cards, judged only on what it can see now. */
function keepBest(three: Card[], board: Card[], n: number): Card[] {
  const pairs: Card[][] = [
    [three[0], three[1]],
    [three[0], three[2]],
    [three[1], three[2]],
  ];
  const score = (pair: Card[]) => (board.length >= 3 ? byScore(pair, board) : preflopEquity(pair[0], pair[1], n));
  return pairs.reduce((best, pair) => (score(pair) > score(best) ? pair : best));
}

/** The chips a hand is worth from here if the bot plays it sensibly (it can always fold). */
function handValue(s: Spot, e: number): number {
  const potNow = s.pot + s.toCall;
  const future = Math.min(s.eff, 0.45 * s.streetsLeft * potNow);
  return Math.max(0, e * potNow - s.toCall + 0.5 * future * (e - 0.4));
}

/** What a unit of energy is worth in chips right now: cheap when it would overflow, dear when running low. */
function energyPrice(s: Spot): number {
  const me = s.view.me!;
  const r = s.view.rules;
  const scarcity = me.energy + r.energyPerHand > r.maxEnergy ? 0.35 : clamp(1.4 - me.energy / r.maxEnergy, 0.5, 1.4);
  return 0.28 * s.bb * s.p.thrift * scarcity;
}

const CLONE_TIER: Partial<Record<PowerType, number>> = {
  upgrade: 1.2,
  engineer: 1.2,
  reload: 1,
  disintegrate: 0.9,
  scanner: 0.9,
  emp: 0.8,
  deploy: 0.6,
  intel: 0.6,
  xray: 0.5,
};

function powerIdeas(s: Spot, e: number, intent: Intent, base: number[] | null, worlds: World[] | null): Idea[] {
  const me = s.view.me!;
  const h = s.view.hand!;
  const playable = me.powers.filter((x) => x.playable && x.cost <= me.energy);
  const ideas: Idea[] = [];
  const price = energyPrice(s);
  const potFinal = s.pot + s.toCall + Math.min(s.eff, 0.45 * s.streetsLeft * (s.pot + s.toCall));
  const need = s.toCall / (s.pot + s.toCall);
  const continuing = s.legal.canCheck || e >= need - 0.05;
  const has = (t: PowerType) => playable.some((x) => x.type === t);
  const hasUpgrade = has("upgrade");
  const add = (power: MyPowerView, chipsGained: number, move: BotMove, order: number) => {
    const novel = s.mem.seen.has(power.type) ? 1 : s.warmup ? 0.35 : 0.5;
    const value = chipsGained * (s.p.affinity[power.type] ?? 1) - power.cost * price * novel;
    if (value > 0) ideas.push({ power, value, move, order });
  };
  /** Chips gained from a measured change in equity, if it's clearly more than noise. */
  const measured = (outcome: Outcome, minGain: number): number | null => {
    if (!worlds || !base) return null;
    const { gain, se } = pairedGain(base, shares(worlds, outcome));
    if (gain - 1.5 * se <= minGain) return null;
    return handValue(s, e + gain) - handValue(s, e);
  };
  const rest = (w: World, from: number, extra: Card[] = []) => [...s.board, ...extra, ...w.stream.slice(from, from + s.toCome)];
  const exposed = me.hole.map((c) => c.exposed);

  for (const power of playable) {
    const move: BotMove = { t: "power", powerId: power.id };
    switch (power.type) {
      case "xray": {
        const hidden = s.view.players.some((x) => !x.isYou && x.inHand && !x.folded && !x.hole.some((c) => c.exposed));
        if (!hidden || e > 0.9) break;
        let closeness = 0;
        if (s.toCall >= 0.25 * s.pot) closeness = Math.max(0, 1 - Math.abs(e - need) / 0.15);
        else if (s.legal.canCheck && s.street !== "preflop") closeness = s.mem.aggressor ? 0.5 : 0.25;
        const reveal = s.n === 1 ? 1 : Math.min(1.2, 0.6 + 0.2 * (s.n - 1)) * 0.85 ** (s.n - 1);
        add(power, 0.12 * potFinal * closeness * reveal, move, 0);
        break;
      }
      case "intel": {
        if (!continuing || s.streetsLeft === 0 || me.intelTop) break;
        const combos = (["deploy", "disintegrate", "reload", "upgrade", "scanner"] as PowerType[]).filter(has).length;
        add(power, potFinal * 0.02 * s.streetsLeft * (1 + 0.5 * combos) * (s.street === "preflop" ? 0.6 : 1), move, 0);
        break;
      }
      case "scanner": {
        if (s.street === "preflop" || s.toCome === 0 || !continuing) break;
        // In each world the bot sees the next two cards and throws the first away if the second suits it better.
        const chips = measured((w) => {
          const [c0, c1] = w.stream;
          const discard = byScore(s.hole, [...s.board, c0]) < byScore(s.hole, [...s.board, c1]);
          const stream = discard ? w.stream.slice(1) : w.stream;
          return { hole: s.hole, board: [...s.board, ...stream.slice(0, s.toCome)] };
        }, 0.01);
        add(power, (chips ?? 0) + 0.015 * potFinal * s.streetsLeft, move, 0);
        break;
      }
      case "engineer": {
        if (s.street === "preflop" || s.toCome === 0 || !continuing) break;
        const chips = measured((w) => {
          const options = w.stream.slice(0, 3);
          const pick = options.reduce((x, y) => (byScore(s.hole, [...s.board, y]) > byScore(s.hole, [...s.board, x]) ? y : x));
          return { hole: s.hole, board: [...s.board, pick, ...w.stream.slice(3, 3 + s.toCome - 1)] };
        }, 0.02);
        // Everyone sees the options, which gives the plan away a little.
        if (chips) add(power, chips * 0.85, move, 2);
        break;
      }
      case "reload": {
        if (s.street === "preflop") {
          const [a, b] = s.hole;
          const now = preflopEquity(a, b, s.n);
          const options: [number[], number][] = [[[0, 1], averagePreflopEquity(s.n)]];
          if (!hasUpgrade) for (const i of [0, 1]) options.push([[i], meanReplace(s.hole[1 - i], s.hole, s.n)]);
          const [indices, after] = options.reduce((x, y) => (y[1] > x[1] ? y : x));
          const bonus = indices.some((i) => exposed[i]) ? 0.02 * potFinal : 0;
          if (after - now > 0.03) add(power, handValue(s, after) - handValue(s, now) + bonus, { ...move, indices }, 2);
          break;
        }
        const options = hasUpgrade ? [[0, 1]] : [[0], [1], [0, 1]];
        let best: { chips: number; indices: number[] } | null = null;
        for (const indices of options) {
          const chips = measured((w) => {
            const hole = s.hole.map((c, i) => (indices.includes(i) ? w.stream[indices.indexOf(i)] : c));
            return { hole, board: rest(w, indices.length) };
          }, 0.02);
          const bonus = indices.some((i) => exposed[i]) ? 0.02 * potFinal : 0;
          if (chips !== null && (!best || chips + bonus > best.chips)) best = { chips: chips + bonus, indices };
        }
        if (best) add(power, best.chips, { ...move, indices: best.indices }, 2);
        break;
      }
      case "upgrade": {
        const bonus = exposed.some(Boolean) ? 0.02 * potFinal : 0;
        if (s.street === "preflop") {
          const [a, b] = s.hole;
          const now = preflopEquity(a, b, s.n);
          const after = meanUpgrade(s.hole, s.n);
          if (after - now > 0.02) add(power, handValue(s, after) - handValue(s, now) + bonus, move, 2);
          break;
        }
        const chips = measured((w) => ({ hole: keepBest([...s.hole, w.stream[0]], s.board, s.n), board: rest(w, 1) }), 0.02);
        if (chips !== null) add(power, chips + bonus, move, 2);
        break;
      }
      case "disintegrate": {
        let best: { chips: number; target: number } | null = null;
        for (let target = 0; target < h.board.length; target++) {
          const card = h.board[target];
          if (!card.current || card.locked) continue;
          const chips = measured((w) => {
            const board = s.board.map((c, i) => (i === target ? w.stream[0] : c));
            return { hole: s.hole, board: [...board, ...w.stream.slice(1, 1 + s.toCome)] };
          }, 0.03);
          if (chips !== null && (!best || chips > best.chips)) best = { chips, target };
        }
        if (best) add(power, best.chips, { ...move, target: best.target }, 2);
        break;
      }
      case "deploy": {
        if (s.street === "preflop") break;
        const chips = measured((w) => ({ hole: s.hole, board: rest(w, 1, [w.stream[0]]) }), 0.03);
        if (chips !== null) add(power, chips, move, 2);
        break;
      }
      case "emp": {
        if (s.warmup || h.empBy) break;
        if (intent !== "bet" && !(intent === "call" && s.toCall >= 0.3 * s.pot)) break;
        if (e < 0.55 || (s.street === "preflop" && s.pot < 8 * s.bb)) break;
        const threats = s.view.players.filter((x) => !x.isYou && x.inHand && !x.folded && !x.allIn && x.energy >= 2 && x.powerCount > 0);
        if (!threats.length) break;
        const hit = 1 - threats.reduce((q, x) => q * (1 - Math.min(0.8, 0.35 + 0.025 * x.energy)), 1);
        const damage = s.street === "preflop" ? 0.06 : s.street === "flop" ? 0.1 : s.street === "turn" ? 0.14 : 0.18;
        add(power, potFinal * e * damage * hit, move, 3);
        break;
      }
      case "clone": {
        const last = h.lastPower;
        if (!last || intent === "fold") break;
        const copyCost = s.view.costs[last] ?? 3;
        const slack = me.energy - power.cost >= copyCost || me.energy + s.view.rules.energyPerHand > s.view.rules.maxEnergy ? 1 : 0.5;
        add(power, (CLONE_TIER[last] ?? 0.6) * s.bb * 3 * slack, move, 1);
        break;
      }
    }
  }
  return ideas;
}

/** Preflop equity after swapping one card for a random one. */
function meanReplace(keep: Card, hole: Card[], n: number): number {
  const unseen = fullDeck().filter((c) => !hole.includes(c));
  return unseen.reduce((sum, x) => sum + preflopEquity(keep, x, n), 0) / unseen.length;
}

/** Preflop equity after drawing a third card and keeping the best two. */
function meanUpgrade(hole: Card[], n: number): number {
  const [a, b] = hole;
  const unseen = fullDeck().filter((c) => !hole.includes(c));
  const now = preflopEquity(a, b, n);
  return unseen.reduce((sum, x) => sum + Math.max(now, preflopEquity(a, x, n), preflopEquity(b, x, n)), 0) / unseen.length;
}

/* ------------------------------------------------------------------ */
/* Follow-up choices                                                   */
/* ------------------------------------------------------------------ */

function worldsFor(
  s: { hole: Card[]; board: Card[]; opponents: (Card | null)[][]; rng: Rng; accept?: (i: number, hole: Card[]) => number },
  prefix: Card[],
  dead: Card[],
  streamLength: number,
  outcomes: number,
  budget = EVAL_BUDGET,
): World[] {
  const count = clamp(Math.round(budget / ((1 + s.opponents.length) * outcomes)), 60, 300);
  return sampleWorlds({ seen: [...s.hole, ...s.board], opponents: s.opponents, prefix, dead, streamLength, count, rng: s.rng, accept: s.accept });
}

function followUp(view: TableView, mem: BotMemory, rng: Rng): BotMove | null {
  const me = view.me!;
  const h = view.hand!;
  const live = view.players.filter((x) => !x.isYou && x.inHand && !x.folded);
  const hole = me.hole.map((c) => c.card);
  const board = h.board.map((b) => b.card);
  const opponents = live.map((x) => x.hole.map((c) => c.card));
  const toCome = Math.max(0, 5 - h.board.filter((b) => !b.deployed).length);
  const ctx = { hole, board, opponents, rng, accept: rangeReader(view, live.map((x) => x.id), board) };
  const best = (outcomes: Outcome[], worlds: World[]) => {
    const results = outcomes.map((o) => shares(worlds, o));
    let index = 0;
    for (let i = 1; i < results.length; i++) if (mean(results[i]) > mean(results[index])) index = i;
    return { index, results };
  };

  if (me.scanner) {
    const [a, b] = me.scanner;
    const worlds = worldsFor(ctx, [a, b], mem.dead, toCome + 2, 3);
    const run = (stream: Card[]) => ({ hole, board: [...board, ...stream.slice(0, toCome)] });
    const outcomes: Outcome[] = [(w) => run(w.stream), (w) => run(w.stream.slice(1)), (w) => run([w.stream[0], ...w.stream.slice(2)])];
    const { index, results } = best(outcomes, worlds);
    // Keeping both is the default: it gives nothing away and the bot still knows the next two cards.
    const { gain, se } = pairedGain(results[0], results[index]);
    const discard = index > 0 && gain > Math.max(0.015, 1.5 * se) ? index - 1 : null;
    mem.prefix = discard === null ? [a, b] : [discard === 0 ? b : a];
    if (discard !== null) mem.dead.push(discard === 0 ? a : b);
    mem.deckCount = h.deckCount - (discard === null ? 0 : 1);
    return { t: "choose", index: discard };
  }
  if (me.upgrade) {
    const options = [0, 1, 2].map((d) => hole.filter((_, i) => i !== d));
    let index: number;
    if (board.length === 0) {
      const eqs = options.map((pair) => preflopEquity(pair[0], pair[1], opponents.length));
      index = eqs.indexOf(Math.max(...eqs));
    } else {
      const worlds = worldsFor(ctx, mem.prefix, mem.dead, toCome, 3);
      index = best(
        options.map((pair) => (w: World) => ({ hole: pair, board: [...board, ...w.stream.slice(0, toCome)] })),
        worlds,
      ).index;
    }
    mem.dead.push(hole[index]);
    return { t: "choose", index };
  }
  if (me.engineer) {
    const options = me.engineer;
    const worlds = worldsFor(ctx, [], [...mem.dead, ...options], Math.max(0, toCome - 1), options.length);
    const { index } = best(
      options.map((card) => (w: World) => ({ hole, board: [...board, card, ...w.stream.slice(0, toCome - 1)] })),
      worlds,
    );
    // The chosen card goes back on top (everyone knows it); the other two are out of play.
    mem.prefix = [options[index]];
    mem.dead.push(...options.filter((_, i) => i !== index));
    return { t: "choose", index };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The policy                                                          */
/* ------------------------------------------------------------------ */

/** A decision and the numbers behind it (the Hint shows them). */
export interface Thought {
  move: BotMove;
  /** The power it would play first, if any (then `move` is that power). */
  power: PowerType | null;
  /** Its share of the pot, and the share it needs to call. */
  equity: number;
  need: number;
  /** Preflop: how good the starting hand is (0 = best). */
  percentile: number | null;
}

interface ThinkOptions {
  /** Play gently (bots in the first hands; never the coach). */
  warmup?: boolean;
  /** Budget of hand evaluations per decision. */
  budget?: number;
  /** Always consider powers (the coach), rather than only when in the mood. */
  eager?: boolean;
}

function think(view: TableView, p: Personality, mem: BotMemory, rng: Rng, dice: Rng, opts: ThinkOptions = {}): Thought | null {
  const me = view.me!;
  const s = spotFor(view, p, mem, rng, dice, opts.warmup ?? view.handNumber <= WARMUP_HANDS);
  if (!s) return null;

  // An EMP is only ever played to protect a bet: make that bet now.
  if (mem.plan && mem.plan.street === s.street) {
    const planned = mem.plan.move;
    mem.plan = null;
    if (planned.t === "act" && (planned.action === "call" ? s.toCall > 0 : s.legal.canRaise)) {
      const move = planned.action === "raise" ? raiseTo(s, planned.amount ?? s.legal.minRaiseTo) : planned;
      return { move, power: null, equity: 0.5, need: 0, percentile: null };
    }
  }

  let e: number;
  let drawing = false;
  let worlds: World[] | null = null;
  let base: number[] | null = null;
  const maxPowers = s.warmup ? 1 : p.maxPowers;
  const canPower =
    mem.powersThisStreet < maxPowers &&
    mem.powersThisHand < (s.warmup ? 1 : 3) &&
    me.powers.some((x) => x.playable && x.cost <= me.energy);
  const wasteSoon = me.energy + view.rules.energyPerHand > view.rules.maxEnergy;
  const considerPowers = canPower && (opts.eager || wasteSoon || chance(dice, p.appetite));
  const need = s.toCall / (s.pot + s.toCall);

  if (s.street === "preflop") {
    e = preflopEquity(s.hole[0], s.hole[1], s.n);
  } else {
    worlds = worldsFor(s, s.known, mem.dead, s.toCome + 3, 2 + (considerPowers ? 6 : 0), opts.budget);
    base = shares(worlds, (w) => ({ hole: s.hole, board: [...s.board, ...w.stream.slice(0, s.toCome)] }));
    e = mean(base);
    // A hand that needs the cards to come.
    if (s.toCome > 0 && e < 0.55) drawing = e - mean(shares(worlds, () => ({ hole: s.hole, board: s.board }))) > 0.08;
  }
  const percentile = s.street === "preflop" ? preflopPercentile(s.hole[0], s.hole[1], s.n) : null;

  const bet = s.street === "preflop" ? preflop(s) : postflop(s, e, drawing);
  if (considerPowers) {
    const ideas = powerIdeas(s, e, intentOf(bet), base, worlds);
    if (ideas.length) {
      // Information first, then Clone, then the powers that change cards, and EMP just before the bet.
      ideas.sort((x, y) => x.order - y.order || y.value - x.value);
      const idea = ideas[0];
      mem.powersThisStreet++;
      mem.powersThisHand++;
      // Cards this power sends to the muck are known to be out of play.
      const m = idea.move;
      if (m.t === "power" && idea.power.type === "reload") for (const i of m.indices ?? []) mem.dead.push(s.hole[i]);
      if (m.t === "power" && idea.power.type === "disintegrate" && m.target !== undefined) mem.dead.push(s.board[m.target]);
      if (idea.power.type === "emp") mem.plan = { street: s.street, move: bet };
      return { move: idea.move, power: idea.power.type, equity: e, need, percentile };
    }
  }
  if (s.street === "preflop" && bet.t === "act") {
    if (bet.action === "raise") mem.aggressor = true;
    else if (bet.action === "call") mem.aggressor = false;
  }
  return { move: bet, power: null, equity: e, need, percentile };
}

/**
 * The practice bot. It sees exactly what a human in its seat would (its own TableView) plus its own notes.
 * Order of business: rebuy, finish a power's follow-up choice, maybe play a power, then bet.
 */
export const practiceBot: BotPolicy = (view, rng, profile, memory) => {
  const me = view.me;
  if (!me) return null;
  if (me.rebuy) return { t: "rebuy", accept: true };
  const mem = memory ?? newBotMemory();
  observe(mem, view);
  if (me.scanner || me.upgrade || me.engineer) return followUp(view, mem, rng);
  return think(view, PERSONALITIES[profile % PERSONALITIES.length], mem, rng, rng)?.move ?? null;
};

/** A steady, honest player: no bluffs, no moods, the same advice every time. */
const COACH: Personality = {
  ...PERSONALITIES[3],
  name: "Coach",
  limp: 0,
  aggression: 1,
  bluff: 0,
  semiBluff: 0,
  valueThin: 0,
  sticky: 0,
  slowplay: 0,
  sizing: 1,
  wobble: 0,
  appetite: 1,
  thrift: 1,
  maxPowers: 3,
  affinity: {},
};

/** Always lands in the middle, so every "maybe" in the policy resolves the same way. */
const MIDPOINT: Rng = { int: (max) => Math.floor(max / 2) };

/**
 * What the coach would do in the player's seat, from the player's own view only. `memory` should be kept
 * for the player across calls, so it knows what their own Scanner showed them.
 */
export function advise(view: TableView, memory: BotMemory, rng: Rng): Thought | null {
  if (!view.me?.legal) return null;
  // The coach's notes are a copy: asking for a hint mustn't change the bots' idea of what happened.
  const mem = { ...memory, prefix: [...memory.prefix], dead: [...memory.dead], seen: new Set(memory.seen) };
  observe(mem, view);
  return think(view, COACH, mem, rng, MIDPOINT, { budget: 6000, eager: true, warmup: false });
}

/** Keep the player's notes up to date with what they can see now, for the Hint. */
export function observePlayer(memory: BotMemory, view: TableView): void {
  observe(memory, view);
}

/** Remember whether the player took the lead preflop, so the Hint knows when a continuation bet makes sense. */
export function notePlayerAction(memory: BotMemory, view: TableView, action: string): void {
  if (view.hand?.street !== "preflop") return;
  if (action === "raise") memory.aggressor = true;
  else if (action === "call") memory.aggressor = false;
}

/** Keep the player's own notes up to date (what their Scanner showed), for the Hint. */
export function notePlayerChoice(memory: BotMemory, view: TableView, index: number | null): void {
  const me = view.me;
  const h = view.hand;
  if (!me?.scanner || !h) return;
  observe(memory, view);
  const [a, b] = me.scanner;
  memory.prefix = index === null ? [a, b] : [index === 0 ? b : a];
  if (index !== null) memory.dead.push(index === 0 ? a : b);
  memory.deckCount = h.deckCount - (index === null ? 0 : 1);
}
