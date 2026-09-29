import { ArrowRight, BookOpen, Bot, ChevronLeft, ChevronRight, Lightbulb, Play, RotateCcw, Settings2, Sparkles, Trophy } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { MODE_RULES, POWERS, POWER_TYPES, modeForPlayers, type PowerType } from "../../shared/powers";
import type { TableView } from "../../shared/protocol";
import { PowerIcon } from "../components/PowerCard";
import { GameTable } from "../game/GameTable";
import { chips, ordinal } from "../lib/format";
import { linkHandler, navigate } from "../lib/router";
import { getJson, getPref, getSavedName, saveName, setJson, setPref } from "../lib/storage";
import { PERSONALITIES, pickOpponents } from "../practice/bot";
import { adviceText } from "../practice/advice";
import { CheatSheet } from "../practice/CheatSheet";
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
          <li>New powers are dealt to you first, so you meet them all (the cards are never rigged)</li>
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

const TRIED_KEY = "try:tried";

/** "A", "A and B", "A, B and C". */
const listOf = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : (items[0] ?? ""));

function loadTried(): Set<PowerType> {
  const saved = getJson<unknown>(TRIED_KEY, []);
  return new Set(Array.isArray(saved) ? POWER_TYPES.filter((t) => saved.includes(t)) : []);
}

function PracticeGame({ config, onSetup }: { config: PracticeConfig; onSetup: () => void }) {
  const { conn, session, runner } = usePracticeTable(config);
  const [tips, setTips] = useState(() => getPref("tips", true));
  const [actions, setActions] = useState(0);
  const [selected, setSelected] = useState<PowerType | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  // Powers tried in earlier sessions, so the summary can point out the new ones.
  const [triedBefore] = useState(loadTried);
  const { error, clearError } = conn;
  const v = conn.view!;
  const myTurn = !!v.me?.legal;

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(clearError, 3500);
    return () => clearTimeout(t);
  }, [error, clearError]);

  // Count the player's moves so tips and hints get out of the way once they act.
  const send = conn.send;
  const tracked = useMemo(
    () => ({
      ...conn,
      send: (msg: Parameters<typeof send>[0]) => {
        setActions((n) => n + 1);
        setHint(null);
        send(msg);
      },
    }),
    [conn, send],
  );

  // The game waits while the hint or the cheat sheet is open.
  useEffect(() => {
    if (!hint) return;
    runner.hold("hint");
    return () => runner.release("hint");
  }, [hint, runner]);
  useEffect(() => {
    if (!sheet) return;
    runner.hold("sheet");
    return () => runner.release("sheet");
  }, [sheet, runner]);
  useEffect(() => {
    if (!myTurn) setHint(null);
  }, [myTurn]);

  const tried = useMemo(() => new Set(POWER_TYPES.filter((t) => session.stats.powersPlayed[t])), [session.stats]);
  useEffect(() => {
    if (!tried.size) return;
    setJson(TRIED_KEY, POWER_TYPES.filter((t) => tried.has(t) || loadTried().has(t)));
  }, [tried]);

  const setTipsOn = useCallback((on: boolean) => {
    setPref("tips", on);
    setTips(on);
  }, []);
  const onHold = useCallback((on: boolean) => (on ? runner.hold("coach") : runner.release("coach")), [runner]);
  const showHint = () => {
    const thought = runner.advise();
    setHint(thought ? adviceText(thought, v) : "Nothing to decide right now.");
  };

  const progress = `hand ${Math.min(v.handNumber, session.handLimit) || 1} of ${session.handLimit}`;
  // Skipping the pause after a hand only once the newcomer has seen a few play out.
  const canSkip = !session.ended && v.handNumber >= 3 && runner.canSkipWait();

  return (
    <>
      <GameTable
        key={session.id}
        conn={tracked}
        practice={{
          progress,
          tips,
          onToggleTips: () => setTipsOn(!tips),
          onCheatSheet: () => setSheet(true),
          onPowerSelect: setSelected,
          onRestart: () => runner.restart(),
          onExit: () => runner.leave(),
        }}
        floating={
          session.ended ? null : (
            <div className="practice-float">
              <div className="practice-chips">
                {canSkip && (
                  <button type="button" className="chip-btn" onClick={() => runner.skipWait()}>
                    Next hand <ChevronRight size={16} aria-hidden />
                  </button>
                )}
                {myTurn && !hint && (
                  <button type="button" className="chip-btn chip-hint" onClick={showHint}>
                    <Lightbulb size={16} aria-hidden /> Hint
                  </button>
                )}
              </div>
              {hint && (
                <div className="coach coach-hint" role="status" aria-live="polite">
                  <Lightbulb size={18} className="coach-icon" aria-hidden />
                  <span className="coach-text">
                    <strong>Coach's view:</strong> {hint}
                  </span>
                  <button type="button" className="coach-next" onClick={() => setHint(null)}>
                    Got it
                  </button>
                </div>
              )}
              {tips && (
                <Coach
                  key={session.id}
                  view={v}
                  handLimit={session.handLimit}
                  actions={actions}
                  selected={selected}
                  tried={tried.size}
                  suppressed={!!hint || sheet}
                  onHold={onHold}
                  onDisable={() => setTipsOn(false)}
                />
              )}
            </div>
          )
        }
      />
      {sheet && <CheatSheet view={v} tried={tried} onClose={() => setSheet(false)} />}
      {session.ended && <Summary view={v} runner={runner} session={session} triedBefore={triedBefore} onSetup={onSetup} />}
      {error && (
        <div className="toast-error" role="alert" onClick={clearError}>
          {error}
        </div>
      )}
    </>
  );
}

