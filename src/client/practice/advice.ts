import { cardText } from "../../shared/cards";
import { POWERS, type PowerType } from "../../shared/powers";
import type { TableView } from "../../shared/protocol";
import { chips } from "../lib/format";
import type { Thought } from "./bot";

const pct = (x: number) => `${Math.round(x * 100)}%`;

function powerReason(type: PowerType, t: Thought, v: TableView): string {
  const move = t.move.t === "power" ? t.move : null;
  switch (type) {
    case "reload": {
      const hole = v.me!.hole.map((c) => c.card);
      const idx = move?.indices ?? [];
      return idx.length === 2 ? "swap both of your cards for fresh ones" : `swap your ${cardText(hole[idx[0] ?? 0])} for a fresh card`;
    }
    case "upgrade":
      return "draw a third card and keep the best two";
    case "xray":
      return "see one card from each opponent before you decide";
    case "deploy":
      return "one more shared card helps your hand";
    case "disintegrate": {
      const target = move?.target;
      const card = target !== undefined ? v.hand?.board[target]?.card : undefined;
      return card ? `destroy the ${cardText(card)}, it helps them more than you` : "destroy a card that helps them more than you";
    }
    case "engineer":
      return "pick the next card from three";
    case "scanner":
      return "peek at the next two cards and bin one if it helps them";
    case "intel":
      return "see the next card for the rest of the hand";
    case "emp":
      return "switch off their powers while you're ahead";
    case "clone":
      return v.hand?.lastPower ? `copy ${POWERS[v.hand.lastPower].name}` : "copy the last power played";
  }
}

/** The coach's suggestion in plain words. It only ever reflects the player's own view. */
export function adviceText(t: Thought, v: TableView): string {
  const l = v.me?.legal;
  if (!l) return "";
  if (t.power) {
    const cost = v.costs[t.power];
    return `Try ${POWERS[t.power].name} (${cost}⚡): ${powerReason(t.power, t, v)}. Then decide your bet.`;
  }
  const m = t.move;
  if (m.t !== "act") return "";
  if (t.percentile !== null) {
    const hole = v.me!.hole.map((c) => cardText(c.card)).join(" ");
    const top = Math.max(1, Math.round(t.percentile * 100));
    const what =
      m.action === "raise"
        ? `raising to ${chips(m.amount ?? l.minRaiseTo)} is standard`
        : m.action === "call"
          ? "calling is fine"
          : m.action === "check"
            ? "checking is fine"
            : "folding is standard";
    const strength = top <= 50 ? `in the top ${top}% of starting hands` : "a weaker starting hand";
    return `${hole} is ${strength}. From your seat, ${what}.`;
  }
  const eq = pct(t.equity);
  switch (m.action) {
    case "fold":
      return `You win about ${eq} here. Calling ${chips(l.callAmount)} into ${chips(l.pot)} needs ${pct(t.need)}, so folding is fine.`;
    case "call":
      return `About ${eq}. You need ${pct(t.need)} to call ${chips(l.callAmount)}, so calling is fine.`;
    case "check":
      return `About ${eq}. Nothing to pay, so check and see what comes.`;
    case "raise":
      return m.amount === l.maxRaiseTo
        ? `About ${eq}, likely ahead. All in (${chips(m.amount)}) is a fine play.`
        : `About ${eq}, likely ahead. ${l.isBet ? "Bet" : "Raise to"} about ${chips(m.amount ?? l.minRaiseTo)}.`;
  }
}
