import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, TableView } from "../../shared/protocol";
import { adoptSeatFromHash, getSeatToken, setSeatToken } from "./storage";

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "notfound";

export interface TableConnection {
  view: TableView | null;
  status: ConnectionStatus;
  error: string | null;
  clearError(): void;
  send(msg: ClientMessage): void;
  /** Current time on the server's clock (for countdowns). */
  serverNow(): number;
}

/** Live connection to one table's Durable Object, with automatic reconnects. */
export function useTable(tableId: string): TableConnection {
  const [view, setView] = useState<TableView | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    adoptSeatFromHash(tableId);
    let stopped = false;
    let attempt = 0;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      if (stopped) return;
      clearTimeout(retryTimer);
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/tables/${tableId}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
        ws.send(JSON.stringify({ t: "hello", token: getSeatToken(tableId) ?? undefined } satisfies ClientMessage));
        clearInterval(pingTimer);
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send("ping"), 20_000);
      };
      ws.onmessage = (event) => {
        if (typeof event.data !== "string" || event.data === "pong") return;
        const msg = JSON.parse(event.data) as ServerMessage;
        switch (msg.t) {
          case "state":
            offsetRef.current = msg.view.serverNow - Date.now();
            setView(msg.view);
            break;
          case "joined":
            setSeatToken(tableId, msg.token);
            break;
          case "error":
            setError(msg.message);
            break;
          case "notfound":
            stopped = true;
            setStatus("notfound");
            ws.close();
            break;
        }
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        if (wsRef.current !== ws || stopped) return;
        setStatus("reconnecting");
        retryTimer = setTimeout(connect, Math.min(8000, 400 * 2 ** attempt++));
      };
    };

    // Phones suspend sockets in the background; reconnect as soon as the tab is visible again.
    const onVisible = () => {
      const ws = wsRef.current;
      if (document.visibilityState === "visible" && (!ws || ws.readyState > WebSocket.OPEN)) connect();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    connect();
    return () => {
      stopped = true;
      clearInterval(pingTimer);
      clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      wsRef.current?.close();
    };
  }, [tableId]);

  const send = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else setError("Reconnecting… try again in a moment");
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { view, status, error, clearError, send, serverNow };
}

/** Re-render every `ms` milliseconds (for countdowns). */
export function useTicker(ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
