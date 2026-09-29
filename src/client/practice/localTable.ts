import { applyPlayerMessage, isPlayerMessage } from "../../engine/dispatch";
import { handScore } from "../../engine/evaluator";
import { Game, GameError } from "../../engine/game";
import { seededRng, type Rng } from "../../engine/rng";
import { buildView } from "../../engine/view";
import { modeForPlayers, type PowerType } from "../../shared/powers";
import type { ClientMessage, TableView } from "../../shared/protocol";
import { UNLIMITED_REBUYS, cleanName } from "../../shared/settings";
import { advise, newBotMemory, notePlayerChoice, pickOpponents, type BotMemory, type Thought } from "./bot";
import { Curriculum } from "./curriculum";

/** What a bot wants to do next. Mirrors the client messages a human would send. */
export type BotMove =
  | { t: "act"; action: "fold" | "check" | "call" | "raise"; amount?: number }
  | { t: "power"; powerId: string; target?: number; indices?: number[] }
  | { t: "choose"; index: number | null }
  | { t: "rebuy"; accept: boolean };

/**
 * A bot decides from its own view of the table only (a private copy), so it can never see hidden cards.
 * `profile` picks its personality; `memory` is its own notes from earlier decisions.
 */
export type BotPolicy = (view: TableView, rng: Rng, profile: number, memory?: BotMemory) => BotMove | null;

export interface PracticeConfig {
  name: string;
  /** 1 to 5 computer players. */
  opponents: number;
  /** The session ends after this many orbits (one orbit = one hand per player). */
  orbits: number;
  /** Seeds the deck and the bots, so a session can be replayed. */
  seed: number;
  startingChips?: number;
  startingSmallBlind?: number;
  levelMinutes?: number;
  turnSeconds?: number;
}

export const PRACTICE_DEFAULTS = {
  startingChips: 1500,
  startingSmallBlind: 10,
  levelMinutes: 4,
  turnSeconds: 90,
} as const;

export type SessionEnd = "orbits" | "out" | "finished" | "left";

/** What the human did this session, for the summary. Recorded as hands finish (the log is truncated). */
export interface PracticeStats {
  hands: number;
  handsWon: number;
  /** The biggest pot the human won: its size, their hand (if shown) and the powers they played in it. */
  biggestPot: { amount: number; label: string | null; powers: PowerType[] } | null;
  /** The best hand the human showed down. */
  bestHand: { label: string; score: number } | null;
  powersPlayed: Partial<Record<PowerType, number>>;
  powersFaced: Partial<Record<PowerType, number>>;
}

interface BotSeat {
  id: string;
  name: string;
  profile: number;
  memory: BotMemory;
}

type BotTask = { id: string; kind: "turn" | "choice" | "rebuy" };

/** A bot starts deciding this soon after its turn begins, then "thinks" for a time that suits its decision. */
const DECIDE_MS = 150;
const MAX_THINK_MS = 3500;

/**
 * A complete table running in the browser: the real game engine, the human's seat and the bot seats.
 * It produces the same TableView a real table would, so the normal table UI renders it unchanged, and it
 * never touches the server.
 *
 * It keeps no timers of its own: the caller passes the time in and asks `nextWakeAt()` when to come back.
 * `advance()` then runs every due event one at a time, each at its own timestamp, so a late wake-up replays
 * events in order instead of collapsing them.
 */
export class LocalTable {
  readonly game: Game;
  readonly humanId: string;
  readonly bots: readonly BotSeat[];
  readonly stats: PracticeStats = { hands: 0, handsWon: 0, biggestPot: null, bestHand: null, powersPlayed: {}, powersFaced: {} };
  handLimit: number;
  ended: SessionEnd | null = null;
  /** Bot moves the engine rejected (a bot bug); tests require this to stay 0. */
  fallbacks = 0;

  private readonly botRng: Rng;
  private readonly hintRng: Rng;
  private readonly allIds: Set<string>;
  /** The bot whose move is next: first it decides, then the move is applied after its thinking time. */
  private botDue: (BotTask & { at: number; seq: number; move?: BotMove }) | null = null;
  /** The human's own notes (what their Scanner showed them), so the Hint knows it too. */
  private readonly humanMemory = newBotMemory();
  /** Bots whose last move was a power, so their next move waits until the announcement has been read. */
  private readonly afterPower = new Set<string>();
  private recordedHand = 0;

