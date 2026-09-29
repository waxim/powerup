import { useCallback, useEffect, useRef, useState } from "react";
import { cryptoRng } from "../../engine/rng";
import type { ClientMessage, TableView } from "../../shared/protocol";
import type { TableConnection } from "../lib/useTable";
import { practiceBot } from "./bot";
import { LocalTable, type PracticeOptions } from "./localTable";

const browserClock = {
  now: () => Date.now(),
  setTimeout: (fn: () => void, ms: number) => window.setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => window.clearTimeout(handle as number),
};

/**
 * A TableConnection backed by a LocalTable in this tab, so the regular table UI can render a practice game.
 * `key` restarts the game when it changes.
 */
export function usePracticeTable(options: PracticeOptions, key: number): TableConnection {
  const [view, setView] = useState<TableView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const tableRef = useRef<LocalTable | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const table = new LocalTable(optionsRef.current, cryptoRng, practiceBot, browserClock, setView, setError);
    tableRef.current = table;
    const onVisibility = () => table.setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      table.dispose();
      tableRef.current = null;
    };
  }, [key]);

  const send = useCallback((msg: ClientMessage) => tableRef.current?.send(msg), []);
  const clearError = useCallback(() => setError(null), []);
  const serverNow = useCallback(() => Date.now(), []);

  return { view, status: "open", error, clearError, send, serverNow };
}
