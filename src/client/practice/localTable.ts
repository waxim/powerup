import { Game, GameError } from "../../engine/game";
import type { Rng } from "../../engine/rng";
import { buildView } from "../../engine/view";
import type { ClientMessage, TableView } from "../../shared/protocol";
import type { TableSettings } from "../../shared/settings";

/** What a bot wants to do next. Mirrors the client messages a human would send. */
export type BotMove =
  | { t: "act"; action: "fold" | "check" | "call" | "raise"; amount?: number }
  | { t: "power"; powerId: string; target?: number; indices?: number[] }
  | { t: "choose"; index: number | null }
  | { t: "rebuy"; accept: boolean };

/** A bot decides from its own view of the table only, so it can never see hidden cards. */
export type BotPolicy = (view: TableView, rng: Rng, botIndex: number) => BotMove | null;

export interface Scheduler {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface PracticeOptions {
  name: string;
  botNames: string[];
  settings: Partial<TableSettings>;
  /** Milliseconds a bot "thinks" before acting: [min, max]. */
  thinkMs?: [number, number];
}

const DEFAULT_THINK: [number, number] = [700, 1500];

/**
 * A complete table running in the browser: the real game engine, the human's seat, and bot seats.
 * It produces the same TableView a real table would, so the normal table UI renders it unchanged,
 * and it never touches the server.
 */
export class LocalTable {
  readonly game: Game;
  readonly humanId: string;
  readonly botIds: string[];
  private wakeTimer: unknown = null;
  private botTimer: unknown = null;
  private disposed = false;
  private readonly think: [number, number];

  constructor(
    opts: PracticeOptions,
    private readonly rng: Rng,
    private readonly policy: BotPolicy,
    private readonly clock: Scheduler,
    private readonly onChange: (view: TableView) => void,
    private readonly onError: (message: string) => void = () => {},
  ) {
    const now = clock.now();
    const { game, host } = Game.create({ id: "practice", settings: opts.settings, hostName: opts.name, now, rng });
    this.game = game;
    this.humanId = host.id;
    this.botIds = opts.botNames.map((name) => game.join(name, now).id);
    this.think = opts.thinkMs ?? DEFAULT_THINK;
    game.start(host.id, now);
    this.update();
  }

  get view(): TableView {
    const now = this.clock.now();
    return buildView(this.game, this.humanId, now, new Set(this.game.s.players.map((p) => p.id)));
  }

  /** Apply a message from the human player, exactly as the Durable Object would. */
  send(msg: ClientMessage): void {
    if (this.disposed) return;
    const now = this.clock.now();
    this.game.tick(now);
    const id = this.humanId;
    try {
      switch (msg.t) {
        case "act":
          this.game.act(id, msg.action, msg.amount, now);
          break;
        case "power":
          this.game.playPower(id, msg.powerId, { target: msg.target, indices: msg.indices }, now);
          break;
        case "choose":
          this.game.choose(id, msg.index, now);
          break;
        case "rebuy":
          this.game.rebuy(id, msg.accept, now);
          break;
        case "back":
          this.game.setBack(id, now);
          break;
        case "pause":
          this.game.pause(id, now);
          break;
        case "resume":
          this.game.resume(id, now);
          break;
        default:
          // Lobby messages (join, start, kick, rematch...) don't apply to a practice table.
          break;
      }
    } catch (err) {
      if (err instanceof GameError) this.onError(err.message);
      else throw err;
    }
    this.update();
  }

  /** Pause while the tab is hidden so the clock doesn't run out on the human. */
  setHidden(hidden: boolean): void {
    const s = this.game.s;
    if (s.status !== "running") return;
    const now = this.clock.now();
    if (hidden && !s.paused) this.game.pause(this.humanId, now);
    else if (!hidden && s.paused) this.game.resume(this.humanId, now);
    this.update();
  }

  dispose(): void {
    this.disposed = true;
    if (this.wakeTimer !== null) this.clock.clearTimeout(this.wakeTimer);
    if (this.botTimer !== null) this.clock.clearTimeout(this.botTimer);
  }

  /** Run due timers, publish the new view, and schedule the next timer and bot move. */
  private update(): void {
    if (this.disposed) return;
    const now = this.clock.now();
    this.game.tick(now);
    this.onChange(this.view);
    this.schedule();
  }

  private schedule(): void {
    if (this.wakeTimer !== null) this.clock.clearTimeout(this.wakeTimer);
    if (this.botTimer !== null) this.clock.clearTimeout(this.botTimer);
    this.wakeTimer = null;
    this.botTimer = null;
    const wake = this.game.nextWakeAt();
    if (wake !== null) {
      this.wakeTimer = this.clock.setTimeout(() => {
        this.wakeTimer = null;
        this.update();
      }, Math.max(0, wake - this.clock.now()));
    }
    const bot = this.botToMove();
    if (bot) {
      const [min, max] = this.think;
      // Quick follow-up choices (Scanner, Upgrade, Engineer) and rebuys don't need a long pause.
      const quick = bot.kind !== "turn";
      const delay = quick ? Math.min(min, 600) : min + this.rng.int(Math.max(1, max - min));
      this.botTimer = this.clock.setTimeout(() => {
        this.botTimer = null;
        this.moveBot(bot.id);
      }, delay);
    }
  }

  private botToMove(): { id: string; kind: "turn" | "choice" | "rebuy" } | null {
    const s = this.game.s;
    if (s.status !== "running" || s.paused) return null;
    for (const id of this.botIds) {
      const p = s.players.find((x) => x.id === id);
      if (p?.status === "busted" && !p.rebuyDeclined) return { id, kind: "rebuy" };
    }
    const h = s.hand;
    if (!h || h.phase !== "betting") return null;
    if (h.pending && this.botIds.includes(h.pending.playerId)) return { id: h.pending.playerId, kind: "choice" };
    if (!h.pending && h.toAct && this.botIds.includes(h.toAct)) return { id: h.toAct, kind: "turn" };
    return null;
  }

  private moveBot(id: string): void {
    if (this.disposed) return;
    const now = this.clock.now();
    this.game.tick(now);
    const view = buildView(this.game, id, now, new Set(this.game.s.players.map((p) => p.id)));
    const move = this.policy(view, this.rng, this.botIds.indexOf(id));
    try {
      if (move) this.applyBotMove(id, move, now);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      // A policy mistake must never stall the table: fall back to the simplest legal action.
      console.warn(`practice bot move rejected (${err.message})`, move);
      this.fallback(id, now);
    }
    this.update();
  }

  private applyBotMove(id: string, move: BotMove, now: number): void {
    switch (move.t) {
      case "act":
        this.game.act(id, move.action, move.amount, now);
        break;
      case "power":
        this.game.playPower(id, move.powerId, { target: move.target, indices: move.indices }, now);
        break;
      case "choose":
        this.game.choose(id, move.index, now);
        break;
      case "rebuy":
        this.game.rebuy(id, move.accept, now);
        break;
    }
  }

  private fallback(id: string, now: number): void {
    const h = this.game.s.hand;
    const p = this.game.s.players.find((x) => x.id === id);
    if (p?.status === "busted" && !p.rebuyDeclined) {
      this.game.rebuy(id, true, now);
      return;
    }
    if (h?.pending?.playerId === id) {
      this.game.choose(id, h.pending.kind === "scanner" ? null : 0, now);
      return;
    }
    const legal = this.game.legal(id);
    if (legal) this.game.act(id, legal.canCheck ? "check" : "fold", undefined, now);
  }
}
