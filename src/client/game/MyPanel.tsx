import { Zap } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import type { Card } from "../../shared/cards";
import { POWERS } from "../../shared/powers";
import type { ClientMessage, MyPowerView, TableView } from "../../shared/protocol";
import { PlayingCard } from "../components/PlayingCard";
import { PowerCard } from "../components/PowerCard";
import { ordinal } from "../lib/format";
import { ActionBar } from "./ActionBar";

export interface PowerSelection {
  selected: MyPowerView | null;
  select(id: string | null): void;
  reloadPick: number[];
  toggleReload(index: number): void;
}

interface Props {
  view: TableView;
  send: (msg: ClientMessage) => void;
  power: PowerSelection;
  timeLeft: number | null;
  winningCards: Card[] | null;
}

function EnergyMeter({ energy, max }: { energy: number; max: number }) {
  return (
    <div className="energy" title={`${energy} of ${max} energy`}>
      <Zap size={16} aria-hidden className="energy-bolt" />
      <span className="energy-num">{energy}</span>
      <span className="energy-bar" aria-hidden>
        {Array.from({ length: max }, (_, i) => (
          <i key={i} className={i < energy ? "on" : ""} />
        ))}
      </span>
    </div>
  );
}

export function MyPanel({ view, send, power, timeLeft, winningCards }: Props) {
  const me = view.me!;
  const you = view.players.find((p) => p.isYou)!;
  const h = view.hand;
  const [hint, setHint] = useState<string | null>(null);
  const selected = power.selected;
  const reloading = selected?.type === "reload";

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 2200);
    return () => clearTimeout(t);
  }, [hint]);

  const onPowerClick = (p: MyPowerView) => {
    if (!p.playable) {
      setHint(p.reason);
      power.select(null);
      return;
    }
    power.select(selected?.id === p.id ? null : p.id);
  };

  const play = (extra: Partial<Extract<ClientMessage, { t: "power" }>> = {}) => {
    if (!selected) return;
    send({ t: "power", powerId: selected.id, ...extra });
    power.select(null);
  };

  let prompt: ReactNode = null;
  if (selected) {
    const def = POWERS[selected.type];
    if (selected.type === "disintegrate") {
      prompt = <span>Tap a glowing board card to destroy it.</span>;
    } else if (selected.type === "reload") {
      const n = power.reloadPick.length;
      prompt = (
        <>
          <span>Tap one or both of your cards to swap.</span>
          <button type="button" className="btn btn-power" disabled={n === 0} onClick={() => play({ indices: power.reloadPick })}>
            Reload {n === 2 ? "both" : n === 1 ? "1 card" : ""}
          </button>
        </>
      );
    } else {
      prompt = (
        <>
          <span>{def.text}</span>
          <button type="button" className="btn btn-power" onClick={() => play()}>
            Play {def.name} ({selected.cost}⚡)
          </button>
        </>
      );
    }
  }

  const inHand = you.inHand && !you.folded && me.hole.length > 0;

  return (
    <div className="mypanel">
      <div className="mypanel-top">
        <div className="my-cards">
          {me.hole.length > 0 ? (
            me.hole.map((c, i) => (
              <PlayingCard
                key={`${i}-${c.card}`}
                card={c.card}
                size="lg"
                exposed={c.exposed}
                label={c.exposed ? "shown" : undefined}
                dim={you.folded}
                highlight={!!winningCards?.includes(c.card)}
                selectable={reloading}
                selected={reloading && power.reloadPick.includes(i)}
                onClick={reloading ? () => power.toggleReload(i) : undefined}
              />
            ))
          ) : (
            <div className="my-cards-empty">
              {you.status === "out" ? (you.place ? `Finished ${ordinal(you.place)}` : "Out") : h ? "Sitting this one out" : "Waiting for cards"}
            </div>
          )}
        </div>
        <div className="my-stats">
          <div className="my-hand">{inHand && me.handLabel ? me.handLabel : you.folded ? "Folded" : "\u00a0"}</div>
          <EnergyMeter energy={me.energy} max={view.rules.maxEnergy} />
        </div>
      </div>

      <div className="my-powers" role="group" aria-label="Your powers">
        {me.powers.map((p) => (
          <PowerCard
            key={p.id}
            type={p.type}
            cost={p.cost}
            playable={p.playable}
            affordable={p.cost <= me.energy}
            selected={selected?.id === p.id}
            reason={p.reason}
            compact
            onClick={() => onPowerClick(p)}
          />
        ))}
        {me.powers.length === 0 && <div className="my-powers-empty">New powers arrive at the next hand</div>}
      </div>

      <div className={prompt || hint ? "power-prompt is-open" : "power-prompt"} aria-live="polite">
        {prompt ? (
          <>
            {prompt}
            <button type="button" className="btn btn-ghost" onClick={() => power.select(null)}>
              Cancel
            </button>
          </>
        ) : (
          hint && <span className="power-hint">{hint}</span>
        )}
      </div>

      <ActionBar view={view} send={send} timeLeft={timeLeft} />
    </div>
  );
}
