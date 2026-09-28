import {
  ChevronsUp,
  Copy,
  Eye,
  Flame,
  Radar,
  RefreshCw,
  ScanEye,
  SquarePlus,
  Wrench,
  ZapOff,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { POWERS, type PowerType } from "../../shared/powers";

export const POWER_ICONS: Record<PowerType, LucideIcon> = {
  xray: ScanEye,
  upgrade: ChevronsUp,
  scanner: Radar,
  reload: RefreshCw,
  intel: Eye,
  engineer: Wrench,
  emp: ZapOff,
  disintegrate: Flame,
  clone: Copy,
  deploy: SquarePlus,
};

export function PowerIcon({ type, size = 20 }: { type: PowerType; size?: number }) {
  const Icon = POWER_ICONS[type];
  return <Icon size={size} strokeWidth={2.2} aria-hidden />;
}

interface Props {
  type: PowerType;
  cost: number;
  playable?: boolean;
  affordable?: boolean;
  selected?: boolean;
  reason?: string | null;
  compact?: boolean;
  onClick?: () => void;
}

export function PowerCard({ type, cost, playable = false, affordable = true, selected, reason, compact, onClick }: Props) {
  const def = POWERS[type];
  const style = { "--power": def.color } as CSSProperties;
  const classes = [
    "power",
    compact && "power-compact",
    playable && "is-playable",
    !affordable && "is-unaffordable",
    selected && "is-selected",
  ]
    .filter(Boolean)
    .join(" ");
  const body = (
    <>
      <span className="power-cost" aria-label={`${cost} energy`}>
        {cost}
      </span>
      <span className="power-icon">
        <PowerIcon type={type} size={compact ? 22 : 28} />
      </span>
      <span className={def.name.length > 9 ? "power-name is-long" : "power-name"}>{def.name}</span>
      {!compact && <span className="power-text">{def.text}</span>}
    </>
  );
  if (!onClick) {
    return (
      <div className={classes} style={style}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" className={classes} style={style} onClick={onClick} title={reason ?? def.text} aria-pressed={selected}>
      {body}
    </button>
  );
}
