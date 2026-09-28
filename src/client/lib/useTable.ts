import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, TableView } from "../../shared/protocol";
import { adoptSeatFromHash, clearSeatToken, getSeatToken, setSeatToken } from "./storage";

/** Ping this often; a socket that hasn't heard anything (not even a pong) for STALE_MS is treated as dead. */
const PING_MS = 15_000;
const STALE_MS = 40_000;
/** After the tab becomes visible again, a pong must arrive this quickly or we reconnect. */
const WAKE_CHECK_MS = 4_000;

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
    let lastHeard = Date.now();
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let wakeTimer: ReturnType<typeof setTimeout> | undefined;

    /** Swap a dead-looking socket for a fresh one (a half-open socket may never fire onclose). */
    const restart = () => {
      const old = wsRef.current;
      connect();
      old?.close();
    };

    const connect = () => {
      if (stopped) return;
      clearTimeout(retryTimer);
      clearTimeout(wakeTimer);
      clearInterval(pingTimer);
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/tables/${tableId}/ws`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        lastHeard = Date.now();
        setStatus("open");
        ws.send(JSON.stringify({ t: "hello", token: getSeatToken(tableId) ?? undefined } satisfies ClientMessage));
        clearInterval(pingTimer);
        pingTimer = setInterval(() => {
          if (wsRef.current !== ws || ws.readyState !== WebSocket.OPEN) return;
          if (Date.now() - lastHeard > STALE_MS) restart();
          else ws.send("ping");
        }, PING_MS);
      };
      ws.onmessage = (event) => {
        lastHeard = Date.now();
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
          case "left":
            clearSeatToken(tableId);
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

    // Phones suspend sockets in the background: when the tab is visible again, reconnect if the socket
    // is closed, or check that an "open" one still answers.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const ws = wsRef.current;
      if (!ws || ws.readyState > WebSocket.OPEN) {
        connect();
      } else if (ws.readyState === WebSocket.OPEN) {
        const sentAt = Date.now();
        ws.send("ping");
        clearTimeout(wakeTimer);
        wakeTimer = setTimeout(() => {
          if (wsRef.current === ws && lastHeard < sentAt) restart();
        }, WAKE_CHECK_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    connect();
    return () => {
      stopped = true;
      clearInterval(pingTimer);
      clearTimeout(retryTimer);
      clearTimeout(wakeTimer);
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
