import { BookOpen, Check, Link, Menu, Palette, Pause, Play, ScrollText, Smartphone, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ClientMessage, TableView } from "../../shared/protocol";
import { chips, clock } from "../lib/format";
import { getSeatToken } from "../lib/storage";
import { Logo } from "../pages/Home";

interface Props {
  view: TableView;
  send: (msg: ClientMessage) => void;
  serverNow: number;
  fourColor: boolean;
  setFourColor: (v: boolean) => void;
  sound: boolean;
  setSound: (v: boolean) => void;
  onToggleLog: () => void;
}

export function TopBar({ view, send, serverNow, fourColor, setFourColor, sound, setSound, onToggleLog }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const isHost = view.youId === view.hostId;
  const remaining = view.level.endsAt !== null ? view.level.endsAt - serverNow : view.level.remainingMs;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy this link", text);
    }
    setCopied(what);
    setTimeout(() => setCopied(null), 1600);
  };

  const token = getSeatToken(view.id);
  const tableUrl = `${window.location.origin}/t/${view.id}`;

  return (
    <header className="topbar">
      <Logo small />
      <div className="level" title="Blind level">
        <span className="level-blinds">
          {chips(view.level.sb)}/{chips(view.level.bb)}
        </span>
        {view.status === "running" && (
          <span className="level-next">
            {view.paused ? "paused" : `${clock(remaining)} → ${chips(view.level.next.sb)}/${chips(view.level.next.bb)}`}
          </span>
        )}
      </div>
      <div className="topbar-actions" ref={menuRef}>
        <button type="button" className="btn btn-ghost icon-only log-toggle" onClick={onToggleLog} aria-label="Table log">
          <ScrollText size={20} />
        </button>
        <button type="button" className="btn btn-ghost icon-only" onClick={() => setOpen((o) => !o)} aria-label="Menu" aria-expanded={open}>
          <Menu size={20} />
        </button>
        {open && (
          <div className="menu" role="menu">
            <div className="menu-info">
              {view.settings.name || "PowerUp table"} · hand #{view.handNumber} · {view.mode === "double" ? "Double game" : "Classic"}
            </div>
            <button type="button" role="menuitem" onClick={() => copy("table", tableUrl)}>
              {copied === "table" ? <Check size={18} /> : <Link size={18} />} Copy table link
            </button>
            {view.youId && token && (
              <button type="button" role="menuitem" onClick={() => copy("seat", `${tableUrl}#seat=${token}`)}>
                {copied === "seat" ? <Check size={18} /> : <Smartphone size={18} />} Copy my seat link (other device)
              </button>
            )}
            <button type="button" role="menuitem" onClick={() => setFourColor(!fourColor)}>
              <Palette size={18} /> {fourColor ? "Two-colour deck" : "Four-colour deck"}
            </button>
            <button type="button" role="menuitem" onClick={() => setSound(!sound)}>
              {sound ? <VolumeX size={18} /> : <Volume2 size={18} />} {sound ? "Mute sounds" : "Turn sounds on"}
            </button>
            <a role="menuitem" href="/rules" target="_blank" rel="noreferrer">
              <BookOpen size={18} /> How to play
            </a>
            {isHost && view.status === "running" && (
              <button type="button" role="menuitem" onClick={() => send({ t: view.paused ? "resume" : "pause" })}>
                {view.paused ? <Play size={18} /> : <Pause size={18} />} {view.paused ? "Resume game" : "Pause game"}
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
