import { GameError } from "../../engine/game";
import type { ClientMessage, TableView } from "../../shared/protocol";
import { VirtualClock, type HoldReason } from "./clock";
import type { Thought } from "./bot";
import { LocalTable, type BotPolicy, type PracticeConfig, type PracticeStats, type SessionEnd } from "./localTable";

/** The browser APIs the runner needs, injected so tests can drive it with fake timers and a fake document. */
export interface RunnerEnv {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  doc: {
    readonly visibilityState: string;
    addEventListener(type: string, fn: () => void): void;
    removeEventListener(type: string, fn: () => void): void;
  };
}

export interface SessionInfo {
  /** Changes on every restart, so the table UI can reset. */
  id: number;
  handLimit: number;
  ended: SessionEnd | null;
  stats: PracticeStats;
  startingChips: number;
  rebuys: number;
}

export interface PracticeSnapshot {
  view: TableView;
  error: string | null;
  session: SessionInfo;
}

const HEARTBEAT_MS = 1000;
/** Real time between heartbeats beyond this is treated as the device sleeping, and skipped. */
const MAX_GAP_MS = 2500;

/**
 * Runs a LocalTable in the page: one timer for the next event, a virtual clock that stops while the tab
 * is hidden (or a tip is open, or the session is over), and a subscribe/getSnapshot pair for React.
 */
export class PracticeRunner {
  readonly clock: VirtualClock;
  private table: LocalTable;
  private sessionId = 1;
  private error: string | null = null;
  private snapshot: PracticeSnapshot;
  private listeners = new Set<() => void>();
  private timer: unknown = null;
  private beat: unknown = null;
  private attached = false;

  constructor(
    private config: PracticeConfig,
    private readonly env: RunnerEnv,
    private readonly policy: BotPolicy,
  ) {
    this.clock = new VirtualClock(() => env.now());
    this.clock.hold("detached");
    this.table = new LocalTable(config, this.clock.now(), policy);
    this.snapshot = this.makeSnapshot();
  }

  /** Start running. Safe to call again after detaching (React StrictMode mounts twice). */
  attach = (): (() => void) => {
    if (!this.attached) {
      this.attached = true;
      this.env.doc.addEventListener("visibilitychange", this.onVisibility);
      this.beat = this.env.setInterval(this.pump, HEARTBEAT_MS);
      this.onVisibility();
      this.clock.release("detached");
      this.pump();
    }
    return this.detach;
  };

  detach = (): void => {
    if (!this.attached) return;
    this.attached = false;
    this.clock.hold("detached");
    this.env.doc.removeEventListener("visibilitychange", this.onVisibility);
    this.env.clearInterval(this.beat);
    this.beat = null;
    this.clearTimer();
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PracticeSnapshot => this.snapshot;

  serverNow = (): number => this.clock.now();

  send = (msg: ClientMessage): void => {
    if (msg.t === "rematch") {
      this.restart();
      return;
    }
    this.clock.observe(MAX_GAP_MS);
    try {
      this.table.send(msg, this.clock.now());
      this.error = null;
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      this.error = err.message;
    }
    this.afterWork();
  };

  clearError = (): void => {
    if (this.error === null) return;
    this.error = null;
    this.publish();
  };

  hold(reason: HoldReason): void {
    const was = this.clock.held;
    this.clock.hold(reason);
    this.clearTimer();
    // What the page offers (such as skipping to the next hand) depends on whether the game is held.
    if (!was) this.publish();
  }

  release(reason: HoldReason): void {
    const was = this.clock.held;
    this.clock.release(reason);
    if (!this.pump() && was && !this.clock.held) this.publish();
  }

  /** A fresh game with a new deal (and optionally a new setup). */
  restart(config: PracticeConfig = { ...this.config, seed: newSeed() }): void {
    this.config = config;
    this.table = new LocalTable(config, this.clock.now(), this.policy);
    this.sessionId++;
    this.error = null;
    this.clock.release("ended");
    this.afterWork();
  }

  /** Play on for another orbit after the session ended. */
  extend(): void {
    this.table.extend(1);
    this.clock.release("ended");
    // Publish even if nothing is due yet (say a rebuy is still waiting), so the summary closes.
    if (!this.pump()) this.publish();
  }

  /** Stop here and show the summary. */
  leave(): void {
    this.table.leave();
    this.afterWork();
  }

  /** What the coach would do in the player's seat right now. */
  advise(): Thought | null {
    return this.table.advise(this.clock.now());
  }

  /** Whether the wait before the next hand can be skipped right now. */
  canSkipWait(): boolean {
    const s = this.table.game.s;
    return (
      !this.clock.held &&
      !this.table.ended &&
      s.status === "running" &&
      !s.paused &&
      s.hand?.phase === "done" &&
      s.nextHandAt !== null &&
      s.handNumber < this.table.handLimit &&
      !s.players.some((p) => p.status === "busted")
    );
  }

  /** Deal the next hand now instead of waiting out the pause after a hand. */
  skipWait(): void {
    if (!this.canSkipWait()) return;
    this.clock.skip(this.table.game.s.nextHandAt! - this.clock.now());
    this.pump();
  }

  /** The underlying table, for tests and debugging. */
  get current(): LocalTable {
    return this.table;
  }

  private onVisibility = (): void => {
    if (this.env.doc.visibilityState === "hidden") this.hold("hidden");
    else this.release("hidden");
  };

  /** Run whatever is due. Returns true if anything happened (and was published). */
  private pump = (): boolean => {
    this.clock.observe(MAX_GAP_MS);
    if (!this.clock.held && this.table.advance(this.clock.now())) {
      this.afterWork();
      return true;
    }
    this.reschedule();
    return false;
  };

  private afterWork(): void {
    if (this.table.ended) this.clock.hold("ended");
    this.publish();
    this.reschedule();
  }

  private reschedule(): void {
    this.clearTimer();
    if (this.clock.held || !this.attached) return;
    const at = this.table.nextWakeAt();
    if (at === null) return;
    this.timer = this.env.setTimeout(() => {
      this.timer = null;
      this.pump();
    }, Math.max(0, at - this.clock.now()));
  }

  private clearTimer(): void {
    if (this.timer !== null) this.env.clearTimeout(this.timer);
    this.timer = null;
  }

  private publish(): void {
    this.snapshot = this.makeSnapshot();
    for (const l of this.listeners) l();
  }

  private makeSnapshot(): PracticeSnapshot {
    const t = this.table;
    return {
      view: t.view(this.clock.now()),
      error: this.error,
      session: {
        id: this.sessionId,
        handLimit: t.handLimit,
        ended: t.ended,
        stats: { ...t.stats, powersPlayed: { ...t.stats.powersPlayed }, powersFaced: { ...t.stats.powersFaced } },
        startingChips: t.game.s.settings.startingChips,
        rebuys: t.game.s.players.find((p) => p.id === t.humanId)?.rebuysUsed ?? 0,
      },
    };
  }
}

export function newSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}
