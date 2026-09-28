/**
 * The PowerUp power cards and mode rules.
 *
 * "classic" follows the PokerStars Power Up rules (3-handed): 3 powers in hand,
 * 10 starting energy, +2 per hand, max 15.
 *
 * "double" is used when 4-6 players start a table. There are twice as many opponents, so
 * players hold 4 powers and can bank more energy, and the powers whose strength grows with
 * the number of opponents are re-costed (and EMP turns up half as often).
 */

export type GameMode = "classic" | "double";

export const POWER_TYPES = [
  "xray",
  "upgrade",
  "scanner",
  "reload",
  "intel",
  "engineer",
  "emp",
  "disintegrate",
  "clone",
  "deploy",
] as const;
export type PowerType = (typeof POWER_TYPES)[number];

export interface PowerDef {
  type: PowerType;
  name: string;
  /** Energy cost per mode. */
  cost: Record<GameMode, number>;
  /** Relative chance of being drawn per mode (1 = normal). */
  weight: Record<GameMode, number>;
  /** Short text printed on the card. */
  text: string;
  /** Longer rules text for the How to play page. */
  rules: string;
  /** Accent colour for the card art. */
  color: string;
}

export const POWERS: Record<PowerType, PowerDef> = {
  xray: {
    type: "xray",
    name: "X-Ray",
    cost: { classic: 2, double: 4 },
    weight: { classic: 1, double: 1 },
    text: "Every opponent in the hand exposes one random hole card.",
    rules:
      "Each opponent still in the hand turns one of their hole cards face up, chosen at random, for the whole table to see. An opponent who already has an exposed card is unaffected.",
    color: "#38e1ff",
  },
  upgrade: {
    type: "upgrade",
    name: "Upgrade",
    cost: { classic: 5, double: 5 },
    weight: { classic: 1, double: 1 },
    text: "Draw a third hole card, then discard one.",
    rules:
      "You draw a third hole card from the deck, then choose which of your three cards to throw away. Nobody sees the discard.",
    color: "#7cff6b",
  },
  scanner: {
    type: "scanner",
    name: "Scanner",
    cost: { classic: 4, double: 4 },
    weight: { classic: 1, double: 1 },
    text: "See the top two cards of the deck. You may discard one of them.",
    rules:
      "You privately look at the top two cards of the deck and may discard one of them. Your opponents are told whether you discarded, but not which card it was.",
    color: "#ffd166",
  },
  reload: {
    type: "reload",
    name: "Reload",
    cost: { classic: 5, double: 5 },
    weight: { classic: 1, double: 1 },
    text: "Swap one or both of your hole cards for new ones.",
    rules:
      "Pick one or both of your hole cards. They are discarded and replaced from the top of the deck. Replaced cards are always dealt face down.",
    color: "#ff9f43",
  },
  intel: {
    type: "intel",
    name: "Intel",
    cost: { classic: 3, double: 3 },
    weight: { classic: 1, double: 1 },
    text: "See the deck's top card for the rest of the hand.",
    rules:
      "For the rest of the hand you can always see the card on top of the deck, even as other powers change it.",
    color: "#a78bfa",
  },
  engineer: {
    type: "engineer",
    name: "Engineer",
    cost: { classic: 5, double: 5 },
    weight: { classic: 1, double: 1 },
    text: "Choose the deck's next card from three options. Everyone sees them.",
    rules:
      "The next three cards of the deck are shown to every player. You choose which one goes back on top as the next card to be dealt; the other two are discarded.",
    color: "#f472b6",
  },
  emp: {
    type: "emp",
    name: "EMP",
    cost: { classic: 3, double: 4 },
    weight: { classic: 1, double: 0.5 },
    text: "Opponents can't play powers for the rest of this street.",
    rules:
      "Knocks out your opponents' powers until the next card is dealt, protecting the street you're on. You can still play your own powers.",
    color: "#60a5fa",
  },
  disintegrate: {
    type: "disintegrate",
    name: "Disintegrate",
    cost: { classic: 4, double: 4 },
    weight: { classic: 1, double: 1 },
    text: "Destroy a board card dealt this street. The next card replaces it.",
    rules:
      "Target a board card dealt on the current street (any of the three on the flop). It is destroyed and replaced by the top card of the deck. Cards protected by an all-in shield (red) can't be targeted.",
    color: "#ff4d6d",
  },
  clone: {
    type: "clone",
    name: "Clone",
    cost: { classic: 2, double: 2 },
    weight: { classic: 1, double: 1 },
    text: "Get a copy of the last power played this hand.",
    rules:
      "Adds a copy of the last power played this hand (by anyone) to your powers. You still pay that power's energy when you use it. The only way to hold two of the same power.",
    color: "#2dd4bf",
  },
  deploy: {
    type: "deploy",
    name: "Deploy",
    cost: { classic: 3, double: 2 },
    weight: { classic: 1, double: 1 },
    text: "Add an extra card to the board for everyone. Max two per hand.",
    rules:
      "The top card of the deck is added to the board as an extra community card that every player can use. At most two cards can be deployed per hand, so the board can grow to seven cards.",
    color: "#c084fc",
  },
};

export interface ModeRules {
  handSize: number;
  startEnergy: number;
  energyPerHand: number;
  maxEnergy: number;
}

export const MODE_RULES: Record<GameMode, ModeRules> = {
  classic: { handSize: 3, startEnergy: 10, energyPerHand: 2, maxEnergy: 15 },
  double: { handSize: 4, startEnergy: 10, energyPerHand: 2, maxEnergy: 20 },
};

export const MAX_DEPLOYS_PER_HAND = 2;

/** Tables that start with 4-6 players play the "double" rules. */
export function modeForPlayers(playerCount: number): GameMode {
  return playerCount >= 4 ? "double" : "classic";
}

export function powerCost(type: PowerType, mode: GameMode): number {
  return POWERS[type].cost[mode];
}

export function isPowerType(value: unknown): value is PowerType {
  return typeof value === "string" && (POWER_TYPES as readonly string[]).includes(value);
}
