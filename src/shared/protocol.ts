import type { Card } from "./cards";
import type { GameMode, ModeRules, PowerType } from "./powers";
import type { BlindLevel, TableSettings } from "./settings";

export type Street = "preflop" | "flop" | "turn" | "river";
export type TableStatus = "lobby" | "running" | "finished";
/** waiting = in the lobby, playing = has chips, busted = deciding on a rebuy, out = eliminated. */
export type PlayerStatus = "waiting" | "playing" | "busted" | "out";
export type HandPhase = "betting" | "runout" | "done";
export type PendingKind = "scanner" | "upgrade" | "engineer";

export interface LogEntry {
  seq: number;
  at: number;
  kind: "action" | "power" | "deal" | "win" | "system" | "level";
  text: string;
  playerId?: string;
  power?: PowerType;
}

/** A hole card as seen by someone else: `card` is null while face down. */
export interface HoleCardView {
  card: Card | null;
  exposed: boolean;
}

export interface PlayerView {
  id: string;
  name: string;
  seat: number;
  isHost: boolean;
  isYou: boolean;
  connected: boolean;
  status: PlayerStatus;
  chips: number;
  energy: number;
  powerCount: number;
  rebuysUsed: number;
  place: number | null;
  away: boolean;
  rebuyDeadline: number | null;
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  streetBet: number;
  lastAction: string | null;
  hole: HoleCardView[];
  isButton: boolean;
  isSmallBlind: boolean;
  isBigBlind: boolean;
  isTurn: boolean;
  intel: boolean;
  /** Showdown info. */
  handLabel: string | null;
  bestCards: Card[] | null;
  won: number;
}

export interface BoardCardView {
  card: Card;
  street: Street;
  deployed: boolean;
  locked: boolean;
  /** Dealt on the current street (so Disintegrate can target it). */
  current: boolean;
}

export interface PotView {
  amount: number;
  winners: string[];
}

export interface HandView {
  number: number;
  street: Street;
  phase: HandPhase;
  board: BoardCardView[];
  /** All chips committed this hand, including the current street's bets. */
  pot: number;
  pots: PotView[] | null;
  currentBet: number;
  toAct: string | null;
  turnDeadline: number | null;
  /** Player whose EMP is active on this street. */
  empBy: string | null;
  deploysLeft: number;
  /** Top card of the deck when everyone knows it (after Engineer). */
  knownTop: Card | null;
  /** Engineer options are public while the choice is pending. */
  engineer: { by: string; cards: Card[] } | null;
  pending: { by: string; kind: PendingKind } | null;
  deckCount: number;
  /** The power Clone would copy right now. */
  lastPower: PowerType | null;
}

export interface MyPowerView {
  id: string;
  type: PowerType;
  cost: number;
  playable: boolean;
  reason: string | null;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  /** Chips needed to call (0 if nothing to call). */
  callAmount: number;
  canRaise: boolean;
  /** Raise amounts are the total street bet ("raise to"). */
  minRaiseTo: number;
  maxRaiseTo: number;
  /** True when opening the betting (bet) rather than raising. */
  isBet: boolean;
  pot: number;
  streetBet: number;
}

export interface MeView {
  id: string;
  hole: { card: Card; exposed: boolean }[];
  powers: MyPowerView[];
  energy: number;
  intelTop: Card | null;
  scanner: Card[] | null;
  upgrade: boolean;
  engineer: Card[] | null;
  legal: LegalActions | null;
  handLabel: string | null;
  rebuy: { deadline: number; remaining: number } | null;
}

export interface LevelView extends BlindLevel {
  index: number;
  /** When the next level starts (absolute server time), null while paused or not started. */
  endsAt: number | null;
  remainingMs: number;
  next: BlindLevel;
}

export interface TableView {
  id: string;
  settings: TableSettings;
  status: TableStatus;
  paused: boolean;
  /** Paused because everyone left; any player can resume. */
  autoPaused: boolean;
  /** Mode in play (or that would be played with the current lobby). */
  mode: GameMode;
  rules: ModeRules;
  costs: Record<PowerType, number>;
  hostId: string;
  youId: string | null;
  serverNow: number;
  level: LevelView;
  players: PlayerView[];
  hand: HandView | null;
  me: MeView | null;
  log: LogEntry[];
  nextHandAt: number | null;
  handNumber: number;
  winnerId: string | null;
}

export type ActionType = "fold" | "check" | "call" | "raise";

export type ClientMessage =
  | { t: "hello"; token?: string }
  | { t: "join"; name: string }
  | { t: "leave" }
  | { t: "kick"; playerId: string }
  | { t: "start" }
  | { t: "act"; action: ActionType; amount?: number }
  /** target: board index for Disintegrate. indices: hole card indices for Reload. */
  | { t: "power"; powerId: string; target?: number; indices?: number[] }
  /** Scanner: index to discard or null to keep both. Upgrade: hole index to discard. Engineer: option to keep. */
  | { t: "choose"; index: number | null }
  | { t: "rebuy"; accept: boolean }
  | { t: "back" }
  | { t: "pause" }
  | { t: "resume" }
  | { t: "rematch" };

export type ServerMessage =
  | { t: "state"; view: TableView }
  | { t: "joined"; playerId: string; token: string }
  | { t: "error"; message: string }
  | { t: "notfound" };
