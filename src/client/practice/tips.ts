import { cardText, type Card } from "../../shared/cards";
import { POWERS, type PowerType } from "../../shared/powers";
import type { LogEntry, TableView } from "../../shared/protocol";

/** Where a tip points: matches a `data-coach` attribute in the table UI. */
export type TipTarget = "powers" | "energy" | "actions" | "board" | "hand-label" | "blinds";

/**
 * How much a tip stops the game: `turn` holds the clock until the player acts or dismisses it,
 * `brief` holds it for a few seconds, `none` never does.
 */
export type TipHold = "turn" | "brief" | "none";

export interface Tip {
  id: string;
  text: string;
  hold: TipHold;
  target?: TipTarget;
  /** The tip stops making sense once this is true (for example, the player has acted). */
  until?: (v: TableView) => boolean;
}

export interface TipContext {
  /** Hands in this practice session. */
  handLimit: number;
  /** A power the player just selected for the first time, if any. */
  selected: PowerType | null;
  /** Power types the player has played so far (for "tried k/10"). */
  tried: number;
}

/** When each power is at its best, in a few words. */
export const GOOD_WHEN: Record<PowerType, string> = {
  xray: "you face a bet and aren't sure you're ahead.",
  upgrade: "one of your cards is weak or face up.",
  scanner: "you're drawing and want to bin a card that helps them.",
  reload: "your cards are weak, or one is face up.",
  intel: "it's early in the hand; it makes Deploy and Disintegrate predictable.",
  engineer: "you need one particular card, like a fourth heart.",
  emp: "you're ahead and opponents still have energy.",
  disintegrate: "a card just dealt helps an opponent more than you.",
  clone: "someone just played a strong power.",
  deploy: "you need one more card, like a fourth heart for a flush.",
};

type Rule = (v: TableView, prev: TableView | null, ctx: TipContext) => Tip | null;

const nameOf = (v: TableView, id: string | undefined) => v.players.find((p) => p.id === id)?.name ?? "Someone";
const bots = (v: TableView) => v.players.filter((p) => !p.isYou).length;
const myTurn = (v: TableView) => !!v.me?.legal;
/** Cards named in a log line, in order. */
const cardsIn = (text: string) => text.match(/(10|[2-9JQKA])[♠♥♦♣]/g) ?? [];

/** Log entries that are new since the previous view. */
function fresh(v: TableView, prev: TableView | null): LogEntry[] {
  const last = prev?.log.at(-1)?.seq ?? -1;
  return v.log.filter((l) => l.seq > last);
}

function botPowerTip(v: TableView, l: LogEntry): Tip | null {
  const type = l.power!;
  const name = nameOf(v, l.playerId);
  const c = cardsIn(l.text);
  const text: Record<PowerType, string> = {
    xray: `${name} played X-Ray: everyone still in the hand, you included, now shows one card.`,
    upgrade: `${name} played Upgrade: a third hole card, then one thrown away. Nobody sees which.`,
    scanner: `${name} peeked at the next two cards with Scanner, and may throw one away.`,
    reload: `${name} swapped ${/ both /.test(l.text) ? "both" : "one"} of their cards with Reload.`,
    intel: `${name} played Intel: they can see the next card off the deck for the rest of the hand.`,
    engineer: `${name} is choosing the next card from these three with Engineer. You see them too.`,
    emp: `EMP! ${name} switched off everyone else's powers until the next card. You can still bet.`,
    disintegrate:
      c.length >= 2
        ? `${name} destroyed the ${c[0]}, and the ${c[1]} replaced it. Only cards dealt this street can be hit.`
        : `${name} destroyed a board card with Disintegrate.`,
    clone: `${name} cloned the last power played. They still pay its energy to use it.`,
    deploy: c.length ? `${name} deployed the ${c[0]}: an extra shared card that counts for you too.` : `${name} deployed an extra shared card.`,
  };
  const target: TipTarget | undefined = type === "engineer" || type === "disintegrate" || type === "deploy" ? "board" : undefined;
  return { id: `bot-${type}`, text: text[type], hold: "brief", target };
}

