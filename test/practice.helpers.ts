import type { Scheduler } from "../src/client/practice/localTable";

/** A manual clock: timers only fire when `runNext` is called, in time order. */
export class FakeClock implements Scheduler {
  t = 1_700_000_000_000;
  private seq = 0;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  get pending(): number {
    return this.timers.size;
  }

  /** Advance to the earliest timer and run it. Returns false when nothing is scheduled. */
  runNext(): boolean {
    let next: [number, { at: number; fn: () => void }] | null = null;
    for (const entry of this.timers) if (!next || entry[1].at < next[1].at) next = entry;
    if (!next) return false;
    this.timers.delete(next[0]);
    this.t = Math.max(this.t, next[1].at);
    next[1].fn();
    return true;
  }
}
