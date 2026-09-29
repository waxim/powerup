import { describe, expect, it } from "vitest";
import { estimateEquity } from "../src/engine/equity";
import { seededRng } from "../src/engine/rng";
import type { Card } from "../src/shared/cards";

const c = (s: string) => (s ? (s.split(" ") as Card[]) : []);
const eq = (hole: string, opponents: (Card | null)[][], board = "", extra: Partial<Parameters<typeof estimateEquity>[0]> = {}) =>
  estimateEquity({
    hole: c(hole),
    board: c(board),
    opponents,
    boardToCome: 5 - c(board).length,
    iterations: 20_000,
    rng: seededRng(7),
    ...extra,
  });

describe("Monte Carlo equity", () => {
  it("matches well-known preflop matchups", () => {
    expect(eq("As Ah", [c("Ks Kh")])).toBeCloseTo(0.82, 1);
    expect(eq("As Ah", [[null, null]])).toBeCloseTo(0.85, 1);
    expect(eq("As Ah", [[null, null], [null, null]])).toBeCloseTo(0.73, 1);
    expect(eq("7c 2d", [[null, null]])).toBeCloseTo(0.35, 1);
  });

  it("is certain when the hand is decided", () => {
    expect(eq("As Ks", [[null, null]], "Qs Js Ts 2c 3d")).toBe(1);
    expect(eq("2c 3d", [c("As Ah")], "Ad Ac 7s 8h 9d")).toBe(0);
  });

  it("uses exposed cards and known next cards", () => {
    // Opponent shows a king: hero's aces do better against K+random than against a random hand.
    expect(eq("As Ah", [["Kd", null]])).toBeGreaterThan(eq("As Ah", [[null, null]]) - 0.02);
    // Hero needs a heart; knowing the next card is a heart makes the flush certain.
    const flushDraw = eq("Ah Kh", [c("Qc Qd")], "2h 7h 9s Jc", { knownNext: ["3h"] });
    expect(flushDraw).toBe(1);
  });

  it("splits ties", () => {
    expect(eq("2c 3d", [c("2d 3c")], "As Ks Qs Js 9h")).toBe(0.5);
  });
});