/** The tips, in priority order. Each reads only the player's own view, so none can give away anything hidden. */
const RULES: Rule[] = [
  (v) => ({
    id: "welcome",
    text: `You vs ${bots(v)} bot${bots(v) > 1 ? "s" : ""}. It's Texas hold'em: best five-card hand wins, or make everyone fold. Your powers are the cards under your hand; the gold number is each one's energy cost.`,
    hold: "turn",
    target: "powers",
  }),
  (v) =>
    v.mode === "double"
      ? {
          id: "double",
          text: `${v.players.length} players means the Double game: ${v.rules.handSize} powers each, up to ${v.rules.maxEnergy}⚡, and X-Ray, EMP and Deploy cost differently.`,
          hold: "none",
        }
      : null,
  (_v, _p, ctx) => {
    const t = ctx.selected;
    if (!t) return null;
    const def = POWERS[t];
    return { id: `select-${t}`, text: `${def.name}: ${def.rules} Good when ${GOOD_WHEN[t]}`, hold: "turn", until: (v) => !myTurn(v) };
  },
  (v) =>
    myTurn(v)
      ? {
          id: "first-turn",
          text: "Your move. Play powers first (tap one, then Play), then Check, Call, Raise or Fold. The clock stops while you read this.",
          hold: "turn",
          target: "actions",
          until: (x) => !myTurn(x),
        }
      : null,
  (v) => {
    const l = v.me?.legal;
    if (!l || l.callAmount === 0) return null;
    const bettor = v.players.filter((p) => !p.isYou && p.streetBet > 0).sort((a, b) => b.streetBet - a.streetBet)[0];
    return {
      id: "facing-bet",
      text: `${bettor?.name ?? "Someone"} bet. Call matches it (${l.callAmount}), Raise bets more, Fold gives up the hand. You can only Check when nobody has bet.`,
      hold: "turn",
      target: "actions",
      until: (x) => !myTurn(x),
    };
  },
  (v, prev) => {
    for (const l of fresh(v, prev)) {
      if (l.kind === "power" && l.power && l.playerId && l.playerId !== v.youId && / plays /.test(l.text)) return botPowerTip(v, l);
    }
    return null;
  },
  (v) =>
    v.me?.hole.some((c) => c.exposed)
      ? { id: "exposed", text: "One of your cards is face up for everyone (marked 'shown'). Reload or Upgrade can get rid of it.", hold: "brief" }
      : null,
  (v) =>
    v.me?.intelTop
      ? { id: "intel-mine", text: `Intel: the ${cardText(v.me.intelTop)} is the next card off the deck. Only you can see it.`, hold: "none" }
      : null,
  (v) => {
    const you = v.players.find((p) => p.isYou);
    return v.hand?.street === "flop" && you?.inHand && !you.folded && v.me?.handLabel
      ? {
          id: "flop",
          text: `The flop: three shared cards. Your best hand shows under your cards: ${v.me.handLabel}.`,
          hold: "none",
          target: "hand-label",
        }
      : null;
  },
  (v) =>
    v.handNumber >= 2 && v.hand?.phase === "betting"
      ? {
          id: "energy",
          text: `+${v.rules.energyPerHand}⚡ every hand, up to ${v.rules.maxEnergy}. Used powers are replaced next hand, so don't hoard them.`,
          hold: "none",
          target: "energy",
        }
      : null,
  (v, prev, ctx) => {
    if (!prev?.me || !v.me || v.handNumber === prev.handNumber) return null;
    const had = new Set(prev.me.powers.map((p) => p.type));
    const added = v.me.powers.filter((p) => !had.has(p.type)).map((p) => POWERS[p.type].name);
    return added.length && v.handNumber > 1
      ? { id: `new-powers-${v.handNumber}`, text: `New power${added.length > 1 ? "s" : ""}: ${added.join(", ")}. Tried ${ctx.tried} of 10 so far.`, hold: "none", target: "powers" }
      : null;
  },
  (v) =>
    myTurn(v) && v.me!.energy >= v.rules.maxEnergy - 1 && v.me!.powers.some((p) => p.playable)
      ? {
          id: "energy-full",
          text: `Your energy is nearly full. Next hand's +${v.rules.energyPerHand} would be wasted, so use a power.`,
          hold: "turn",
          target: "energy",
          until: (x) => !myTurn(x),
        }
      : null,
  (v) =>
    v.hand?.board.some((b) => b.locked)
      ? { id: "shield", text: "Red cards are shielded: someone is all-in, so powers can't touch them.", hold: "none", target: "board" }
      : null,
  (v) => {
    const last = v.hand?.lastPower;
    return myTurn(v) && last && v.me!.powers.some((p) => p.type === "clone")
      ? { id: "clone-ready", text: `Your Clone would copy ${POWERS[last].name} right now.`, hold: "none", target: "powers" }
      : null;
  },
  (v) =>
    v.hand?.phase === "done" && v.players.some((p) => !p.isYou && p.bestCards)
      ? { id: "showdown", text: "Showdown! Players still in show their cards. The glowing cards make the winning hand.", hold: "brief" }
      : null,
  (v) => {
    if (v.hand?.phase !== "done" || v.players.some((p) => p.bestCards)) return null;
    const winner = v.players.find((p) => p.won > 0);
    return winner ? { id: "fold-win", text: `Everyone else folded, so ${winner.isYou ? "you win" : `${winner.name} wins`} without showing.`, hold: "none" } : null;
  },
  (v) => {
    if (v.hand?.phase !== "done") return null;
    const deployed = new Set<Card>(v.hand.board.filter((b) => b.deployed).map((b) => b.card));
    const winner = v.players.find((p) => p.won > 0 && p.bestCards?.some((c) => deployed.has(c)));
    if (!winner) return null;
    const card = winner.bestCards!.find((c) => deployed.has(c))!;
    return {
      id: "deploy-won",
      text: `${winner.isYou ? "Your" : `${winner.name}'s`} hand used the deployed ${cardText(card)}. Deploy helps whoever it fits.`,
      hold: "none",
      target: "board",
    };
  },
  (v, prev) =>
    prev && v.level.index > prev.level.index
      ? {
          id: "blinds",
          text: `Blinds are now ${v.level.sb}/${v.level.bb}. They rise every ${v.settings.levelMinutes} minutes so pots keep growing.`,
          hold: "none",
          target: "blinds",
        }
      : null,
  (v, _prev, ctx) => {
    const left = ctx.handLimit - v.handNumber + 1;
    return v.hand && v.hand.phase !== "done" && left === v.players.length && ctx.handLimit > v.players.length
      ? { id: "last-orbit", text: `Last orbit: ${left} hands to go.`, hold: "none" }
      : null;
  },
];

/** Tips whose ids start with these are about a power the player is meeting for the first time. */
const POWER_TIP = /^(select|bot)-/;
/** After this many hands, only first-time power tips stop the game. */
const HOLDING_HANDS = 3;

/** The first tip that applies now and hasn't been seen, or null. */
export function nextTip(v: TableView, prev: TableView | null, seen: ReadonlySet<string>, ctx: TipContext): Tip | null {
  // Choice and rebuy dialogs explain themselves; don't talk over them.
  if (v.paused || v.me?.scanner || v.me?.upgrade || v.me?.engineer || v.me?.rebuy) return null;
  for (const rule of RULES) {
    const t = rule(v, prev, ctx);
    if (!t || seen.has(t.id) || t.until?.(v)) continue;
    if (v.handNumber > HOLDING_HANDS && !POWER_TIP.test(t.id)) return { ...t, hold: "none" };
    return t;
  }
  return null;
}
