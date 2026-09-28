import { POWER_TYPES, isPowerType, type PowerType } from "./powers";

export interface TableSettings {
  /** Display name of the table. */
  name: string;
  /** Maximum players (2-6). The table can start with fewer. */
  maxSeats: number;
  startingChips: number;
  /** Small blind of level 1; the big blind is always double. */
  startingSmallBlind: number;
  /** Minutes per blind level. */
  levelMinutes: number;
  /** Rebuys each player may take after busting; -1 means unlimited. */
  rebuys: number;
  /** Seconds a player has to act. */
  turnSeconds: number;
  /** Powers that can be dealt at this table. */
  powers: PowerType[];
}

export const MIN_SEATS = 2;
export const MAX_SEATS = 6;
export const UNLIMITED_REBUYS = -1;

export const SMALL_BLIND_OPTIONS = [1, 5, 10, 25, 50, 100, 250, 500];
export const CHIP_OPTIONS = [500, 1000, 1500, 2000, 3000, 5000, 10000, 20000];
export const LEVEL_MINUTE_OPTIONS = [2, 3, 5, 8, 10, 15, 20, 30];
export const REBUY_OPTIONS = [0, 1, 2, 3, 5, 10, UNLIMITED_REBUYS];
export const TURN_SECOND_OPTIONS = [15, 20, 30, 45, 60, 90];

export const DEFAULT_SETTINGS: TableSettings = {
  name: "",
  maxSeats: 6,
  startingChips: 1500,
  startingSmallBlind: 10,
  levelMinutes: 5,
  rebuys: 1,
  turnSeconds: 30,
  powers: [...POWER_TYPES],
};

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export function cleanName(value: unknown, maxLength = 20): string {
  if (typeof value !== "string") return "";
  // Collapse whitespace and strip control characters.
  return value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/** Coerce untrusted input into valid settings. */
export function sanitizeSettings(input: Partial<Record<keyof TableSettings, unknown>> | null | undefined): TableSettings {
  const raw = input ?? {};
  // Capped so that 10 big blinds (20 small blinds) always fit under the 10M chip cap.
  const startingSmallBlind = clampInt(raw.startingSmallBlind, 1, 500_000, DEFAULT_SETTINGS.startingSmallBlind);
  // At least 10 big blinds to start with.
  const minChips = startingSmallBlind * 2 * 10;
  const startingChips = clampInt(raw.startingChips, Math.max(20, minChips), 10_000_000, Math.max(minChips, DEFAULT_SETTINGS.startingChips));
  const rebuysRaw = clampInt(raw.rebuys, -1, 99, DEFAULT_SETTINGS.rebuys);
  let powers = Array.isArray(raw.powers) ? [...new Set(raw.powers.filter(isPowerType))] : [...POWER_TYPES];
  if (powers.length === 0) powers = [...POWER_TYPES];
  return {
    name: cleanName(raw.name, 32),
    maxSeats: clampInt(raw.maxSeats, MIN_SEATS, MAX_SEATS, DEFAULT_SETTINGS.maxSeats),
    startingChips,
    startingSmallBlind,
    levelMinutes: clampInt(raw.levelMinutes, 1, 120, DEFAULT_SETTINGS.levelMinutes),
    rebuys: rebuysRaw < 0 ? UNLIMITED_REBUYS : rebuysRaw,
    turnSeconds: clampInt(raw.turnSeconds, 10, 180, DEFAULT_SETTINGS.turnSeconds),
    powers: POWER_TYPES.filter((p) => powers.includes(p)),
  };
}

/* ------------------------------------------------------------------ */
/* Blind structure                                                     */
/* ------------------------------------------------------------------ */

/** "Nice" chip amounts used for blinds: 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100, ... */
function niceAmounts(): number[] {
  const out = new Set<number>();
  for (let exp = 0; exp <= 8; exp++) {
    const base = 10 ** exp;
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8]) {
      const v = m * base;
      if (Number.isInteger(v)) out.add(v);
    }
  }
  return [...out].sort((a, b) => a - b);
}
const NICE = niceAmounts();

export interface BlindLevel {
  sb: number;
  bb: number;
}

/** Blind levels grow by roughly 40-60% per level, rounded to nice numbers. */
export function blindLevel(startingSmallBlind: number, level: number): BlindLevel {
  let sb = startingSmallBlind;
  for (let i = 0; i < level; i++) {
    const target = sb * 1.4;
    sb = NICE.find((v) => v >= target && v > sb) ?? Math.ceil(target);
  }
  return { sb, bb: sb * 2 };
}

export function blindSchedule(startingSmallBlind: number, levels: number): BlindLevel[] {
  return Array.from({ length: levels }, (_, i) => blindLevel(startingSmallBlind, i));
}

export function rebuysLabel(rebuys: number): string {
  if (rebuys === UNLIMITED_REBUYS) return "Unlimited";
  if (rebuys === 0) return "None";
  return String(rebuys);
}
