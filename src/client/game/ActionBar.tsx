import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { ClientMessage, TableView } from "../../shared/protocol";
import { chips, ordinal } from "../lib/format";

interface Props {
  view: TableView;
  send: (msg: ClientMessage) => void;
  timeLeft: number | null;
}

export function ActionBar({ view, send, timeLeft }: Props) {
  const legal = view.me?.legal ?? null;
  const h = view.hand;
  const [raising, setRaising] = useState(false);
  const [amount, setAmount] = useState(0);

  // Reset the raise panel whenever a new decision comes up.
  const decisionKey = `${h?.number}-${h?.street}-${h?.currentBet}-${legal ? 1 : 0}`;
  useEffect(() => {
    setRaising(false);
    if (legal) setAmount(legal.minRaiseTo);
  }, [decisionKey]);

  if (!legal || !h) {
    return <div className="actionbar actionbar-idle">{idleText(view)}</div>;
  }

  const bb = h ? Math.max(1, view.level.bb) : 1;
  const clamp = (x: number) => Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, Math.round(x)));
  // Pot-sized raise: call, then raise by the size of the pot after the call.
  const afterCall = legal.pot + legal.callAmount;
  const raiseTo = (fraction: number) => clamp(legal.streetBet + legal.callAmount + afterCall * fraction);
  const presets: [string, number][] = [
    ["Min", legal.minRaiseTo],
    ["½ pot", raiseTo(0.5)],
    ["¾ pot", raiseTo(0.75)],
    ["Pot", raiseTo(1)],
    ["All-in", legal.maxRaiseTo],
  ];
  const allIn = amount >= legal.maxRaiseTo;
  const verb = legal.isBet ? "Bet" : "Raise to";

  return (
    <div className="actionbar">
      {timeLeft !== null && (
        <div className="turn-clock" aria-hidden>
          <div className={timeLeft < 0.25 ? "turn-clock-fill is-urgent" : "turn-clock-fill"} style={{ width: `${timeLeft * 100}%` }} />
        </div>
      )}
      {raising ? (
        <div className="raise-panel">
          <div className="presets">
            {presets.map(([label, value]) => (
              <button type="button" key={label} className={value === amount ? "is-active" : ""} onClick={() => setAmount(value)}>
                {label}
              </button>
            ))}
          </div>
          <div className="raise-row">
            <button type="button" className="btn btn-ghost icon-only" onClick={() => setAmount((a) => clamp(a - bb))} aria-label="Less">
              <Minus size={18} />
            </button>
            <input
              type="range"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={1}
              value={amount}
              onChange={(e) => setAmount(clamp(Number(e.target.value)))}
              aria-label="Raise amount"
            />
            <button type="button" className="btn btn-ghost icon-only" onClick={() => setAmount((a) => clamp(a + bb))} aria-label="More">
              <Plus size={18} />
            </button>
          </div>
          <div className="buttons">
            <button type="button" className="btn act act-back" onClick={() => setRaising(false)}>
              Back
            </button>
            <button type="button" className="btn act act-raise" onClick={() => send({ t: "act", action: "raise", amount })}>
              {allIn ? `All-in ${chips(amount)}` : `${verb} ${chips(amount)}`}
            </button>
          </div>
        </div>
      ) : (
        <div className="buttons">
          {legal.canFold && (
            <button type="button" className="btn act act-fold" onClick={() => send({ t: "act", action: "fold" })}>
              Fold
            </button>
          )}
          {legal.canCheck ? (
            <button type="button" className="btn act act-call" onClick={() => send({ t: "act", action: "check" })}>
              Check
            </button>
          ) : (
            <button type="button" className="btn act act-call" onClick={() => send({ t: "act", action: "call" })}>
              {legal.callAmount >= (view.players.find((p) => p.isYou)?.chips ?? Infinity) ? "Call all-in" : "Call"} {chips(legal.callAmount)}
            </button>
          )}
          {legal.canRaise &&
            (legal.minRaiseTo >= legal.maxRaiseTo ? (
              <button type="button" className="btn act act-raise" onClick={() => send({ t: "act", action: "raise", amount: legal.maxRaiseTo })}>
                All-in {chips(legal.maxRaiseTo)}
              </button>
            ) : (
              <button type="button" className="btn act act-raise" onClick={() => setRaising(true)}>
                {legal.isBet ? "Bet" : "Raise"}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

function idleText(view: TableView): string {
  const h = view.hand;
  const you = view.players.find((p) => p.isYou);
  if (view.status === "finished") return "Game over";
  if (view.paused) return "Game paused";
  if (!you) return "You're watching this table";
  if (you.status === "out") return you.place ? `You finished ${ordinal(you.place)}` : "You're out";
  if (you.status === "busted") return "Out of chips";
  if (!h) return "Next hand starting…";
  if (h.phase === "done") return "Next hand starting…";
  if (h.phase === "runout") return "All in! Running it out…";
  const hp = view.players.find((p) => p.isYou);
  if (hp?.folded) return "You folded this hand";
  if (hp?.allIn) return "You're all in";
  if (h.pending && h.pending.by === you.id) return "Make your choice";
  const actor = view.players.find((p) => p.id === h.toAct);
  return actor ? `Waiting for ${actor.name}…` : "";
}
