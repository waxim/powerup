import { describe, expect, it } from "vitest";
import { HandCategory, bestHand, handScore } from "../src/engine/evaluator";
import { seededRng, shuffle } from "../src/engine/rng";
import { fullDeck, type Card } from "../src/shared/cards";

const h = (s: string) => s.split(" ") as Card[];
const best = (s: string) => bestHand(h(s));

describe("hand evaluator", () => {
  it("recognises every category", () => {
    expect(best("As Ks Qs Js Ts").category).toBe(HandCategory.StraightFlush);
    expect(best("9h 8h 7h 6h 5h").category).toBe(HandCategory.StraightFlush);
    expect(best("9h 9d 9s 9c 5h").category).toBe(HandCategory.Quads);
    expect(best("9h 9d 9s 5c 5h").category).toBe(HandCategory.FullHouse);
    expect(best("2h 9h Jh Kh 5h").category).toBe(HandCategory.Flush);
    expect(best("9h 8d 7s 6c 5h").category).toBe(HandCategory.Straight);
    expect(best("9h 9d 9s Kc 5h").category).toBe(HandCategory.Trips);
    expect(best("9h 9d Ks Kc 5h").category).toBe(HandCategory.TwoPair);
    expect(best("9h 9d Ks Qc 5h").category).toBe(HandCategory.Pair);
    expect(best("2h 9d Ks Qc 5h").category).toBe(HandCategory.HighCard);
  });

  it("orders categories correctly", () => {
    const order = [
      "2h 9d Ks Qc 5h",
      "9h 9d Ks Qc 5h",
      "9h 9d Ks Kc 5h",
      "9h 9d 9s Kc 5h",
      "9h 8d 7s 6c 5h",
      "2h 9h Jh Kh 5h",
      "9h 9d 9s 5c 5h",
      "9h 9d 9s 9c 5h",
      "9h 8h 7h 6h 5h",
      "As Ks Qs Js Ts",
    ].map((x) => best(x).score);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it("handles the wheel as the lowest straight", () => {
    const wheel = best("Ah 2d 3s 4c 5h");
    expect(wheel.category).toBe(HandCategory.Straight);
    expect(wheel.label).toBe("Straight, Five high");
    expect(best("2h 3d 4s 5c 6h").score).toBeGreaterThan(wheel.score);
    expect(best("Ah 2h 3h 4h 5h").label).toBe("Straight Flush, Five high");
  });

  it("compares kickers", () => {
    expect(best("Ah Ad Ks 7c 5h").score).toBeGreaterThan(best("Ah Ad Qs Jc 9h").score);
    expect(best("Ah Ad Ks Kc 3h").score).toBeGreaterThan(best("Ah Ad Qs Qc Jh").score);
    expect(best("Kh Kd Ks 2c 2h").score).toBeGreaterThan(best("Qh Qd Qs Ac Ah").score);
    expect(best("Ah Kh 9h 5h 3h").score).toBeGreaterThan(best("Ah Kh 9h 5h 2h").score);
  });

  it("picks the best five of seven or more cards", () => {
    const seven = best("Ah Kh 2c 3d Qh Jh Th");
    expect(seven.label).toBe("Royal Flush");
    expect(new Set(seven.cards)).toEqual(new Set(h("Ah Kh Qh Jh Th")));
    // Nine cards: two hole cards + a seven-card board (two Deploys).
    const nine = best("2c 2d 7h 7s 7d Kc Ks 3h 4h");
    expect(nine.label).toBe("Full House, Sevens full of Kings");
  });

  it("describes hands", () => {
    expect(best("9h 9d 9s 5c 5h").label).toBe("Full House, Nines full of Fives");
    expect(best("9h 9d Ks Kc 5h").label).toBe("Two Pair, Kings and Nines");
    expect(best("9h 9d Ks Qc 5h").label).toBe("Pair of Nines");
    expect(best("2h 9d Ks Qc 5h").label).toBe("High Card, King");
    expect(best("Kh Kd").label).toBe("Pair of Kings");
    expect(best("Kh 7d").label).toBe("High Card, King");
  });

  it("ties identical hands", () => {
    expect(best("Ah Kd 9c 7s 2h").score).toBe(best("As Kc 9d 7h 2c").score);
  });
});

describe("fast hand score", () => {
  it("matches the exhaustive evaluator on 200,000 random hands of 5 to 9 cards", () => {
    const rng = seededRng(99);
    const deck = fullDeck();
    for (let i = 0; i < 200_000; i++) {
      const n = 5 + (i % 5);
      const cards = shuffle(deck, rng).slice(0, n);
      const expected = bestHand(cards).score;
      const got = handScore(cards);
      if (got !== expected) throw new Error(`${cards.join(" ")}: fast ${got} != exhaustive ${expected}`);
    }
  }, 60_000);

  it("handles the tricky cases", () => {
    for (const hand of [
      "Ah 2d 3s 4c 5h 9d Kc", // wheel
      "9h 9d 9s 5c 5h 5d 2c", // two trips -> full house nines full of fives
      "Kh Kd Ks Kc Qh Qd Qs", // quads with trips kicker
      "Ah Kh Qh Jh 9h 8h 2c", // six-card flush: best five
      "Th Jh Qh Kh Ah 9h 8h 7h 6h", // nine hearts: royal
      "2c 2d 3c 3d 4c 4d Ah", // three pairs: kicker from a pair
    ]) {
      const cards = hand.split(" ") as Card[];
      expect(handScore(cards)).toBe(bestHand(cards).score);
    }
  });
});
