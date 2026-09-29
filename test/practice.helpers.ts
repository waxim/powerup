import type { BotPolicy, LocalTable, PracticeConfig } from "../src/client/practice/localTable";
import type { RunnerEnv } from "../src/client/practice/runner";
import type { ClientMessage, TableView } from "../src/shared/protocol";

export const T0 = 1_700_000_000_000;

export const config = (over: Partial<PracticeConfig> = {}): PracticeConfig => ({
  name: "Ann",
  opponents: 2,
  orbits: 3,
  seed: 7,
  ...over,
});

/** Always check or call; always rebuy; default follow-up choices. */
export const passive: BotPolicy = (view) => {
  const me = view.me!;
  if (me.rebuy) return { t: "rebuy", accept: true };
  if (me.scanner) return { t: "choose", index: null };
  if (me.upgrade) return { t: "choose", index: 2 };
  if (me.engineer) return { t: "choose", index: 0 };
  if (!me.legal) return null;
  return { t: "act", action: me.legal.canCheck ? "check" : "call" };
};

export const needsHuman = (v: TableView): boolean =>
  !!(v.me?.legal || v.me?.rebuy || v.me?.scanner || v.me?.upgrade || v.me?.engineer);

/**
 * Play a LocalTable forward in virtual time. When the human has something to do, `human` answers at once
 * (return null to let the clock run out instead). Stops when `until` holds or nothing is left to happen.
 */
export function drive(
  table: LocalTable,
  now: number,
  opts: { until?: (t: LocalTable) => boolean; human?: (v: TableView) => ClientMessage | null; maxSteps?: number; onStep?: (now: number) => void } = {},
): number {
  const human = opts.human ?? ((v) => passive(v, { int: () => 0 }, 0));
  for (let step = 0; step < (opts.maxSteps ?? 50_000); step++) {
    if (opts.until?.(table)) break;
    const v = table.view(now);
    const msg = needsHuman(v) ? human(v) : null;
    if (msg) table.send(msg, now);
    else {
      const t = table.nextWakeAt();
      if (t === null) break;
      now = Math.max(now, t);
      table.advance(now);
    }
    opts.onStep?.(now);
  }
  return now;
}

/** Fake timers and document for PracticeRunner tests. Timers only fire from `advanceBy`. */
export class FakeEnv implements RunnerEnv {
  t = T0;
  private seq = 0;
  timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  listeners = new Map<string, Set<() => void>>();
  visibilityState = "visible";

  now = (): number => this.t;

  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  };

  clearTimeout = (h: unknown): void => {
    this.timers.delete(h as number);
  };

  setInterval = (fn: () => void, ms: number): unknown => {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + ms, fn, every: ms });
    return id;
  };

  clearInterval = (h: unknown): void => {
    this.timers.delete(h as number);
  };

  readonly doc: RunnerEnv["doc"];

  constructor() {
    const env = this;
    this.doc = {
      get visibilityState() {
        return env.visibilityState;
      },
      addEventListener: (type, fn) => {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(fn);
      },
      removeEventListener: (type, fn) => {
        this.listeners.get(type)?.delete(fn);
      },
    };
  }

  /** One-shot timers that are pending (the heartbeat interval isn't counted). */
  get pendingTimeouts(): number {
    return [...this.timers.values()].filter((t) => t.every === undefined).length;
  }

  setVisibility(state: "visible" | "hidden"): void {
    this.visibilityState = state;
    for (const fn of this.listeners.get("visibilitychange") ?? []) fn();
  }

  /** Move real time forward, firing timers in order. */
  advanceBy(ms: number): void {
    const end = this.t + ms;
    for (let guard = 0; guard < 1_000_000; guard++) {
      let next: [number, { at: number; fn: () => void; every?: number }] | null = null;
      for (const e of this.timers) if (!next || e[1].at < next[1].at) next = e;
      if (!next || next[1].at > end) break;
      const [id, timer] = next;
      this.t = Math.max(this.t, timer.at);
      if (timer.every !== undefined) timer.at += timer.every;
      else this.timers.delete(id);
      timer.fn();
    }
    this.t = end;
  }

  /** Jump real time without running any timers (the device was asleep). */
  sleep(ms: number): void {
    this.t += ms;
    for (const timer of this.timers.values()) if (timer.at < this.t) timer.at = this.t;
  }
}
