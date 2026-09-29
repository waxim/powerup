import { cardText } from "../../shared/cards";
import { POWERS, type PowerType } from "../../shared/powers";
import type { TableView } from "../../shared/protocol";

export interface Tip {
  id: string;
  text: string;
}

export interface CoachContext {
  /** Hands in this practice session, for the "last orbit" tip. */
  handLimit: number;
}

type Rule = (v: TableView, prev: TableView | null, ctx: CoachContext) => Tip | null;

const tip = (id: string, text: string): Tip => ({ id, text });
const others = (v: TableView) => v.players.filter((p) => !p.isYou);

/** Power entries in the log that are new since the previous view. */
function newPowerPlays(v: TableView, prev: TableView | null): { name: string; type: PowerType }[] {
  const lastSeq = prev?.log.at(-1)?.seq ?? -1;
  return v.log
    .filter((l) => l.seq > lastSeq && l.kind === "power" && l.power && l.playerId && l.playerId !== v.youId && / plays /.test(l.text))
    .map((l) => ({ name: v.players.find((p) => p.id === l.playerId)?.name ?? "A bot", type: l.power! }));
}

const BOT_POWER_TEXT: Partial<Record<PowerType, (name: string) => string>> = {
  xray: (n) => `${n} played X-Ray: one card from everyone still in the hand is now face up, yours included.`,
  emp: (n) => `${n} played EMP: nobody else can use powers until the next card is dealt. You can still bet.`,
  engineer: (n) => `${n} played Engineer: they're choosing the next card from three, and everyone gets to see the options.`,
  deploy: (n) => `${n} played Deploy: an extra shared card. It counts for your hand too.`,
  disintegrate: (n) => `${n} played Disintegrate: a card dealt this street was destroyed and replaced.`,
  scanner: (n) => `${n} played Scanner: they peeked at the next two cards and may have thrown one away.`,
  clone: (n) => `${n} played Clone: they now hold a copy of the last power played.`,
};

/**
 * The tips, in priority order. Each reads only the player's own view, so a tip can never give away
 * anything hidden. Each is shown once.
 */
const RULES: Rule[] = [
  (v) =>
    tip(
      "welcome",
      `You vs ${others(v).length} bot${others(v).length > 1 ? "s" : ""}. It's Texas hold'em (best five cards wins) plus powers: the cards under your hand. The gold number is each one's energy cost.`,
    ),
  (v) =>
    v.mode === "double"
      ? tip("double", `${v.players.length} players means the Double game: ${v.rules.handSize} powers each and up to ${v.rules.maxEnergy} energy.`)
      : null,
  (v) => (v.me?.legal ? tip("first-turn", "Your move. Powers first (tap one, then Play), then Check, Call, Raise or Fold.") : null),
  (v, prev) => {
    for (const { name, type } of newPowerPlays(v, prev)) {
      const text = BOT_POWER_TEXT[type]?.(name) ?? `${name} played ${POWERS[type].name}: ${POWERS[type].text}`;
      return tip(`bot-${type}`, text);
    }
    return null;
  },
  (v) =>
    v.hand?.empBy && v.hand.empBy !== v.youId && v.me?.powers.some((p) => /EMP/.test(p.reason ?? ""))
      ? tip("emp-hit", "EMP! Your powers are offline until the next card is dealt.")
      : null,
  (v) =>
    v.me?.hole.some((c) => c.exposed)
      ? tip("exposed", "One of your cards is face up for everyone to see. Reload can swap it for a hidden one.")
      : null,
  (v) => (v.me?.intelTop ? tip("intel", `Intel: the next card off the deck is the ${cardText(v.me.intelTop)}. Only you can see it.`) : null),
  (v) => (v.hand?.board.some((b) => b.deployed) ? tip("deployed", "The +1 card was deployed: an extra shared card everyone can use.") : null),
  (v) => (v.hand?.board.some((b) => b.locked) ? tip("shield", "Red cards are shielded: someone's all-in, so powers can't touch them.") : null),
  (v) => {
    const clone = v.me?.powers.find((p) => p.type === "clone");
    const last = v.hand?.lastPower;
    return v.me?.legal && clone && last ? tip("clone", `Your Clone would copy ${POWERS[last].name} right now.`) : null;
  },
  (v) =>
    v.handNumber >= 2
      ? tip(
          "energy",
          `+${v.rules.energyPerHand} energy every hand, up to ${v.rules.maxEnergy}. Used powers are replaced next hand, so don't hoard them.`,
        )
      : null,
  (v) =>
    v.hand?.phase === "done" && v.players.some((p) => !p.isYou && p.bestCards)
      ? tip("showdown", "Showdown! The glowing cards make the winning hand.")
      : null,
  (v, prev) =>
    prev && v.level.index > prev.level.index ? tip("blinds", "Blinds are up. They rise every few minutes, so pots grow as the game goes on.") : null,
  (v, _prev, ctx) => {
    const left = ctx.handLimit - v.handNumber + 1;
    return v.hand && v.hand.phase !== "done" && left === v.players.length && ctx.handLimit > v.players.length
      ? tip("last-orbit", `Last orbit: ${left} hands to go.`)
      : null;
  },
];

/** The first tip that applies now and hasn't been seen, or null. */
export function nextTip(v: TableView, prev: TableView | null, seen: ReadonlySet<string>, ctx: CoachContext): Tip | null {
  // Choice and rebuy dialogs explain themselves; don't talk over them.
  if (v.paused || v.me?.scanner || v.me?.upgrade || v.me?.engineer || v.me?.rebuy) return null;
  for (const rule of RULES) {
    const t = rule(v, prev, ctx);
    if (t && !seen.has(t.id)) return t;
  }
  return null;
}