function Summary({
  view: v,
  runner,
  session,
  triedBefore,
  onSetup,
}: {
  view: TableView;
  runner: PracticeRunner;
  session: SessionInfo;
  triedBefore: ReadonlySet<PowerType>;
  onSetup: () => void;
}) {
  const you = v.players.find((p) => p.isYou);
  const { stats } = session;
  const net = (you?.chips ?? 0) - session.startingChips * (1 + session.rebuys);
  const rank = [...v.players].sort((a, b) => b.chips - a.chips).findIndex((p) => p.isYou) + 1;
  const orbits = Math.round(session.handLimit / v.players.length);
  const title =
    session.ended === "out"
      ? "Thanks for playing!"
      : session.ended === "left"
        ? "Practice ended"
        : session.ended === "finished"
          ? "Game over"
          : `${orbits} orbit${orbits > 1 ? "s" : ""} played`;
  const played = POWER_TYPES.filter((t) => stats.powersPlayed[t]);
  const overall = new Set([...triedBefore, ...played]);
  const pot = stats.biggestPot;

  return (
    <div className="modal-backdrop">
      <div className="modal modal-win try-summary" role="dialog" aria-modal="true" aria-label="Practice summary">
        <h2>
          {rank === 1 && session.ended === "orbits" ? <Trophy size={22} aria-hidden /> : <Sparkles size={22} aria-hidden />} {title}
        </h2>
        <p className="try-headline">
          {net >= 0 ? "+" : "−"}
          {chips(Math.abs(net))} chips · {ordinal(rank)} of {v.players.length}
        </p>
        <dl className="try-stats">
          <div>
            <dt>Hands won</dt>
            <dd>
              {stats.handsWon} of {stats.hands}
            </dd>
          </div>
          <div>
            <dt>Best hand</dt>
            <dd className="try-stat-text">{stats.bestHand?.label ?? "–"}</dd>
          </div>
          <div>
            <dt>Rebuys</dt>
            <dd>{session.rebuys}</dd>
          </div>
        </dl>
        {pot && (
          <p className="try-pot">
            Biggest pot: <strong>{chips(pot.amount)}</strong>
            {pot.label ? ` with ${/^[AEIOU]/.test(pot.label) ? "an" : "a"} ${pot.label}` : ""}
            {pot.powers.length ? `, after ${listOf([...new Set(pot.powers)].map((t) => POWERS[t].name))}` : ""}
          </p>
        )}
        <div className="try-powers">
          <h3>Powers</h3>
          <ul>
            {POWER_TYPES.map((t) => {
              const count = stats.powersPlayed[t] ?? 0;
              const state = count ? "is-played" : stats.powersFaced[t] ? "is-faced" : "is-unseen";
              return (
                <li key={t} className={state} style={{ ["--power" as string]: POWERS[t].color }} title={`${POWERS[t].name}: ${POWERS[t].text}`}>
                  <PowerIcon type={t} size={18} />
                  {POWERS[t].name}
                  {count > 1 && <small>×{count}</small>}
                  {count > 0 && !triedBefore.has(t) && <b className="try-new">New</b>}
                </li>
              );
            })}
          </ul>
          <p className="muted small">
            Tried {played.length} of 10 this session{overall.size > played.length ? ` · ${overall.size} of 10 overall` : ""}. Solid:
            played by you; outlined: played against you.
          </p>
        </div>
        <p className="muted small">Ready for the real thing? Create a table and share the link with friends.</p>
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
