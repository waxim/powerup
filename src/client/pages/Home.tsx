import { ArrowRight, BookOpen, Zap } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { MODE_RULES, POWERS, POWER_TYPES, type PowerType } from "../../shared/powers";
import {
  CHIP_OPTIONS,
  DEFAULT_SETTINGS,
  LEVEL_MINUTE_OPTIONS,
  MAX_SEATS,
  MIN_SEATS,
  REBUY_OPTIONS,
  SMALL_BLIND_OPTIONS,
  TURN_SECOND_OPTIONS,
  blindSchedule,
  rebuysLabel,
  type TableSettings,
} from "../../shared/settings";
import { PowerCard } from "../components/PowerCard";
import { chips } from "../lib/format";
import { linkHandler, navigate } from "../lib/router";
import { getSavedName, saveName, setSeatToken } from "../lib/storage";

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? "logo logo-small" : "logo"} aria-label="PowerUp">
      <span className="logo-power">POWER</span>
      <Zap className="logo-bolt" aria-hidden />
      <span className="logo-up">UP</span>
    </span>
  );
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  render = (o) => String(o),
}: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
  label: string;
  render?: (o: T) => string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          type="button"
          key={String(o)}
          role="radio"
          aria-checked={o === value}
          className={o === value ? "is-active" : ""}
          onClick={() => onChange(o)}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

export function Home() {
  const [name, setName] = useState(getSavedName);
  const [settings, setSettings] = useState<TableSettings>({ ...DEFAULT_SETTINGS });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPowers, setShowPowers] = useState(false);

  const set = <K extends keyof TableSettings>(key: K, value: TableSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const bb = settings.startingSmallBlind * 2;
  const bigBlinds = Math.floor(settings.startingChips / bb);
  const tooShort = bigBlinds < 10;
  const schedule = useMemo(() => blindSchedule(settings.startingSmallBlind, 8), [settings.startingSmallBlind]);
  const doubleGame = settings.maxSeats >= 4;

  const togglePower = (type: PowerType) =>
    setSettings((s) => {
      const has = s.powers.includes(type);
      if (has && s.powers.length === 1) return s;
      return { ...s, powers: has ? s.powers.filter((p) => p !== type) : POWER_TYPES.filter((p) => p === type || s.powers.includes(p)) };
    });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter your name so your friends know who's hosting");
      return;
    }
    if (tooShort) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tables", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, settings }),
      });
      const data = (await res.json()) as { id?: string; token?: string; error?: string };
      if (!res.ok || !data.id || !data.token) throw new Error(data.error ?? "Could not create the table");
      saveName(trimmed);
      setSeatToken(data.id, data.token);
      navigate(`/t/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the table");
      setBusy(false);
    }
  }

  return (
    <div className="page home">
      <header className="hero">
        <Logo />
        <p className="hero-tag">Texas hold'em with game-changing powers.</p>
        <p className="hero-sub">Create a table, share the link, and your friends join with just a name. No accounts, no downloads.</p>
      </header>

      <form className="panel-card create" onSubmit={submit}>
        <h2>Create a table</h2>
        <label className="field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder="e.g. Alex" autoComplete="nickname" />
        </label>
        <label className="field">
          <span>
            Table name <em>optional</em>
          </span>
          <input
            value={settings.name}
            onChange={(e) => set("name", e.target.value)}
            maxLength={32}
            placeholder="Friday night PowerUp"
          />
        </label>

        <div className="field">
          <span>Seats</span>
          <Segmented
            label="Seats"
            value={settings.maxSeats}
            options={Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => i + MIN_SEATS)}
            onChange={(v) => set("maxSeats", v)}
          />
          <small className={doubleGame ? "hint hint-double" : "hint"}>
            {doubleGame
              ? `If 4 or more join, it's a Double game: ${MODE_RULES.double.handSize} powers each, up to ${MODE_RULES.double.maxEnergy} energy, and rebalanced costs.`
              : `Classic Power Up: ${MODE_RULES.classic.handSize} powers each, up to ${MODE_RULES.classic.maxEnergy} energy.`}
          </small>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Starting chips</span>
            <select value={settings.startingChips} onChange={(e) => set("startingChips", Number(e.target.value))}>
              {CHIP_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {chips(c)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Starting blinds</span>
            <select value={settings.startingSmallBlind} onChange={(e) => set("startingSmallBlind", Number(e.target.value))}>
              {SMALL_BLIND_OPTIONS.map((sb) => (
                <option key={sb} value={sb}>
                  {chips(sb)}/{chips(sb * 2)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <small className={tooShort ? "hint hint-error" : "hint"}>
          {tooShort ? `That's only ${bigBlinds} big blinds. Pick more chips or smaller blinds (at least 10).` : `${bigBlinds} big blinds each.`}
        </small>

        <div className="field-row">
          <label className="field">
            <span>Blinds go up every</span>
            <select value={settings.levelMinutes} onChange={(e) => set("levelMinutes", Number(e.target.value))}>
              {LEVEL_MINUTE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Time to act</span>
            <select value={settings.turnSeconds} onChange={(e) => set("turnSeconds", Number(e.target.value))}>
              {TURN_SECOND_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t} seconds
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="schedule" aria-label="Blind schedule">
          {schedule.map((l, i) => (
            <span key={i}>
              {chips(l.sb)}/{chips(l.bb)}
            </span>
          ))}
          <span>…</span>
        </div>

        <div className="field">
          <span>Rebuys per player</span>
          <Segmented label="Rebuys" value={settings.rebuys} options={REBUY_OPTIONS} onChange={(v) => set("rebuys", v)} render={(o) => (o === -1 ? "∞" : rebuysLabel(o))} />
          <small className="hint">A busted player can buy back in for the starting stack.</small>
        </div>

        <div className="field">
          <button type="button" className="link-button" onClick={() => setShowPowers((s) => !s)} aria-expanded={showPowers}>
            Powers in play: {settings.powers.length === POWER_TYPES.length ? "all 10" : `${settings.powers.length} of 10`} {showPowers ? "▴" : "▾"}
          </button>
          {showPowers && (
            <div className="power-toggles">
              {POWER_TYPES.map((t) => (
                <button
                  type="button"
                  key={t}
                  className={settings.powers.includes(t) ? "chip-toggle is-on" : "chip-toggle"}
                  style={{ ["--power" as string]: POWERS[t].color }}
                  onClick={() => togglePower(t)}
                  aria-pressed={settings.powers.includes(t)}
                >
                  {POWERS[t].name}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="form-error">{error}</p>}
        <button className="btn btn-primary btn-big" disabled={busy || tooShort}>
          {busy ? "Creating…" : "Create table"} <ArrowRight size={20} aria-hidden />
        </button>
      </form>

      <section className="showcase">
        <div className="showcase-head">
          <h2>The powers</h2>
          <a href="/rules" onClick={linkHandler("/rules")} className="btn btn-ghost">
            <BookOpen size={18} aria-hidden /> How to play
          </a>
        </div>
        <div className="power-grid">
          {POWER_TYPES.map((t) => (
            <PowerCard key={t} type={t} cost={POWERS[t].cost.classic} affordable />
          ))}
        </div>
      </section>

      <footer className="foot">
        A fan-made recreation of PokerStars' Power Up. Play money only.
      </footer>
    </div>
  );
}
