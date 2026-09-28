import { Game, TIMING } from "../src/engine/game";
import { seededRng, type Rng } from "../src/engine/rng";
import { fullDeck, type Card } from "../src/shared/cards";
import type { PowerType } from "../src/shared/powers";
import type { TableSettings } from "../src/shared/settings";

export const T0 = 1_700_000_000_000;

export interface Ctx {
  game: Game;
  ids: string[];
  clock: { now: number };
  rng: Rng;
}

export function makeGame(n: number, settings: Partial<TableSettings> = {}, seed = 1): Ctx {
  const rng = seededRng(seed);
  const clock = { now: T0 };
  const { game, host } = Game.create({
    id: "test",
    settings: { startingChips: 1000, startingSmallBlind: 10, levelMinutes: 10, turnSeconds: 30, rebuys: 0, ...settings },
    hostName: "P0",
    now: clock.now,
    rng,
  });
  const ids = [host.id];
  for (let i = 1; i < n; i++) ids.push(game.join(`P${i}`, clock.now).id);
  return { game, ids, clock, rng };
}

/**
 * Start a game and deal the first hand. `beforeDeal` can adjust stacks/button first.
 * Players are re-seated randomly at start; use `seats()` to address them by seat.
 */
export function startGame(
  n: number,
  settings: Partial<TableSettings> = {},
  seed = 1,
  beforeDeal?: (game: Game) => void,
): Ctx {
  const ctx = makeGame(n, settings, seed);
  ctx.game.start(ctx.ids[0], ctx.clock.now);
  beforeDeal?.(ctx.game);
  ctx.clock.now += TIMING.firstHandDelay;
  ctx.game.tick(ctx.clock.now);
  return ctx;
}

/** Player ids ordered by seat. */
export function seats(game: Game): string[] {
  return [...game.s.players].sort((a, b) => a.seat - b.seat).map((p) => p.id);
}

export function toAct(game: Game): string {
  const id = game.s.hand?.toAct;
  if (!id) throw new Error("nobody to act");
  return id;
}

/** Give a player specific hole cards and put `top` on top of the deck (rest of the deck follows). */
export function rig(game: Game, hole: Record<string, Card[]>, top: Card[] = []): void {
  const h = game.s.hand!;
  for (const hp of h.players) {
    if (hole[hp.id]) hp.hole = hole[hp.id].map((card) => ({ card, exposed: false }));
  }
  const inPlay = new Set<Card>([...h.players.flatMap((p) => p.hole.map((c) => c.card)), ...h.board.map((b) => b.card)]);
  const rest = fullDeck().filter((c) => !inPlay.has(c) && !top.includes(c));
  h.deck = [...top, ...rest];
  h.muck = [];
}

export function givePowers(game: Game, playerId: string, types: PowerType[], energy = 15): string[] {
  const p = game.player(playerId);
  p.powers = types.map((type, i) => ({ id: `${type}-${i}`, type }));
  p.energy = energy;
  return p.powers.map((c) => c.id);
}

export function powerId(game: Game, playerId: string, type: PowerType): string {
  const card = game.player(playerId).powers.find((c) => c.type === type);
  if (!card) throw new Error(`${playerId} has no ${type}`);
  return card.id;
}

/** Everyone checks or calls until the hand reaches `street` (or ends). */
export function checkDownTo(ctx: Ctx, street: "flop" | "turn" | "river"): void {
  const { game, clock } = ctx;
  for (let guard = 0; guard < 50; guard++) {
    const h = game.s.hand!;
    if (h.phase !== "betting" || h.street === street) return;
    const id = toAct(game);
    const legal = game.legal(id)!;
    game.act(id, legal.canCheck ? "check" : "call", undefined, clock.now);
  }
}

/** Advance the clock through all timers until the hand is done (runouts etc.). */
export function runTimers(ctx: Ctx, maxMs = 60_000): void {
  const { game, clock } = ctx;
  const end = clock.now + maxMs;
  while (clock.now < end) {
    const next = game.nextWakeAt();
    if (next === null || next > end) break;
    clock.now = Math.max(clock.now, next);
    game.tick(clock.now);
    if (game.s.hand?.phase === "done") break;
  }
}

/** Move on to the next hand (after the showdown pause). */
export function nextHand(ctx: Ctx): void {
  const { game, clock } = ctx;
  if (game.s.nextHandAt !== null) clock.now = Math.max(clock.now, game.s.nextHandAt);
  game.tick(clock.now);
}

export function totalChips(game: Game): number {
  const h = game.s.hand;
  const inPot = h && h.phase !== "done" ? h.players.reduce((sum, p) => sum + p.totalBet, 0) : 0;
  return game.s.players.reduce((sum, p) => sum + p.chips, 0) + inPot;
}

export function uniqueCards(game: Game): boolean {
  const all = game.allCards();
  return all.length === 52 && new Set(all).size === 52;
}
