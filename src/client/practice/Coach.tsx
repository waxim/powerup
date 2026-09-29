import { Lightbulb, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PowerType } from "../../shared/powers";
import type { TableView } from "../../shared/protocol";
import { getJson, setJson } from "../lib/storage";
import { nextTip, type Tip } from "./tips";

/** A `brief` tip stops the game this long. */
const BRIEF_HOLD_MS = 4000;
/** Tips hide themselves after this long. */
const SHOW_MS = 11_000;
/** Breathing room between two tips. */
const GAP_MS = 1500;

const SEEN_KEY = "try:tips";

/** Tips about a particular hand ("New powers" on hand 3) are only remembered for the session. */
const persistent = (id: string) => !id.startsWith("new-powers-");

export function loadSeenTips(): Set<string> {
  const ids = getJson<unknown>(SEEN_KEY, []);
  return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string" && persistent(x)) : []);
}

export function resetSeenTips(): void {
  setJson(SEEN_KEY, null);
}

interface Props {
  view: TableView;
  handLimit: number;
  /** Changes whenever the player sends something: acting dismisses the tip. */
  actions: number;
  /** The power the player last selected, for its first-time explanation. */
  selected: PowerType | null;
  /** How many power types the player has played this session. */
  tried: number;
  /** Something else is on screen (the Hint, the cheat sheet): keep quiet. */
  suppressed?: boolean;
  /** Stop or restart the game clock while a tip is being read. */
  onHold(holding: boolean): void;
  onDisable(): void;
}

/** A decision point, so at most one tip per decision stops the clock. */
const decisionKey = (v: TableView) => `${v.handNumber}:${v.hand?.street}:${!!v.me?.legal}`;

/** One short tip at a time, each shown once, when what it explains happens at the table. */
export function Coach({ view, handLimit, actions, selected, tried, suppressed = false, onHold, onDisable }: Props) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [quiet, setQuiet] = useState(false);
  const seen = useRef<Set<string>>(loadSeenTips());
  // The last view looked at while no tip was up, so events during a tip aren't missed.
  const prev = useRef<TableView | null>(null);
  const lastHoldAt = useRef<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const holdRef = useRef(onHold);
  holdRef.current = onHold;
  const skipGap = useRef(false);
  const tipRef = useRef(tip);
  tipRef.current = tip;

  useEffect(() => {
    if (suppressed) setTip(null);
  }, [suppressed]);

  useEffect(() => {
    if (tip || quiet || suppressed) return;
    const next = nextTip(view, prev.current, seen.current, { handLimit, selected, tried });
    if (!next) {
      prev.current = view;
      return;
    }
    // Only one tip per decision stops the clock.
    if (next.hold === "turn" && lastHoldAt.current === decisionKey(view)) setTip({ ...next, hold: "none" });
    else setTip(next);
  }, [view, tip, quiet, suppressed, handLimit, selected, tried]);

  // While a tip is up: hold the game as its kind says, spotlight what it's about, and hide it after a while.
  useEffect(() => {
    if (!tip) return;
    seen.current.add(tip.id);
    setJson(SEEN_KEY, [...seen.current].filter(persistent));
    const timers: ReturnType<typeof setTimeout>[] = [setTimeout(() => setTip(null), SHOW_MS)];
    if (tip.hold !== "none") {
      holdRef.current(true);
      if (tip.hold === "turn") lastHoldAt.current = decisionKey(viewRef.current);
      else timers.push(setTimeout(() => holdRef.current(false), BRIEF_HOLD_MS));
    }
    const spot = tip.target ? document.querySelector(`[data-coach="${tip.target}"]`) : null;
    spot?.classList.add("coach-spot");
    return () => {
      timers.forEach(clearTimeout);
      spot?.classList.remove("coach-spot");
      holdRef.current(false);
      if (!skipGap.current) setQuiet(true);
      skipGap.current = false;
    };
  }, [tip]);

  // Selecting a power for the first time explains it straight away, cutting in on any other tip.
  useEffect(() => {
    if (!selected || seen.current.has(`select-${selected}`)) return;
    setQuiet(false);
    if (tipRef.current) {
      skipGap.current = true;
      setTip(null);
    }
  }, [selected]);

  // A tip about a moment that has passed (the player's turn ended) goes away.
  useEffect(() => {
    if (tip?.until?.(view)) setTip(null);
  }, [tip, view]);

  useEffect(() => {
    if (!quiet) return;
    const t = setTimeout(() => setQuiet(false), GAP_MS);
    return () => clearTimeout(t);
  }, [quiet]);

  // Acting means you've moved on.
  const lastActions = useRef(actions);
  useEffect(() => {
    if (actions === lastActions.current) return;
    lastActions.current = actions;
    setTip(null);
  }, [actions]);

  if (!tip) return null;
  return (
    <div className="coach" role="status" aria-live="polite">
      <Lightbulb size={18} className="coach-icon" aria-hidden />
      <span className="coach-text">{tip.text}</span>
      <button type="button" className="coach-next" onClick={() => setTip(null)}>
        Got it
      </button>
      <button type="button" className="coach-off" aria-label="Turn tips off" title="Turn tips off" onClick={onDisable}>
        <X size={16} />
      </button>
    </div>
  );
}