  constructor(
    readonly config: PracticeConfig,
    now: number,
    private readonly policy: BotPolicy,
  ) {
    const opponents = Math.min(5, Math.max(1, Math.round(config.opponents)));
    const name = cleanName(config.name) || "Player";
    const curriculum = new Curriculum(modeForPlayers(opponents + 1));
    const { game, host } = Game.create({
      id: "practice",
      settings: {
        name: "Practice",
        maxSeats: opponents + 1,
        startingChips: config.startingChips ?? PRACTICE_DEFAULTS.startingChips,
        startingSmallBlind: config.startingSmallBlind ?? PRACTICE_DEFAULTS.startingSmallBlind,
        levelMinutes: config.levelMinutes ?? PRACTICE_DEFAULTS.levelMinutes,
        turnSeconds: config.turnSeconds ?? PRACTICE_DEFAULTS.turnSeconds,
        rebuys: UNLIMITED_REBUYS,
      },
      hostName: name,
      now,
      rng: seededRng(config.seed),
      hooks: curriculum,
    });
    // Powers are first dealt when the game starts, so the curriculum knows who the player is in time.
    curriculum.humanId = host.id;
    this.game = game;
    this.humanId = host.id;
    this.bots = pickOpponents(host.name, opponents).map((b) => ({ ...b, id: game.join(b.name, now).id, memory: newBotMemory() }));
    this.allIds = new Set(game.s.players.map((p) => p.id));
    this.botRng = seededRng(config.seed ^ 0x5bd1e995);
    this.hintRng = seededRng(config.seed ^ 0x2545f491);
    this.handLimit = Math.max(1, config.orbits) * game.s.players.length;
    game.start(host.id, now);
    this.afterChange(now);
  }

  view(now: number): TableView {
    return buildView(this.game, this.humanId, now, this.allIds);
  }

  /** Apply a message from the human player, exactly as a real table would. Throws GameError if it's refused. */
  send(msg: ClientMessage, now: number): void {
    this.advance(now);
    if (this.ended) throw new GameError("This practice session is over");
    if (!isPlayerMessage(msg) || msg.t === "start" || msg.t === "rematch") throw new GameError("Not available in practice");
    const before = structuredClone(this.game.s);
    const scanner = msg.t === "choose" && this.game.s.hand?.pending?.kind === "scanner" ? this.view(now) : null;
    try {
      applyPlayerMessage(this.game, this.humanId, msg, now);
    } catch (err) {
      // Roll back anything a refused move half-did, as the server does.
      this.game.s = before;
      throw err;
    }
    if (scanner && msg.t === "choose") notePlayerChoice(this.humanMemory, scanner, msg.index);
    this.afterChange(now);
  }

  /** What the coach would do in the player's seat right now (only from what the player can see). */
  advise(now: number): Thought | null {
    if (this.ended) return null;
    return advise(structuredClone(this.view(now)), this.humanMemory, this.hintRng);
  }

  /** The player walks away; the summary shows what they did so far. */
  leave(): void {
    if (this.ended) return;
    this.ended = "left";
    this.botDue = null;
  }

  /** Run everything due up to `now`, in time order. Returns true if anything happened. */
  advance(now: number): boolean {
    let changed = false;
    for (let guard = 0; guard < 1000 && !this.ended; guard++) {
      const end = this.sessionEndAt();
      const engine = this.game.nextWakeAt();
      const bot = this.botDue?.at ?? null;
      const t = minOf(end, engine, bot);
      if (t === null || t > now) break;
      changed = true;
      if (end !== null && end <= t) {
        this.ended = "orbits";
        this.botDue = null;
        break;
      }
      // Bots go first on a tie, so a timer never beats a bot that was already due.
      if (bot !== null && bot <= t) this.stepBot(t);
      else this.game.tick(t);
      this.afterChange(t);
    }
    return changed;
  }

  /** When `advance` next has something to do, or null if nothing will happen until the human acts. */
  nextWakeAt(): number | null {
    if (this.ended) return null;
    return minOf(this.sessionEndAt(), this.game.nextWakeAt(), this.botDue?.at ?? null);
  }

  /** Carry on for more orbits after the session ended. */
  extend(orbits = 1): void {
    if (this.ended !== "orbits") return;
    this.handLimit += orbits * this.game.s.players.length;
    this.ended = null;
  }

  /** The last hand ends the session when its result has been shown, i.e. when the next hand would be dealt. */
  private sessionEndAt(): number | null {
    const s = this.game.s;
    if (s.status !== "running" || s.paused || s.handNumber < this.handLimit) return null;
    if (s.hand && s.hand.phase !== "done") return null;
    return s.nextHandAt;
  }

  private afterChange(now: number): void {
    const s = this.game.s;
    this.recordHand();
    const human = s.players.find((p) => p.id === this.humanId);
    if (human?.status === "out") this.ended = "out";
    else if (s.status === "finished") this.ended = "finished";
    if (this.ended) {
      this.botDue = null;
      return;
    }
    const task = this.botTask();
    if (!task) {
      this.botDue = null;
      return;
    }
    // Keep the bot's decision and thinking time unless something happened since it started thinking.
    const due = this.botDue;
    if (due && due.id === task.id && due.kind === task.kind && due.seq === s.logSeq) return;
    this.botDue = { ...task, at: now + DECIDE_MS, seq: s.logSeq };
  }

  private botTask(): BotTask | null {
    const s = this.game.s;
    if (s.status !== "running" || s.paused) return null;
    for (const b of this.bots) {
      const p = s.players.find((x) => x.id === b.id);
      if (p?.status === "busted" && !p.rebuyDeclined) return { id: b.id, kind: "rebuy" };
    }
    const h = s.hand;
    if (!h || h.phase !== "betting") return null;
    if (h.pending) return this.isBot(h.pending.playerId) ? { id: h.pending.playerId, kind: "choice" } : null;
    if (h.toAct && this.isBot(h.toAct)) return { id: h.toAct, kind: "turn" };
    return null;
  }

