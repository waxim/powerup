import { describe, expect, it } from "vitest";
import { VirtualClock } from "../src/client/practice/clock";
import { PracticeRunner } from "../src/client/practice/runner";
import { FakeEnv, config, passive } from "./practice.helpers";

describe("virtual clock", () => {
  it("follows real time, stands still while held, and resumes where it stopped", () => {
    let real = 1000;
    const c = new VirtualClock(() => real);
    real += 500;
    expect(c.now()).toBe(1500);
    c.hold("hidden");
    real += 60_000;
    expect(c.now()).toBe(1500);
    c.hold("coach");
    c.release("hidden");
    real += 10_000;
    expect(c.now()).toBe(1500);
    c.release("coach");
    expect(c.now()).toBe(1500);
    real += 250;
    expect(c.now()).toBe(1750);
  });

  it("never runs backwards", () => {
    let real = 5000;
    const c = new VirtualClock(() => real);
    expect(c.now()).toBe(5000);
    real = 4000;
    expect(c.now()).toBe(5000);
  });

  it("skips time the device spent asleep", () => {
    let real = 0;
    const c = new VirtualClock(() => real);
    for (let i = 0; i < 5; i++) {
      real += 1000;
      c.observe(2500);
    }
    expect(c.now()).toBe(5000);
    real += 10 * 60_000;
    c.observe(2500);
    expect(c.now()).toBe(7500);
  });
});

describe("practice runner", () => {
  const make = () => {
    const env = new FakeEnv();
    const runner = new PracticeRunner(config({ orbits: 2 }), env, passive);
    return { env, runner };
  };

  it("does nothing until attached, then plays on a single timer", () => {
    const { env, runner } = make();
    const first = runner.getSnapshot();
    env.advanceBy(60_000);
    expect(runner.current.game.s.handNumber).toBe(0);
    runner.attach();
    env.advanceBy(3000);
    expect(runner.current.game.s.handNumber).toBe(1);
    expect(env.pendingTimeouts).toBeLessThanOrEqual(1);
    expect(runner.getSnapshot()).not.toBe(first);
  });

  it("returns the same snapshot while nothing changes", () => {
    const { runner } = make();
    expect(runner.getSnapshot()).toBe(runner.getSnapshot());
  });

  it("freezes while the tab is hidden, keeping the human's time to act", () => {
    const { env, runner } = make();
    runner.attach();
    // Let the bots play until it's the human's turn.
    for (let i = 0; i < 200 && !runner.getSnapshot().view.me?.legal; i++) env.advanceBy(500);
    const v = runner.getSnapshot().view;
    expect(v.me?.legal).toBeTruthy();
    const left = v.hand!.turnDeadline! - runner.serverNow();
    env.setVisibility("hidden");
    expect(env.pendingTimeouts).toBe(0);
    const seq = runner.current.game.s.logSeq;
    env.advanceBy(10 * 60_000);
    expect(runner.current.game.s.logSeq).toBe(seq);
    env.setVisibility("visible");
    const after = runner.getSnapshot().view;
    expect(after.hand!.turnDeadline! - runner.serverNow()).toBe(left);
    // No "paused" noise in the log either.
    expect(runner.current.game.s.log.some((l) => /paused/.test(l.text))).toBe(false);
  });

  it("doesn't count a device sleep against the human", () => {
    const { env, runner } = make();
    runner.attach();
    for (let i = 0; i < 200 && !runner.getSnapshot().view.me?.legal; i++) env.advanceBy(500);
    const deadline = runner.getSnapshot().view.hand!.turnDeadline!;
    const before = runner.serverNow();
    env.sleep(30 * 60_000);
    env.advanceBy(1000);
    expect(runner.serverNow() - before).toBeLessThan(5000);
    expect(runner.getSnapshot().view.hand!.turnDeadline).toBe(deadline);
    expect(runner.current.game.s.players.find((p) => p.id === runner.current.humanId)!.away).toBe(false);
  });

  it("holds for a tip: bots wait until it's dismissed", () => {
    const { env, runner } = make();
    runner.attach();
    env.advanceBy(3000);
    runner.hold("coach");
    const seq = runner.current.game.s.logSeq;
    env.advanceBy(60_000);
    expect(runner.current.game.s.logSeq).toBe(seq);
    runner.release("coach");
    env.advanceBy(5000);
    expect(runner.current.game.s.logSeq).toBeGreaterThan(seq);
  });

  it("survives attach, detach, attach without doubling up", () => {
    const { env, runner } = make();
    runner.attach()();
    runner.attach();
    expect(env.listeners.get("visibilitychange")!.size).toBe(1);
    expect(env.timers.size).toBeLessThanOrEqual(2);
    runner.detach();
    expect(env.timers.size).toBe(0);
    expect(env.listeners.get("visibilitychange")!.size).toBe(0);
  });

  it("stops at the end of the session; keep playing and restart carry on", () => {
    const { env, runner } = make();
    runner.attach();
    for (let i = 0; i < 2000 && !runner.getSnapshot().session.ended; i++) {
      const v = runner.getSnapshot().view;
      const l = v.me?.legal;
      if (l) runner.send({ t: "act", action: l.canCheck ? "check" : "call" });
      else env.advanceBy(1000);
    }
    const s = runner.getSnapshot().session;
    expect(s.ended).toBe("orbits");
    expect(s.stats.hands).toBe(6);
    expect(env.pendingTimeouts).toBe(0);
    // The level clock doesn't run behind the summary.
    const t = runner.serverNow();
    env.advanceBy(60_000);
    expect(runner.serverNow()).toBe(t);

    runner.extend();
    expect(runner.getSnapshot().session.ended).toBeNull();
    env.advanceBy(100);
    expect(runner.current.game.s.handNumber).toBe(7);

    const id = runner.getSnapshot().session.id;
    runner.send({ t: "rematch" });
    const fresh = runner.getSnapshot();
    expect(fresh.session.id).toBe(id + 1);
    expect(fresh.session.stats.hands).toBe(0);
    expect(fresh.view.handNumber).toBe(0);
  });

  it("reports a refused move as an error without throwing", () => {
    const { env, runner } = make();
    runner.attach();
    env.advanceBy(3000);
    runner.send({ t: "act", action: "raise", amount: 1 });
    expect(runner.getSnapshot().error).toBeTruthy();
    runner.clearError();
    expect(runner.getSnapshot().error).toBeNull();
  });
});
