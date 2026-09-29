import { ArrowRight, BookOpen, Bot, ChevronLeft, Play, RotateCcw, Settings2, Sparkles, Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { MODE_RULES, POWERS, POWER_TYPES, modeForPlayers, type PowerType } from "../../shared/powers";
import type { TableView } from "../../shared/protocol";
import { PowerIcon } from "../components/PowerCard";
import { GameTable } from "../game/GameTable";
import { chips, ordinal } from "../lib/format";
import { linkHandler, navigate } from "../lib/router";
import { getJson, getPref, getSavedName, saveName, setJson, setPref } from "../lib/storage";
import { PERSONALITIES, pickOpponents } from "../practice/bot";
import { Coach, resetSeenTips } from "../practice/Coach";
import { PRACTICE_DEFAULTS, type PracticeConfig } from "../practice/localTable";
import { newSeed, type PracticeRunner, type SessionInfo } from "../practice/runner";
import { usePracticeTable } from "../practice/usePracticeTable";
import { Logo } from "./Home";

const ORBIT_OPTIONS = [2, 3, 5] as const;
/** Rough real-world pace, for the setup screen's estimate. */
const SECONDS_PER_HAND = 50;

interface Setup {
  name: string;
  opponents: number;
  orbits: number;
}

const SETUP_KEY = "try:setup";

function loadSetup(): Setup {
  const saved = getJson<Partial<Setup>>(SETUP_KEY, {});
  const opponents = Number(saved.opponents);
  const orbits = Number(saved.orbits);
  return {
    name: getSavedName(),
    opponents: opponents >= 1 && opponents <= 5 ? Math.round(opponents) : 2,
    orbits: (ORBIT_OPTIONS as readonly number[]).includes(orbits) ? orbits : 3,
  };
}

export default function Try() {
  const [config, setConfig] = useState<PracticeConfig | null>(null);
  useEffect(() => {
    document.title = "Practice · PowerUp";
    return () => {
      document.title = "PowerUp";
    };
  }, []);
  if (!config) return <TrySetup onStart={setConfig} />;
  return <PracticeGame config={config} onSetup={() => setConfig(null)} />;
}

function TrySetup({ onStart }: { onStart: (c: PracticeConfig) => void }) {
  const [setup, setSetup] = useState(loadSetup);
  const [tips, setTips] = useState(() => getPref("tips", true));
  const [tipsReset, setTipsReset] = useState(false);
  const { opponents, orbits } = setup;
  const players = opponents + 1;
  const mode = modeForPlayers(players);
  const rules = MODE_RULES[mode];
  const hands = orbits * players;
  const minutes = Math.max(1, Math.round((hands * SECONDS_PER_HAND) / 60));
  const bots = pickOpponents(setup.name || "Player", opponents);

  const start = (e: FormEvent) => {
    e.preventDefault();
    const name = setup.name.trim();
    if (name) saveName(name);
    setJson(SETUP_KEY, { opponents, orbits });
    setPref("tips", tips);
    // The table log reads "<name> checks", so the fallback is a name rather than "You".
    onStart({ name: name || "Player", opponents, orbits, seed: newSeed() });
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
          <Bot size={26} className="inline-icon" aria-hidden /> Practice against bots
        </h1>
        <ul className="try-intro">
          <li>It's Texas hold'em: make the best five-card hand, or make everyone else fold.</li>
          <li>Plus powers: cards that bend the hand, paid for with energy. You get more every hand.</li>
          <li>On your turn, play powers first, then bet.</li>
        </ul>
        <label className="field">
          <span>
            Your name <em>optional</em>
          </span>
          <input
            value={setup.name}
            onChange={(e) => setSetup((s) => ({ ...s, name: e.target.value }))}
            maxLength={20}
            placeholder="Player"
            autoComplete="nickname"
          />
        </label>
        <div className="field">
          <span>Opponents</span>
          <div className="segmented" role="radiogroup" aria-label="Opponents">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                type="button"
                key={n}
                role="radio"
                aria-checked={n === opponents}
                className={n === opponents ? "is-active" : ""}
                onClick={() => setSetup((s) => ({ ...s, opponents: n }))}
              >
                {n}
              </button>
            ))}
          </div>
          <small className={mode === "double" ? "hint hint-double" : "hint"}>
            {mode === "double"
              ? `${players} players: the Double game, with ${rules.handSize} powers each and up to ${rules.maxEnergy} energy.`
              : opponents === 2
                ? "Three-handed, just like the original Power Up."
                : "Heads-up: just you and one bot."}
          </small>
        </div>
        <div className="field">
          <span>Length</span>
          <div className="segmented" role="radiogroup" aria-label="Length">
            {ORBIT_OPTIONS.map((n) => (
              <button
                type="button"
                key={n}
                role="radio"
                aria-checked={n === orbits}
                className={n === orbits ? "is-active" : ""}
                onClick={() => setSetup((s) => ({ ...s, orbits: n }))}
              >
                {n} orbits
              </button>
            ))}
          </div>
          <small className="hint">
            {hands} hands, about {minutes} minutes. Everyone deals once per orbit.
          </small>
        </div>
        <ul className="try-facts">
          <li>
            {chips(PRACTICE_DEFAULTS.startingChips)} chips each, blinds from {PRACTICE_DEFAULTS.startingSmallBlind}/
            {PRACTICE_DEFAULTS.startingSmallBlind * 2}, rising every {PRACTICE_DEFAULTS.levelMinutes} minutes
          </li>
          <li>Free rebuys if you run out</li>
          <li>
            You'll play{" "}
            {bots.map((b, i) => (
              <span key={b.name}>
                {i > 0 && (i === bots.length - 1 ? " and " : ", ")}
                <strong>{b.name}</strong> ({PERSONALITIES[b.profile].style})
              </span>
            ))}
          </li>
          <li>Runs on your device. Nothing is sent anywhere.</li>
        </ul>
        <label className="check-field">
          <input type="checkbox" checked={tips} onChange={(e) => setTips(e.target.checked)} />
          <span>Show tips as things happen</span>
          {tips && (
            <button
              type="button"
              className="link-button"
              disabled={tipsReset}
              onClick={() => {
                resetSeenTips();
                setTipsReset(true);
              }}
            >
              {tipsReset ? "Tips reset" : "Show all again"}
            </button>
          )}
        </label>
        <button className="btn btn-primary btn-big" autoFocus>
          <Play size={20} aria-hidden /> Deal me in
        </button>
      </form>
    </div>
  );
}

