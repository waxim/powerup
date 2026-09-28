import { Check, Copy, Crown, LogOut, Play, Share2, UserX, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import { MODE_RULES, POWERS, POWER_TYPES, modeForPlayers } from "../../shared/powers";
import { rebuysLabel } from "../../shared/settings";
import { chips, initials } from "../lib/format";
import { linkHandler } from "../lib/router";
import { getSavedName, saveName } from "../lib/storage";
import type { TableConnection } from "../lib/useTable";
import { Logo } from "./Home";

export function ShareBox({ tableId }: { tableId: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/t/${tableId}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt("Copy this link", url);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: "Join my PowerUp table", text: "Pull up a chair, PowerUp poker is on:", url });
    } catch {
      // cancelled
    }
  };
  return (
    <div className="share">
      <div className="share-url" title={url}>
        {url.replace(/^https?:\/\//, "")}
      </div>
      <button type="button" className="btn btn-primary" onClick={copy}>
        {copied ? <Check size={18} aria-hidden /> : <Copy size={18} aria-hidden />} {copied ? "Copied" : "Copy link"}
      </button>
      {"share" in navigator && (
        <button type="button" className="btn btn-ghost icon-only" onClick={share} aria-label="Share">
          <Share2 size={18} aria-hidden />
        </button>
      )}
    </div>
  );
}

export function Lobby({ conn }: { conn: TableConnection }) {
  const v = conn.view!;
  const you = v.players.find((p) => p.isYou);
  const isHost = v.youId === v.hostId;
  const host = v.players.find((p) => p.isHost);
  const [name, setName] = useState(getSavedName);
  const s = v.settings;
  const full = v.players.length >= s.maxSeats;
  const mode = modeForPlayers(v.players.length);
  const rules = MODE_RULES[mode];

  const join = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    saveName(trimmed);
    conn.send({ t: "join", name: trimmed });
  };

  // The seat token is cleared when the server confirms (the "left" message).
  const leave = () => conn.send({ t: "leave" });

  return (
    <div className="page lobby">
      <header className="lobby-head">
        <a href="/" onClick={linkHandler("/")} aria-label="PowerUp home">
          <Logo small />
        </a>
      </header>

      <section className="panel-card">
        <h1 className="table-title">{s.name || `${host?.name ?? "A"}'s table`}</h1>
        <p className="muted">
          {isHost ? "Share this link with your friends. They join with just their name." : `Hosted by ${host?.name}. Share the link to invite more players.`}
        </p>
        <ShareBox tableId={v.id} />
        <dl className="settings-summary">
          <div>
            <dt>Chips</dt>
            <dd>{chips(s.startingChips)}</dd>
          </div>
          <div>
            <dt>Blinds</dt>
            <dd>
              {chips(v.level.sb)}/{chips(v.level.bb)}
            </dd>
          </div>
          <div>
            <dt>Levels</dt>
            <dd>{s.levelMinutes} min</dd>
          </div>
          <div>
            <dt>Rebuys</dt>
            <dd>{rebuysLabel(s.rebuys)}</dd>
          </div>
          <div>
            <dt>Turn</dt>
            <dd>{s.turnSeconds}s</dd>
          </div>
          <div>
            <dt>Powers</dt>
            <dd>{s.powers.length === POWER_TYPES.length ? "All 10" : s.powers.map((p) => POWERS[p].name).join(", ")}</dd>
          </div>
        </dl>
      </section>

      <section className="panel-card">
        <div className="seats-head">
          <h2>
            <Users size={20} aria-hidden /> Players {v.players.length}/{s.maxSeats}
          </h2>
          <span className={mode === "double" ? "mode-pill mode-double" : "mode-pill"}>
            {mode === "double" ? "Double game" : "Classic"} · {rules.handSize} powers · max {rules.maxEnergy}⚡
          </span>
        </div>
        <ul className="seat-list">
          {v.players.map((p) => (
            <li key={p.id} className={p.isYou ? "is-you" : ""}>
              <span className="avatar">{initials(p.name)}</span>
              <span className="seat-list-name">
                {p.name}
                {p.isHost && <Crown size={16} className="crown" aria-label="host" />}
                {p.isYou && <span className="you-tag">you</span>}
              </span>
              <span className={p.connected ? "dot dot-on" : "dot"} title={p.connected ? "Online" : "Offline"} />
              {isHost && !p.isHost && (
                <button type="button" className="btn btn-ghost icon-only" onClick={() => conn.send({ t: "kick", playerId: p.id })} aria-label={`Remove ${p.name}`}>
                  <UserX size={18} aria-hidden />
                </button>
              )}
            </li>
          ))}
          {Array.from({ length: s.maxSeats - v.players.length }, (_, i) => (
            <li key={`open-${i}`} className="open-seat">
              <span className="avatar avatar-empty" />
              <span className="seat-list-name">Open seat</span>
            </li>
          ))}
        </ul>

        {!you && !full && (
          <form className="join" onSubmit={join}>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Your name" aria-label="Your name" autoFocus />
            <button className="btn btn-primary" disabled={!name.trim()}>
              Take a seat
            </button>
          </form>
        )}
        {!you && full && <p className="muted">The table is full. You can stay and watch.</p>}

        {you && isHost && (
          <button type="button" className="btn btn-primary btn-big" disabled={v.players.length < 2} onClick={() => conn.send({ t: "start" })}>
            <Play size={20} aria-hidden /> {v.players.length < 2 ? "Waiting for players…" : `Start game (${v.players.length} players)`}
          </button>
        )}
        {you && !isHost && (
          <div className="waiting">
            <p>Waiting for {host?.name ?? "the host"} to start the game…</p>
            <button type="button" className="btn btn-ghost" onClick={leave}>
              <LogOut size={18} aria-hidden /> Leave
            </button>
          </div>
        )}
        <p className="muted small">Seats lock when the game starts. Late arrivals can watch.</p>
      </section>

      <section className="lobby-log panel-card">
        <h2>Activity</h2>
        <ul>
          {v.log.slice(-6).map((l) => (
            <li key={l.seq}>{l.text}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
