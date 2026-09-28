import { X } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import { POWERS } from "../../shared/powers";
import type { LogEntry } from "../../shared/protocol";

export function LogPanel({ log, onClose }: { log: LogEntry[]; onClose?: () => void }) {
  const listRef = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);
  return (
    <div className="logpanel">
      <div className="logpanel-head">
        <h2>Table log</h2>
        {onClose && (
          <button type="button" className="btn btn-ghost icon-only" onClick={onClose} aria-label="Close log">
            <X size={18} />
          </button>
        )}
      </div>
      <ol ref={listRef}>
        {log.map((l) => (
          <li
            key={l.seq}
            className={`log-${l.kind}`}
            style={l.power ? ({ "--power": POWERS[l.power].color } as CSSProperties) : undefined}
          >
            {l.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
