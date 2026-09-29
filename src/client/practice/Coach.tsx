import { Lightbulb, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TableView } from "../../shared/protocol";
import { getJson, setJson } from "../lib/storage";
import { nextTip, type Tip } from "./coach";

/** The game waits this long while you read a new tip... */
const HOLD_MS = 5000;
/** ...and the tip stays up this long unless you dismiss it or act. */
const SHOW_MS = 11_000;
/** Breathing room between two tips. */
const GAP_MS = 1500;

const SEEN_KEY = "try:tips";

export function loadSeenTips(): Set<string> {
  const ids = getJson<unknown>(SEEN_KEY, []);
  return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []);
}

export function resetSeenTips(): void {
  setJson(SEEN_KEY, null);
}

interface Props {
  view: TableView;
  handLimit: number;
  /** Changes whenever the player sends something: acting dismisses the tip. */
  actions: number;
  /** Stop or restart the game clock while a tip is being read. */
  onHold(holding: boolean): void;
  onDisable(): void;
}

/** One short tip at a time, each shown once, when what it explains happens at the table. */
export function Coach({ view, handLimit, actions, onHold, onDisable }: Props) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [quiet, setQuiet] = useState(false);
  const seen = useRef<Set<string>>(loadSeenTips());
  // The last view looked at while no tip was up, so events during a tip aren't missed.
  const prev = useRef<TableView | null>(null);
  const holdRef = useRef(onHold);
  holdRef.current = onHold;

  useEffect(() => {
    if (tip || quiet) return;
    const next = nextTip(view, prev.current, seen.current, { handLimit });
    // Only move on once nothing is left to say, so two things happening together both get a tip.
    if (next) setTip(next);
    else prev.current = view;
  }, [view, tip, quiet, handLimit]);

  // Hold the game while a new tip is read, then let it carry on; hide the tip after a while.
  useEffect(() => {
    if (!tip) return;
    seen.current.add(tip.id);
    setJson(SEEN_KEY, [...seen.current]);
    holdRef.current(true);
    const release = setTimeout(() => holdRef.current(false), HOLD_MS);
    const hide = setTimeout(() => setTip(null), SHOW_MS);
    return () => {
      clearTimeout(release);
      clearTimeout(hide);
      holdRef.current(false);
      setQuiet(true);
    };
  }, [tip]);

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
