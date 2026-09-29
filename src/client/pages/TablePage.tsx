import { Bot, WifiOff } from "lucide-react";
import { useEffect, useRef } from "react";
import { TryLink } from "../components/TryLink";
import { GameTable } from "../game/GameTable";
import { linkHandler } from "../lib/router";
import { useTable } from "../lib/useTable";
import { Lobby } from "./Lobby";
import { Logo } from "./Home";

const STARTED_TITLE = "▶ Your game started · PowerUp";

export function TablePage({ id }: { id: string }) {
  const conn = useTable(id);
  const { error, clearError } = conn;

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 3500);
    return () => clearTimeout(t);
  }, [error, clearError]);

  useEffect(() => {
    const name = conn.view?.settings.name;
    document.title = name ? `${name} · PowerUp` : "PowerUp";
    return () => {
      document.title = "PowerUp";
    };
  }, [conn.view?.settings.name]);

  // Waiting players often practise in another tab: tell them when their game starts.
  const status = conn.view?.status;
  const lastStatus = useRef(status);
  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = status;
    if (was !== "lobby" || status !== "running" || !document.hidden) return;
    const title = document.title;
    document.title = STARTED_TITLE;
    const onVisible = () => {
      if (document.hidden) return;
      document.title = title;
      document.removeEventListener("visibilitychange", onVisible);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      // The game moved on (finished, rematch) while the tab was still hidden.
      if (document.title === STARTED_TITLE) document.title = title;
    };
  }, [status]);

  if (conn.status === "notfound") {
    return (
      <div className="page center-page">
        <Logo />
        <h1>Table not found</h1>
        <p>This table doesn't exist, or it was closed after sitting idle.</p>
        <a className="btn btn-primary" href="/" onClick={linkHandler("/")}>
          Create a new table
        </a>
        <TryLink className="btn btn-ghost">
          <Bot size={18} aria-hidden /> Try a practice game
        </TryLink>
      </div>
    );
  }

  if (!conn.view) {
    return (
      <div className="page center-page">
        <Logo />
        <p className="loading">{conn.status === "reconnecting" ? "Can't reach the table, retrying…" : "Joining table…"}</p>
      </div>
    );
  }

  return (
    <>
      {conn.view.status === "lobby" ? <Lobby conn={conn} /> : <GameTable conn={conn} />}
      {conn.status === "reconnecting" && (
        <div className="banner banner-warn" role="status">
          <WifiOff size={16} aria-hidden /> Connection lost, reconnecting…
        </div>
      )}
      {error && (
        <div className="toast-error" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
    </>
  );
}
