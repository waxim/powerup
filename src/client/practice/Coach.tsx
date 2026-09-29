import { Lightbulb, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { POWERS } from "../../shared/powers";
import type { TableView } from "../../shared/protocol";
import { getPref, setPref } from "../lib/storage";

interface Tip {
  id: string;
  /** Returns the tip text when it applies to the current view, otherwise null. */
  when: (view: TableView, ctx: CoachContext) => string | null;
}

interface CoachContext {
  /** Name and power of the most recent power an opponent played. */
  lastOpponentPower: { name: string; power: string } | null;
}

/** Tips appear once each, in the moment they're relevant. */
const TIPS: Tip[] = [
  {
    id: "welcome",
    when: (v) => `Hold'em with powers! Yours sit under your cards; the gold number is each one's energy cost (you have ${v.me?.energy ?? 10}).`,
  },
  {
    id: "your-turn",
    when: (v) => (v.me?.legal && v.me.powers.some((p) => p.playable) ? "Your turn: tap a glowing power to use it before you bet, or just bet." : null),
  },
  {
    id: "opponent-power",
    when: (_v, ctx) =>
      ctx.lastOpponentPower ? `${ctx.lastOpponentPower.name} played ${ctx.lastOpponentPower.power}. Every power is announced to the whole table.` : null,
  },
  {
    id: "exposed",
    when: (v) => (v.me?.hole.some((c) => c.exposed) ? "You were X-Rayed: one of your cards is face up for everyone. Reload can swap it." : null),
  },
  {
    id: "energy",
    when: (v) => (v.handNumber >= 2 ? `+${v.rules.energyPerHand} energy every hand, up to ${v.rules.maxEnergy}. Save up for the 5-cost powers.` : null),
  },
  {
    id: "emp",
    when: (v) => (v.hand?.empBy && v.hand.empBy !== v.youId ? "EMP! Your powers are offline until the next card is dealt." : null),
  },
  {
    id: "intel",
    when: (v) => (v.me?.intelTop ? "Intel: only you can see the top card of the deck, for the rest of the hand." : null),
  },
  {
    id: "engineered",
    when: (v) => (v.hand?.knownTop ? "The \"next card\" was chosen with Engineer: everyone knows it's coming." : null),
  },
  {
    id: "deployed",
    when: (v) => (v.hand?.board.some((b) => b.deployed) ? "The +1 card was Deployed: an extra community card for everyone." : null),
  },
  {
    id: "shield",
    when: (v) => (v.hand?.board.some((b) => b.locked) ? "Red cards are shielded: someone's all-in, so powers can't touch them." : null),
  },
  {
    id: "refill",
    when: (v) => (v.handNumber >= 3 ? `Used powers are replaced next hand, so you always start with ${v.rules.handSize}.` : null),
  },
];

const SHOW_MS = 12_000;

export function Coach({ view }: { view: TableView }) {
  const [enabled, setEnabled] = useState(() => getPref("coach", true));
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const [current, setCurrent] = useState<{ id: string; text: string } | null>(null);
  const shownAt = useRef(0);

  const ctx = useMemo<CoachContext>(() => {
    const entry = [...view.log].reverse().find((l) => l.kind === "power" && l.power && l.playerId && l.playerId !== view.youId && / plays /.test(l.text));
    const name = entry ? view.players.find((p) => p.id === entry.playerId)?.name : null;
    return { lastOpponentPower: entry && name ? { name, power: POWERS[entry.power!].name } : null };
  }, [view.log, view.players, view.youId]);

  // Pick the first unseen tip that applies; keep each on screen for a while before moving on.
  useEffect(() => {
    if (!enabled) return;
    if (current && Date.now() - shownAt.current < SHOW_MS) return;
    const next = TIPS.find((t) => !seen.has(t.id) && t.when(view, ctx));
    if (next && next.id !== current?.id) {
      setCurrent({ id: next.id, text: next.when(view, ctx)! });
      setSeen((s) => new Set(s).add(next.id));
      shownAt.current = Date.now();
    } else if (!next && current && Date.now() - shownAt.current >= SHOW_MS) {
      setCurrent(null);
    }
  }, [view, ctx, enabled, seen, current]);

  if (!enabled) return null;
  if (!current) return null;
  return (
    <div className="coach" role="status" aria-live="polite">
      <Lightbulb size={18} className="coach-icon" aria-hidden />
      <span className="coach-text">{current.text}</span>
      <button type="button" className="coach-next" onClick={() => setCurrent(null)}>
        Got it
      </button>
      <button
        type="button"
        className="coach-off"
        aria-label="Turn tips off"
        title="Turn tips off"
        onClick={() => {
          setPref("coach", false);
          setEnabled(false);
        }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
