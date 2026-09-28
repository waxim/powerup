import { TrendingUp } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { POWERS } from "../../shared/powers";
import type { LogEntry } from "../../shared/protocol";
import { PowerIcon } from "../components/PowerCard";

const SHOW_MS = 2600;

/** Banners for power plays and blind increases, fed from the table log. */
export function Announcer({ log, onNew }: { log: LogEntry[]; onNew?: (entries: LogEntry[]) => void }) {
  const lastSeq = useRef<number | null>(null);
  const [queue, setQueue] = useState<LogEntry[]>([]);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  useEffect(() => {
    const latest = log.at(-1)?.seq ?? 0;
    if (lastSeq.current === null) {
      // Don't replay history when the page loads.
      lastSeq.current = latest;
      return;
    }
    const since = lastSeq.current;
    const fresh = log.filter((l) => l.seq > since);
    lastSeq.current = Math.max(since, latest);
    if (!fresh.length) return;
    onNewRef.current?.(fresh);
    // Wins are shown on the table itself (pot label and seats), so only powers and blinds get a banner.
    const shown = fresh.filter((l) => (l.kind === "power" && l.power) || l.kind === "level");
    if (shown.length) setQueue((q) => [...q, ...shown].slice(-5));
  }, [log]);

  const current = queue[0];
  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setQueue((q) => q.slice(1)), queue.length > 2 ? SHOW_MS / 2 : SHOW_MS);
    return () => clearTimeout(t);
  }, [current, queue.length]);

  if (!current) return null;
  const power = current.kind === "power" && current.power ? POWERS[current.power] : null;
  const style = power ? ({ "--power": power.color } as CSSProperties) : undefined;
  return (
    <div key={current.seq} className={`announce announce-${current.kind}`} style={style} role="status">
      <span className="announce-icon">
        {power ? <PowerIcon type={power.type} size={26} /> : <TrendingUp size={24} />}
      </span>
      <span className="announce-body">
        {power && <span className="announce-title">{power.name}</span>}
        <span className="announce-text">{current.text}</span>
      </span>
    </div>
  );
}
