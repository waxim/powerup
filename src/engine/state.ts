import type { Card } from "../shared/cards";
import type { GameMode, PowerType } from "../shared/powers";
import type { HandPhase, LogEntry, PlayerStatus, Street, TableStatus } from "../shared/protocol";
import type { TableSettings } from "../shared/settings";

/**
 * The complete, authoritative state of one table. It is plain JSON so the Durable Object can
 * persist it as a single value. Hidden information (deck, hole cards, tokens) lives here and
 * must only leave the server through `buildView`.
 */
export interface TableState {
  v: 1;
  id: string;
  createdAt: number;
  lastActivityAt: number;
  settings: TableSettings;
  status: TableStatus;
  paused: boolean;
  pausedAt: number | null;
  /** Paused automatically because every player disconnected; any player may resume. */
  autoPaused: boolean;
  /** Since when no player has been connected (maintained by the Durable Object). */
  emptySince: number | null;
  hostId: string;
  /** Decided when the game starts (by player count). */
  mode: GameMode | null;
  players: Player[];
  handNumber: number;
  buttonSeat: number;
  level: number;
  levelEndsAt: number;
  hand: Hand | null;
  nextHandAt: number | null;
  winnerId: string | null;
  log: LogEntry[];
  logSeq: number;
}

export interface PowerCard {
  id: string;
  type: PowerType;
}

export interface Player {
  id: string;
  /** Secret that proves who you are; kept in the browser's localStorage. */
  token: string;
  name: string;
  seat: number;
  status: PlayerStatus;
  chips: number;
  energy: number;
  powers: PowerCard[];
  rebuysUsed: number;
  place: number | null;
  /** Timed out; their turns are acted automatically until they come back. */
  away: boolean;
  rebuyDeadline: number | null;
  rebuyDeclined: boolean;
  /** Stack at the start of the last hand they played (decides elimination order). */
  handStartChips: number;
  joinedAt: number;
}

export interface HoleCard {
  card: Card;
  exposed: boolean;
}

export interface HandPlayer {
  id: string;
  seat: number;
  hole: HoleCard[];
  folded: boolean;
  allIn: boolean;
  streetBet: number;
  totalBet: number;
  /** Has taken a voluntary action this street. */
  acted: boolean;
  /** Value of `fullRaiseSeq` when they last acted; a later full raise lets them raise again. */
  actedSeq: number;
  lastAction: string | null;
  intel: boolean;
  showCards: boolean;
}

export interface BoardCard {
  card: Card;
  street: Street;
  deployed: boolean;
  /** Protected by an all-in shield. */
  locked: boolean;
}

export type PendingChoice =
  | { kind: "scanner"; playerId: string; cards: Card[] }
  | { kind: "upgrade"; playerId: string }
  | { kind: "engineer"; playerId: string; cards: Card[] };

export interface PotResult {
  amount: number;
  eligible: string[];
  winners: { id: string; amount: number }[];
}

export interface HandResult {
  showdown: boolean;
  pots: PotResult[];
  hands: Record<string, { label: string; best: Card[] }>;
  won: Record<string, number>;
}

export interface Hand {
  number: number;
  /** deck[0] is the next card to be dealt. */
  deck: Card[];
  muck: Card[];
  board: BoardCard[];
  street: Street;
  phase: HandPhase;
  /** Players dealt into this hand, in seat order. */
  players: HandPlayer[];
  buttonSeat: number;
  sbSeat: number;
  bbSeat: number;
  sb: number;
  bb: number;
  currentBet: number;
  /** Size of the last full bet/raise; the minimum raise increment. */
  minRaise: number;
  fullRaiseSeq: number;
  toAct: string | null;
  turnDeadline: number | null;
  empStreet: Street | null;
  empBy: string | null;
  deploys: number;
  powerHistory: { playerId: string; type: PowerType }[];
  /** Publicly known top card after an Engineer. */
  knownTop: Card | null;
  pending: PendingChoice | null;
  nextStepAt: number | null;
  result: HandResult | null;
}