function PracticeGame({ config, onSetup }: { config: PracticeConfig; onSetup: () => void }) {
  const { conn, session, runner } = usePracticeTable(config);
  const [tips, setTips] = useState(() => getPref("tips", true));
  const [actions, setActions] = useState(0);
  const { error, clearError } = conn;

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 3500);
    return () => clearTimeout(t);
  }, [error, clearError]);

  // Count the player's moves so a tip gets out of the way once they act.
  const send = conn.send;
  const tracked = useMemo(
    () => ({
      ...conn,
      send: (msg: Parameters<typeof send>[0]) => {
        setActions((n) => n + 1);
        send(msg);
      },
    }),
    [conn, send],
  );

  const setTipsOn = useCallback((on: boolean) => {
    setPref("tips", on);
    setTips(on);
  }, []);
  const onHold = useCallback((on: boolean) => (on ? runner.hold("coach") : runner.release("coach")), [runner]);

  const v = conn.view!;
  const progress = `hand ${Math.min(v.handNumber, session.handLimit) || 1} of ${session.handLimit}`;

  return (
    <>
      <GameTable
        key={session.id}
        conn={tracked}
        practice={{
          progress,
          tips,
          onToggleTips: () => setTipsOn(!tips),
          onRestart: () => runner.restart(),
          onExit: onSetup,
        }}
        floating={
          tips && !session.ended ? (
            <Coach
              key={session.id}
              view={v}
              handLimit={session.handLimit}
              actions={actions}
              onHold={onHold}
              onDisable={() => setTipsOn(false)}
            />
          ) : null
        }
      />
      {session.ended && <Summary view={v} runner={runner} session={session} onSetup={onSetup} />}
      {error && (
        <div className="toast-error" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
    </>
  );
}

function Summary({ view: v, runner, session, onSetup }: { view: TableView; runner: PracticeRunner; session: SessionInfo; onSetup: () => void }) {
  const you = v.players.find((p) => p.isYou);
  const { stats } = session;
  const net = (you?.chips ?? 0) - session.startingChips * (1 + session.rebuys);
  const rank = [...v.players].sort((a, b) => b.chips - a.chips).findIndex((p) => p.isYou) + 1;
  const out = session.ended === "out";
  const title = out ? "Practice over" : session.ended === "finished" ? "Game over" : `${session.handLimit / v.players.length} orbits played`;
  const tried = POWER_TYPES.filter((t) => stats.powersPlayed[t]);
  const faced = POWER_TYPES.filter((t) => stats.powersFaced[t] && !stats.powersPlayed[t]);

  return (
    <div className="modal-backdrop">
      <div className="modal modal-win try-summary" role="dialog" aria-modal="true" aria-label="Practice summary">
        <h2>
          {rank === 1 && !out ? <Trophy size={22} aria-hidden /> : <Sparkles size={22} aria-hidden />} {title}
        </h2>
        <p className="try-headline">
          {out
            ? "Thanks for playing!"
            : `${net >= 0 ? "+" : "−"}${chips(Math.abs(net))} chips · ${ordinal(rank)} biggest stack of ${v.players.length}`}
        </p>
        <dl className="try-stats">
          <div>
            <dt>Hands won</dt>
            <dd>
              {stats.handsWon} of {stats.hands}
            </dd>
          </div>
          <div>
            <dt>Biggest pot</dt>
            <dd>{stats.biggestWin ? chips(stats.biggestWin) : "–"}</dd>
          </div>
          <div>
            <dt>Rebuys</dt>
            <dd>{session.rebuys}</dd>
          </div>
        </dl>
        <PowerList label="Powers you played" types={tried} counts={stats.powersPlayed} empty="None yet. Tap a power card on your turn." />
        {faced.length > 0 && <PowerList label="Powers used against you" types={faced} counts={stats.powersFaced} />}
        <p className="muted small">
          {tried.length + faced.length < POWER_TYPES.length
            ? `${POWER_TYPES.length - tried.length - faced.length} powers still to discover. `
            : ""}
          Ready for the real thing? Create a table and share the link with friends.
        </p>
        <div className="modal-actions try-actions">
          <button type="button" className="btn btn-primary" onClick={() => navigate("/")}>
            Play with friends <ArrowRight size={18} aria-hidden />
          </button>
          {session.ended === "orbits" && (
            <button type="button" className="btn btn-ghost" onClick={() => runner.extend()}>
              <Play size={18} aria-hidden /> Keep playing
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => runner.restart()}>
            <RotateCcw size={18} aria-hidden /> Play again
          </button>
          <button type="button" className="btn btn-ghost" onClick={onSetup}>
            <Settings2 size={18} aria-hidden /> Change setup
          </button>
          <a href="/rules" onClick={linkHandler("/rules")} className="btn btn-ghost">
            <BookOpen size={18} aria-hidden /> How to play
          </a>
        </div>
      </div>
    </div>
  );
}

function PowerList({
  label,
  types,
  counts,
  empty,
}: {
  label: string;
  types: PowerType[];
  counts: Partial<Record<PowerType, number>>;
  empty?: string;
}) {
  return (
    <div className="try-powers">
      <h3>{label}</h3>
      {types.length ? (
        <ul>
          {types.map((t) => (
            <li key={t} style={{ ["--power" as string]: POWERS[t].color }} title={POWERS[t].text}>
              <PowerIcon type={t} size={18} />
              {POWERS[t].name}
              {(counts[t] ?? 0) > 1 && <small>×{counts[t]}</small>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{empty}</p>
      )}
    </div>
  );
}
