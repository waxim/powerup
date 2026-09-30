import type { GameHooks } from "../../engine/game";
import type { Player } from "../../engine/state";
import type { GameMode, PowerType } from "../../shared/powers";

/** The first powers a newcomer holds: easy to understand, easy to see, and exactly 10 energy together. */
const STARTERS: PowerType[] = ["xray", "reload", "deploy"];
/** Double games deal one more. */
const DOUBLE_STARTER: PowerType = "intel";
/** Then each power they use is replaced by one they haven't met yet, in this order. */
const ORDER: PowerType[] = ["upgrade", "scanner", "disintegrate", "intel", "engineer", "emp", "clone"];

/**
 * Chooses which power types the player is dealt in practice, so they meet every power in a sensible order.
 * Only the types are chosen; the cards themselves are never rigged, and the bots are dealt normally.
 */
export class Curriculum implements GameHooks {
  humanId = "";
  private readonly given = new Set<PowerType>();

  constructor(private readonly mode: GameMode) {}

  pickPower(player: Readonly<Player>, candidates: readonly PowerType[], handNumber: number): PowerType | undefined {
    if (player.id !== this.humanId) return undefined;
    const held = new Set<PowerType>([...player.powers.map((c) => c.type), ...this.given]);
    const wanted = handNumber === 0 ? [...STARTERS, ...(this.mode === "double" ? [DOUBLE_STARTER] : []), ...ORDER] : ORDER;
    const pick = wanted.find((t) => candidates.includes(t) && !held.has(t));
    if (pick) this.given.add(pick);
    return pick;
  }
}
