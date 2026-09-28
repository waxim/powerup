import { Crown, WifiOff, Zap } from "lucide-react";
import type { CSSProperties } from "react";
import type { Card } from "../../shared/cards";
import type { PlayerView } from "../../shared/protocol";
import { PlayingCard } from "../components/PlayingCard";
import { initials, ordinal, shortChips } from "../lib/format";

interface Props {
  player: PlayerView;
  style: CSSProperties;
  /** 0..1 of the turn clock left (only when it's this player's turn). */
  timeLeft: number | null;
  winningCards: Card[] | null;
}

export function TimerRing({ fraction }: { fraction: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const urgent = fraction < 0.25;
  return (
    <svg className={urgent ? "timer-ring is-urgent" : "timer-ring"} viewBox="0 0 60 60" aria-hidden>
      <circle cx="30" cy="30" r={r} className="timer-track" />
      <circle
        cx="30"
        cy="30"
        r={r}
        className="timer-fill"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0, Math.min(1, fraction)))}
      />
    </svg>
  );
}

export function Seat({ player: p, style, timeLeft, winningCards }: Props) {
  const out = p.status === "out" || (p.status === "busted" && !p.inHand);
  const classes = [
    "seat",
    p.isYou && "is-you",
    p.isTurn && "is-turn",
    p.folded && "is-folded",
    p.allIn && "is-allin",
    out && "is-out",
    p.won > 0 && "is-winner",
    p.away && "is-away",
  ]
    .filter(Boolean)
    .join(" ");

  let tag: string | null = p.lastAction;
  if (p.won > 0) tag = `+${shortChips(p.won)}`;
  else if (p.handLabel) tag = p.handLabel;
  else if (p.status === "busted") tag = "Rebuy?";
  else if (out) tag = p.place ? `${ordinal(p.place)} place` : "Out";
  else if (p.away && !p.lastAction) tag = "Away";

  return (
    <div className={classes} style={style}>
      {!p.isYou && p.hole.length > 0 && (
        <div className="seat-cards">
          {p.hole.map((c, i) => (
            <PlayingCard
              key={i}
              card={c.card}
              size="xs"
              exposed={c.exposed}
              highlight={!!c.card && !!winningCards?.includes(c.card)}
            />
          ))}
        </div>
      )}
      <div className="seat-box">
        <div className="seat-avatar">
          <span>{initials(p.name)}</span>
          {timeLeft !== null && <TimerRing fraction={timeLeft} />}
          {p.isButton && <span className="dealer-btn" title="Dealer">D</span>}
          {(p.isSmallBlind || p.isBigBlind) && <span className="blind-badge">{p.isBigBlind ? "BB" : "SB"}</span>}
        </div>
        <div className="seat-info">
          <div className="seat-name">
            {p.name}
            {p.isHost && <Crown size={12} className="crown" aria-label="host" />}
            {!p.connected && <WifiOff size={12} className="offline" aria-label="offline" />}
          </div>
          <div className="seat-line">
            <span className="seat-stack">{out ? "—" : shortChips(p.chips)}</span>
            <span className="seat-energy" title={`${p.energy} energy`}>
              <Zap size={11} aria-hidden />
              {p.energy}
            </span>
            <span className="seat-powers" title={`${p.powerCount} powers`}>
              {Array.from({ length: p.powerCount }, (_, i) => (
                <i key={i} />
              ))}
            </span>
            {p.intel && <span className="seat-intel" title="Intel active">INTEL</span>}
          </div>
        </div>
      </div>
      {tag && <div className={p.won > 0 ? "seat-tag is-win" : "seat-tag"}>{tag}</div>}
    </div>
  );
}
