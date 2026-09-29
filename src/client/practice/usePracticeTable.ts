import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { TableConnection } from "../lib/useTable";
import { practiceBot } from "./bot";
import type { PracticeConfig } from "./localTable";
import { PracticeRunner, type RunnerEnv, type SessionInfo } from "./runner";

const browserEnv: RunnerEnv = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (handle) => window.clearInterval(handle as number),
  doc: document,
};

/** A practice game in this tab, exposed as the same TableConnection a real table uses. */
export function usePracticeTable(config: PracticeConfig): { conn: TableConnection; session: SessionInfo; runner: PracticeRunner } {
  // Built once, without side effects; it only starts running when attached.
  const [runner] = useState(() => new PracticeRunner(config, browserEnv, practiceBot));
  useEffect(() => runner.attach(), [runner]);
  const snap = useSyncExternalStore(runner.subscribe, runner.getSnapshot);
  const conn = useMemo<TableConnection>(
    () => ({
      view: snap.view,
      status: "open",
      error: snap.error,
      clearError: runner.clearError,
      send: runner.send,
      serverNow: runner.serverNow,
    }),
    [snap, runner],
  );
  return { conn, session: snap.session, runner };
}