  private isBot(id: string): boolean {
    return this.bots.some((b) => b.id === id);
  }

  /** How long a bot "thinks" before a move: long enough to follow, longer for big decisions and powers. */
  private thinkMs(task: BotTask, move: BotMove): number {
    const s = this.game.s;
    const h = s.hand;
    const between = (min: number, max: number) => min + this.botRng.int(max - min + 1);
    let ms: number;
    if (task.kind === "rebuy") ms = between(500, 900);
    // Engineer's options are public: give everyone time to look at them.
    else if (task.kind === "choice") ms = h?.pending?.kind === "engineer" ? between(1900, 2500) : between(900, 1400);
    else if (move.t === "power") ms = between(1100, 1800);
    else {
      const hp = h?.players.find((p) => p.id === task.id);
      const chips = s.players.find((p) => p.id === task.id)?.chips ?? 0;
      const facing = h && hp ? h.currentBet - hp.streetBet : 0;
      const shove = move.t === "act" && move.action === "raise" && (move.amount ?? 0) - (hp?.streetBet ?? 0) >= chips * 0.8;
      if (move.t === "act" && move.action === "fold" && h?.street === "preflop") ms = between(500, 900);
      else if ((facing > 0 && facing >= chips / 2) || shove) ms = between(1600, 2800);
      else ms = between(900, 1700);
    }
    // After its own power, the announcement stays up long enough to read before the bot moves on.
    if (this.afterPower.has(task.id)) ms = Math.max(ms, 1300);
    const you = h?.players.find((p) => p.id === this.humanId);
    if (!you || you.folded) ms *= 0.55;
    return Math.round(Math.min(MAX_THINK_MS, ms));
  }

  /** The due bot either makes up its mind (then waits its thinking time) or makes the move it decided on. */
  private stepBot(now: number): void {
    const due = this.botDue!;
    const bot = this.bots.find((b) => b.id === due.id)!;
    if (!due.move) {
      let move: BotMove | null = null;
      try {
        // A private copy: nothing the bot does to it can reach the real state.
        move = this.policy(structuredClone(buildView(this.game, bot.id, now, this.allIds)), this.botRng, bot.profile, bot.memory);
      } catch (err) {
        console.warn("practice bot failed", err);
      }
      if (move) {
        due.move = move;
        due.at = now + Math.max(0, this.thinkMs(due, move) - DECIDE_MS);
        return;
      }
    }
    this.botDue = null;
    const move = due.move ?? null;
    const before = structuredClone(this.game.s);
    try {
      if (!move) throw new GameError("The bot had no move");
      applyPlayerMessage(this.game, bot.id, move, now);
      if (move.t === "power") this.afterPower.add(bot.id);
      else this.afterPower.delete(bot.id);
    } catch (err) {
      // A bot mistake must never stall the table: undo it and make the simplest legal move instead.
      this.game.s = before;
      this.fallbacks++;
      console.warn(`practice bot move rejected: ${err instanceof Error ? err.message : err}`, move);
      this.afterPower.delete(bot.id);
      this.fallback(bot.id, now);
    }
  }

  private fallback(id: string, now: number): void {
    const s = this.game.s;
    const h = s.hand;
    const p = s.players.find((x) => x.id === id);
    if (p?.status === "busted" && !p.rebuyDeclined) this.game.rebuy(id, true, now);
    else if (h?.pending?.playerId === id) this.game.choose(id, h.pending.kind === "scanner" ? null : 0, now);
    else {
      const legal = this.game.legal(id);
      if (legal) this.game.act(id, legal.canCheck ? "check" : "fold", undefined, now);
    }
  }

  /** Tally the human's hand once it's over. Only public facts (results and powers played) are used. */
  private recordHand(): void {
    const h = this.game.s.hand;
    if (!h || h.phase !== "done" || h.number === this.recordedHand) return;
    this.recordedHand = h.number;
    const st = this.stats;
    for (const { playerId, type } of h.powerHistory) {
      const tally = playerId === this.humanId ? st.powersPlayed : st.powersFaced;
      tally[type] = (tally[type] ?? 0) + 1;
    }
    if (!h.players.some((p) => p.id === this.humanId)) return;
    st.hands++;
    const won = h.result?.won[this.humanId] ?? 0;
    const shown = h.result?.showdown ? h.result.hands[this.humanId] : undefined;
    if (won > 0) {
      st.handsWon++;
      if (!st.biggestPot || won > st.biggestPot.amount) {
        const powers = h.powerHistory.filter((x) => x.playerId === this.humanId).map((x) => x.type);
        st.biggestPot = { amount: won, label: shown?.label ?? null, powers };
      }
    }
    if (shown && shown.best.length === 5) {
      const score = handScore(shown.best);
      if (!st.bestHand || score > st.bestHand.score) st.bestHand = { label: shown.label, score };
    }
  }
}

function minOf(...times: (number | null)[]): number | null {
  let min: number | null = null;
  for (const t of times) if (t !== null && (min === null || t < min)) min = t;
  return min;
}
