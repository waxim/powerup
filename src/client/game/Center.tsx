import { Eye, Wrench, ZapOff } from "lucide-react";
import type { Card } from "../../shared/cards";
import type { TableView } from "../../shared/protocol";
import { PlayingCard } from "../components/PlayingCard";
import { chips } from "../lib/format";

interface Props {
  view: TableView;
  /** Board indices that can be clicked right now (Disintegrate targeting). */
  targets: number[] | null;
  onTarget: (index: number) => void;
  winningCards: Card[] | null;
}

export function Center({ view, targets, onTarget, winningCards }: Props) {
  const h = view.hand;
  const me = view.me;
  const nameOf = (id: string | null) => view.players.find((p) => p.id === id)?.name ?? "";
  if (!h) {
    return (
      <div className="center">
        <div className="center-msg">{view.status === "running" ? "Shuffling up…" : ""}</div>
      </div>
    );
  }
  const standardDealt = h.board.filter((b) => !b.deployed).length;
  const slots = h.phase === "done" ? 0 : Math.max(0, 5 - standardDealt);
  const done = h.phase === "done";
  const lastWin = done ? [...view.log].reverse().find((l) => l.kind === "win") : null;

  return (
    <div className="center">
      <div className={targets ? "board is-targeting" : "board"} data-coach="board">
        {h.board.map((b, i) => {
          const target = targets?.includes(i) ?? false;
          return (
            <PlayingCard
              key={`${i}-${b.card}`}
              card={b.card}
              size="md"
              locked={b.locked}
              deployed={b.deployed}
              current={b.current && !done}
              selectable={target}
              dim={(!!targets && !target) || (!!winningCards && !winningCards.includes(b.card))}
              highlight={!!winningCards?.includes(b.card)}
              label={b.deployed ? "+1" : undefined}
              onClick={target ? () => onTarget(i) : undefined}
            />
          );
        })}
        {Array.from({ length: slots }, (_, i) => (
          <div key={`slot-${i}`} className="pcard pcard-md pcard-slot" aria-hidden />
        ))}
      </div>
      <div className="pot" aria-live="polite">
        {done && lastWin ? <span className="pot-result">{lastWin.text}</span> : <>Pot <strong>{chips(h.pot)}</strong></>}
      </div>
      <div className="center-info">
        {h.empBy && (
          <span className="badge badge-emp">
            <ZapOff size={14} aria-hidden /> EMP by {nameOf(h.empBy)}
          </span>
        )}
        {h.knownTop && (
          <span className="peek" title="Everyone knows the next card (Engineer)">
            <PlayingCard card={h.knownTop} size="xs" /> next card
          </span>
        )}
        {me?.intelTop && (
          <span className="peek peek-intel" title="Only you can see this (Intel)">
            <Eye size={14} aria-hidden />
            <PlayingCard card={me.intelTop} size="xs" /> top of deck
          </span>
        )}
      </div>
      {h.engineer && h.engineer.by !== view.youId && (
        <div className="engineer-public">
          <Wrench size={14} aria-hidden /> {nameOf(h.engineer.by)} is engineering the next card:
          <span className="engineer-cards">
            {h.engineer.cards.map((c) => (
              <PlayingCard key={c} card={c} size="xs" />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
