export const SUITS = ["s", "h", "d", "c"] as const;
export type Suit = (typeof SUITS)[number];

export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;
export type RankChar = (typeof RANKS)[number];

/** A card is rank + suit, e.g. "As", "Td", "7c". */
export type Card = `${RankChar}${Suit}`;

const RANK_VALUE: Record<RankChar, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, T: 10, J: 11, Q: 12, K: 13, A: 14,
};

export const SUIT_SYMBOL: Record<Suit, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

const RANK_NAME: Record<number, [string, string]> = {
  2: ["Two", "Twos"], 3: ["Three", "Threes"], 4: ["Four", "Fours"], 5: ["Five", "Fives"],
  6: ["Six", "Sixes"], 7: ["Seven", "Sevens"], 8: ["Eight", "Eights"], 9: ["Nine", "Nines"],
  10: ["Ten", "Tens"], 11: ["Jack", "Jacks"], 12: ["Queen", "Queens"], 13: ["King", "Kings"], 14: ["Ace", "Aces"],
};

export function rankOf(card: Card): number {
  return RANK_VALUE[card[0] as RankChar];
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

export function rankName(rank: number, plural = false): string {
  return RANK_NAME[rank][plural ? 1 : 0];
}

/** Display rank: "T" is shown as "10". */
export function rankLabel(card: Card): string {
  return card[0] === "T" ? "10" : card[0];
}

/** Human readable card, e.g. "A♠". Used in the public table log. */
export function cardText(card: Card): string {
  return rankLabel(card) + SUIT_SYMBOL[suitOf(card)];
}

export function isCard(value: unknown): value is Card {
  return (
    typeof value === "string" &&
    value.length === 2 &&
    (RANKS as readonly string[]).includes(value[0]) &&
    (SUITS as readonly string[]).includes(value[1])
  );
}

export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(`${r}${s}`);
  return deck;
}
