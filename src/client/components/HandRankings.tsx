import type { Card } from "../../shared/cards";
import { PlayingCard } from "./PlayingCard";

const RANKINGS: { name: string; note: string; cards: Card[] }[] = [
  { name: "Royal flush", note: "A-K-Q-J-10, all one suit", cards: ["As", "Ks", "Qs", "Js", "Ts"] },
  { name: "Straight flush", note: "Five in a row, all one suit", cards: ["9h", "8h", "7h", "6h", "5h"] },
  { name: "Four of a kind", note: "Four cards of one rank", cards: ["Qs", "Qh", "Qd", "Qc", "7s"] },
  { name: "Full house", note: "Three of a kind plus a pair", cards: ["Js", "Jh", "Jd", "4c", "4s"] },
  { name: "Flush", note: "Five of one suit", cards: ["Kd", "Td", "8d", "5d", "2d"] },
  { name: "Straight", note: "Five in a row (A-2-3-4-5 counts)", cards: ["Tc", "9d", "8s", "7h", "6c"] },
  { name: "Three of a kind", note: "Three cards of one rank", cards: ["7s", "7h", "7c", "Kd", "2s"] },
  { name: "Two pair", note: "Two different pairs", cards: ["As", "Ad", "9c", "9h", "5s"] },
  { name: "Pair", note: "Two cards of one rank", cards: ["Ks", "Kh", "Jc", "8d", "3s"] },
  { name: "High card", note: "None of the above: highest card plays", cards: ["Ah", "Jd", "9s", "6c", "3h"] },
];

/** Poker hands from best to worst, each with an example. */
export function HandRankings() {
  return (
    <ol className="hand-rankings">
      {RANKINGS.map((r) => (
        <li key={r.name}>
          <div className="hand-rank-text">
            <strong>{r.name}</strong>
            <span>{r.note}</span>
          </div>
          <div className="hand-rank-cards" aria-hidden>
            {r.cards.map((c) => (
              <PlayingCard key={c} card={c} size="xs" />
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}
