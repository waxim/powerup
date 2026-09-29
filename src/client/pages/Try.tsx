import { ArrowRight, Bot, ChevronLeft, Play, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MODE_RULES, modeForPlayers } from "../../shared/powers";
import { GameTable } from "../game/GameTable";
import { chips } from "../lib/format";
import { linkHandler, navigate } from "../lib/router";
import { getSavedName } from "../lib/storage";
import { PERSONALITIES } from "../practice/bot";
import { Coach } from "../practice/Coach";
import type { PracticeOptions } from "../practice/localTable";
import { usePracticeTable } from "../practice/usePracticeTable";
import { Logo } from "./Home";

/** A practice session is "a few orbits"; after this many we offer to wrap up. */
const ORBITS = 3;
const STARTING_CHIPS = 1500;

interface Config {
  name: string;
  opponents: number;
}

export default function Try() {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    document.title = "Practice · PowerUp";
    return () => {
      document.title = "PowerUp";
    };
  }, []);
  if (!config) return <TrySetup onStart={setConfig} />;
  return <PracticeGame config={config} onSetup={() => setConfig(null)} />;
}

function TrySetup({ onStart }: { onStart: (c: Config) => void }) {
  const [name, setName] = useState(() => getSavedName());
  const [opponents, setOpponents] = useState(2);
  const mode = modeForPlayers(opponents + 1);
  const rules = MODE_RULES[mode];
  const start = (e: FormEvent) => {
    e.preventDefault();
    // The table log reads "<name> checks", so the default is a name rather than "You".
    onStart({ name: name.trim() || "Player", opponents });
  };
  return (
    <div className="page try-setup">
      <header className="lobby-head">
        <a href="/" onClick={linkHandler("/")} className="btn btn-ghost">
          <ChevronLeft size={18} aria-hidden /> Back
        </a>
        <Logo small />
      </header>
      <form className="panel-card" onSubmit={start}>
        <h1>
          <Bot size={26} className="inline-icon" aria-hidden /> Try it
        </h1>
        <p className="muted">
          Play a few orbits against computer players to see how PowerUp plays. Tips pop up as powers come into play. Nothing
          is saved or sent anywhere, and it runs entirely in your browser.
        </p>
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="Player" autoComplete="nickname" />
        </label>
        <div className="field">
          <span>Opponents</span>
          <div className="segmented" role="radiogroup" aria-label="Opponents">
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" key={n} role="radio" aria-checked={n === opponents} className={n === opponents ? "is-active" : ""} onClick={() => setOpponents(n)}>
                {n}
              </button>
            ))}
          </div>
          <small className={mode === "double" ? "hint hint-double" : "hint"}>
            {mode === "double"
              ? `${opponents + 1} players: the Double game, with ${rules.handSize} powers each and up to ${rules.maxEnergy} energy.`
              : opponents === 2
                ? "Three-handed, just like the original Power Up."
                : "Heads-up: just you and one bot."}
          </small>
        </div>
        <ul className="try-facts">
          <li>{chips(STARTING_CHIPS)} chips each, blinds start at 10/20 and rise every 5 minutes</li>
          <li>Out of chips? Rebuy as often as you like</li>
          <li>Opponents: {PERSONALITIES.slice(0, opponents).map((p) => p.name).join(", ")}</li>
        </ul>
        <button className="btn btn-primary btn-big">
          <Play size={20} aria-hidden /> Deal me in
        </button>
      </form>
    </div>
  );
}

function PracticeGame({ config, onSetup }: { config: Config; onSetup: () => void }) {
  const [round, setRound] = useState(0);
  const [wrapUpDismissed, setWrapUpDismissed] = useState(false);
  const options = useMemo<PracticeOptions>(
    () => ({
      name: config.name,
      botNames: PERSONALITIES.slice(0, config.opponents).map((p) => p.name),
      settings: {
        name: "Practice",
        maxSeats: config.opponents + 1,
        startingChips: STARTING_CHIPS,
        startingSmallBlind: 10,
        levelMinutes: 5,
        rebuys: -1,
        turnSeconds: 90,
      },
    }),
    [config],
  );
  const conn = usePracticeTable(options, round);
  const { error, clearError } = conn;
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 3500);
    return () => clearTimeout(t);
  }, [error, clearError]);

  const v = conn.view;
  if (!v) {
    return (
      <div className="page center-page">
        <Logo />
        <p className="loading">Shuffling up…</p>
      </div>
    );
  }

  const restart = () => {
    setWrapUpDismissed(false);
    setRound((r) => r + 1);
  };
  const you = v.players.find((p) => p.isYou);
  const handsPlayed = v.hand?.phase === "done" ? v.handNumber : v.handNumber - 1;
  const orbitsDone = Math.floor(handsPlayed / v.players.length);
  const between = !v.hand || v.hand.phase === "done";
  const out = you?.status === "out";
  const showWrapUp = out || (!wrapUpDismissed && orbitsDone >= ORBITS && between && !v.me?.rebuy);
  const net = (you?.chips ?? 0) - STARTING_CHIPS * (1 + (you?.rebuysUsed ?? 0));

  const wrapUp = showWrapUp ? (
    <div className="modal-backdrop">
      <div className="modal modal-win" role="dialog" aria-modal="true" aria-label="Practice summary">
        <h2>
          <Sparkles size={22} aria-hidden /> {out ? "You're out" : `${ORBITS} orbits played`}
        </h2>
        <p>
          {out
            ? "Thanks for practising!"
            : `That's ${handsPlayed} hands. You're ${net >= 0 ? "up" : "down"} ${chips(Math.abs(net))} chips${you?.rebuysUsed ? ` after ${you.rebuysUsed} rebuy${you.rebuysUsed > 1 ? "s" : ""}` : ""}.`}{" "}
          Ready to play your friends? Create a table and share the link.
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate("/")}>
            Create a real table <ArrowRight size={18} aria-hidden />
          </button>
          {!out && (
            <button type="button" className="btn btn-ghost" onClick={() => setWrapUpDismissed(true)}>
              Keep playing
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={restart}>
            <RotateCcw size={18} aria-hidden /> Start over
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <GameTable
        conn={conn}
        practice={{ onRestart: restart, onExit: onSetup }}
        belowTable={<Coach key={round} view={v} />}
        overlay={wrapUp}
      />
      {error && (
        <div className="toast-error" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
    </>
  );
}
