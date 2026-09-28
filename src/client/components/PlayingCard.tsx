import { rankLabel, suitOf, SUIT_SYMBOL, type Card } from "../../shared/cards";

export type CardSize = "xs" | "sm" | "md" | "lg";

interface Props {
  card: Card | null;
  size?: CardSize;
  /** Extra state styling. */
  exposed?: boolean;
  locked?: boolean;
  deployed?: boolean;
  current?: boolean;
  highlight?: boolean;
  dim?: boolean;
  selectable?: boolean;
  selected?: boolean;
  label?: string;
  onClick?: () => void;
  className?: string;
}

/** A playing card. `card = null` renders the card back. */
export function PlayingCard({
  card,
  size = "md",
  exposed,
  locked,
  deployed,
  current,
  highlight,
  dim,
  selectable,
  selected,
  label,
  onClick,
  className = "",
}: Props) {
  const classes = [
    "pcard",
    `pcard-${size}`,
    card ? `suit-${suitOf(card)}` : "pcard-back",
    exposed && "is-exposed",
    locked && "is-locked",
    deployed && "is-deployed",
    current && "is-current",
    highlight && "is-highlight",
    dim && "is-dim",
    selectable && "is-selectable",
    selected && "is-selected",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const content = card ? (
    <>
      <span className="pcard-rank">{rankLabel(card)}</span>
      <span className="pcard-suit">{SUIT_SYMBOL[suitOf(card)]}</span>
      <span className="pcard-pip">{SUIT_SYMBOL[suitOf(card)]}</span>
    </>
  ) : (
    <span className="pcard-back-mark" />
  );
  const aria = card ? `${rankLabel(card)} of ${{ s: "spades", h: "hearts", d: "diamonds", c: "clubs" }[suitOf(card)]}` : "Face-down card";
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} aria-label={aria} aria-pressed={selected}>
        {content}
        {label && <span className="pcard-label">{label}</span>}
      </button>
    );
  }
  return (
    <div className={classes} aria-label={aria} role="img">
      {content}
      {label && <span className="pcard-label">{label}</span>}
    </div>
  );
}
