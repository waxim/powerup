/** Why the practice clock is frozen. Several reasons can hold it at once. */
export type HoldReason = "hidden" | "coach" | "hint" | "sheet" | "ended" | "detached";

/**
 * Game time for a practice table. It follows the real clock but stands still while held (tab hidden,
 * a tip on screen, the session over), so nobody loses a turn or a blind level while they're away.
 * It never runs backwards.
 */
export class VirtualClock {
  private offset = 0;
  private last = 0;
  private holds = new Set<HoldReason>();
  private frozenAt = 0;
  private lastBeat: number;

  constructor(private readonly real: () => number) {
    this.last = real();
    this.lastBeat = this.last;
  }

  now(): number {
    const t = this.holds.size ? this.frozenAt : this.real() - this.offset;
    if (t > this.last) this.last = t;
    return this.last;
  }

  get held(): boolean {
    return this.holds.size > 0;
  }

  hold(reason: HoldReason): void {
    if (this.holds.has(reason)) return;
    if (!this.holds.size) this.frozenAt = this.now();
    this.holds.add(reason);
  }

  release(reason: HoldReason): void {
    if (!this.holds.delete(reason) || this.holds.size) return;
    // Carry on exactly where time stopped.
    this.offset = this.real() - this.frozenAt;
    this.lastBeat = this.real();
  }

  /** Jump ahead (skip the wait before the next hand). */
  skip(ms: number): void {
    if (!this.holds.size && ms > 0) this.offset -= ms;
  }

  /**
   * Called whenever the page gets a chance to run (a heartbeat, a timer, a tap). If much more real time
   * has passed since the last call than `maxGapMs` (the device slept, or the browser stopped running us),
   * the gap is skipped so it doesn't count against anyone.
   */
  observe(maxGapMs: number): void {
    const real = this.real();
    const gap = real - this.lastBeat;
    this.lastBeat = real;
    if (this.holds.size) return;
    if (gap > maxGapMs) this.offset += gap - maxGapMs;
    // The system clock was set back: carry on from here rather than wait for it to catch up.
    else if (gap < 0) this.offset += gap;
  }
}
