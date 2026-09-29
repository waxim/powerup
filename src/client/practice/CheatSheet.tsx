import { Check, X } from "lucide-react";
import { useState } from "react";
import { POWERS, POWER_TYPES, type PowerType } from "../../shared/powers";
import type { TableView } from "../../shared/protocol";
import { HandRankings } from "../components/HandRankings";
import { PowerIcon } from "../components/PowerCard";
import { GOOD_WHEN } from "./tips";

interface Props {
  view: TableView;
  /** Power types the player has played this session. */
  tried: ReadonlySet<PowerType>;
  onClose(): void;
}

/** A quick reference over the table: poker hands and the powers, with this table's costs. */
export function CheatSheet({ view, tried, onClose }: Props) {
  const [tab, setTab] = useState<"powers" | "hands">("powers");
  const held = new Set(view.me?.powers.map((p) => p.type));
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Cheat sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <div className="segmented" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "powers"} className={tab === "powers" ? "is-active" : ""} onClick={() => setTab("powers")}>
              Powers
            </button>
            <button type="button" role="tab" aria-selected={tab === "hands"} className={tab === "hands" ? "is-active" : ""} onClick={() => setTab("hands")}>
              Hands
            </button>
          </div>
          <button type="button" className="btn btn-ghost icon-only" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <div className="sheet-body">
          {tab === "hands" ? (
            <>
              <p className="muted small">Best to worst. You make the best five-card hand from your two cards and the board.</p>
              <HandRankings />
            </>
          ) : (
            <ul className="sheet-powers">
              {POWER_TYPES.map((t) => (
                <li key={t} className={held.has(t) ? "is-held" : ""} style={{ ["--power" as string]: POWERS[t].color }}>
                  <span className="sheet-power-icon">
                    <PowerIcon type={t} size={20} />
                  </span>
                  <div>
                    <strong>
                      {POWERS[t].name} <span className="sheet-cost">{view.costs[t]}⚡</span>
                      {held.has(t) && <em>in your hand</em>}
                      {tried.has(t) && <Check size={14} className="sheet-tried" aria-label="tried" />}
                    </strong>
                    <p>{POWERS[t].rules}</p>
                    <p className="muted small">Good when {GOOD_WHEN[t]}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
