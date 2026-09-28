import { MAX_DEPLOYS_PER_HAND, MODE_RULES, POWER_TYPES, powerCost, type PowerType } from "../shared/powers";
import type { HandView, MeView, PlayerView, TableView } from "../shared/protocol";
import { UNLIMITED_REBUYS, blindLevel } from "../shared/settings";
import { bestHand } from "./evaluator";
import type { Game } from "./game";

const LOG_ENTRIES_IN_VIEW = 60;

/**
 * Build the view of the table for one viewer (a seated player, or a spectator when viewerId is null).
 * This is the only way state leaves the server, so it decides what each person may see:
 * your own hole cards, exposed cards, showdown hands, and private power info (Intel, Scanner).
 */
export function buildView(game: Game, viewerId: string | null, now: number, connected: ReadonlySet<string>): TableView {
  const s = game.s;
  const mode = game.mode;
  const h = s.hand;
  const viewer = viewerId ? s.players.find((p) => p.id === viewerId) ?? null : null;
  const showHand = h && h.phase === "done";

  const players: PlayerView[] = [...s.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => {
      const hp = h?.players.find((x) => x.id === p.id) ?? null;
      const isYou = p.id === viewer?.id;
      const result = h?.result;
      let hole: PlayerView["hole"] = [];
      if (hp && (!hp.folded || isYou)) {
        hole = hp.hole.map((c) => ({
          card: isYou || c.exposed || (showHand && hp.showCards) ? c.card : null,
          exposed: c.exposed,
        }));
      }
      const shown = hp && showHand && hp.showCards && result?.hands[p.id];
      return {
        id: p.id,
        name: p.name,
        seat: p.seat,
        isHost: p.id === s.hostId,
        isYou,
        connected: connected.has(p.id),
        status: p.status,
        chips: p.chips,
        energy: p.energy,
        powerCount: p.powers.length,
        rebuysUsed: p.rebuysUsed,
        place: p.place,
        away: p.away,
        rebuyDeadline: p.status === "busted" && !p.rebuyDeclined ? p.rebuyDeadline : null,
        inHand: !!hp,
        folded: hp?.folded ?? false,
        allIn: hp?.allIn ?? false,
        streetBet: hp?.streetBet ?? 0,
        lastAction: hp?.lastAction ?? null,
        hole,
        isButton: !!h && h.buttonSeat === p.seat && s.status === "running",
        isSmallBlind: !!h && h.sbSeat === p.seat && h.street === "preflop" && s.status === "running",
        isBigBlind: !!h && h.bbSeat === p.seat && h.street === "preflop" && s.status === "running",
        isTurn: !!h && h.phase === "betting" && h.toAct === p.id,
        intel: hp?.intel ?? false,
        handLabel: shown ? shown.label : null,
        bestCards: shown ? shown.best : null,
        won: (showHand && result?.won[p.id]) || 0,
      };
    });

  let hand: HandView | null = null;
  if (h) {
    const pending = h.pending;
    hand = {
      number: h.number,
      street: h.street,
      phase: h.phase,
      board: h.board.map((b) => ({
        card: b.card,
        street: b.street,
        deployed: b.deployed,
        locked: b.locked,
        current: b.street === h.street && h.phase === "betting",
      })),
      pot: h.players.reduce((sum, p) => sum + p.totalBet, 0),
      pots: h.result ? h.result.pots.map((p) => ({ amount: p.amount, winners: p.winners.map((w) => w.id) })) : null,
      currentBet: h.currentBet,
      toAct: h.phase === "betting" ? h.toAct : null,
      turnDeadline: h.phase === "betting" && !s.paused ? h.turnDeadline : null,
      empBy: h.empStreet === h.street && h.phase === "betting" ? h.empBy : null,
      deploysLeft: MAX_DEPLOYS_PER_HAND - h.deploys,
      knownTop: h.knownTop && h.deck[0] === h.knownTop ? h.knownTop : null,
      engineer: pending?.kind === "engineer" ? { by: pending.playerId, cards: pending.cards } : null,
      pending: pending ? { by: pending.playerId, kind: pending.kind } : null,
      deckCount: h.deck.length,
      lastPower: game.lastClonable(),
    };
  }

  let me: MeView | null = null;
  if (viewer) {
    const hp = h?.players.find((x) => x.id === viewer.id) ?? null;
    const pending = h?.pending?.playerId === viewer.id ? h.pending : null;
    const legal = s.status === "running" ? game.legal(viewer.id) : null;
    const board = h ? h.board.map((b) => b.card) : [];
    const canRebuy = viewer.status === "busted" && !viewer.rebuyDeclined && viewer.rebuyDeadline !== null;
    me = {
      id: viewer.id,
      hole: hp ? hp.hole.map((c) => ({ card: c.card, exposed: c.exposed })) : [],
      powers: viewer.powers.map((c) => {
        const reason = s.status === "running" ? game.powerBlockReason(viewer.id, c.type) : "The game hasn't started";
        return { id: c.id, type: c.type, cost: powerCost(c.type, mode), playable: reason === null, reason };
      }),
      energy: viewer.energy,
      intelTop: hp?.intel && h && h.phase !== "done" ? h.deck[0] ?? null : null,
      scanner: pending?.kind === "scanner" ? pending.cards : null,
      upgrade: pending?.kind === "upgrade",
      engineer: pending?.kind === "engineer" ? pending.cards : null,
      legal: legal && hp ? { ...legal, pot: hand!.pot, streetBet: hp.streetBet } : null,
      handLabel: hp && !hp.folded && hp.hole.length ? bestHand([...hp.hole.map((c) => c.card), ...board]).label : null,
      rebuy: canRebuy
        ? {
            deadline: viewer.rebuyDeadline!,
            remaining: s.settings.rebuys === UNLIMITED_REBUYS ? -1 : s.settings.rebuys - viewer.rebuysUsed,
          }
        : null,
    };
  }

  const levelIndex = s.status === "lobby" ? 0 : s.level;
  const current = blindLevel(s.settings.startingSmallBlind, levelIndex);
  const clockNow = s.paused && s.pausedAt !== null ? s.pausedAt : now;
  const running = s.status === "running";

  const costs = Object.fromEntries(POWER_TYPES.map((t) => [t, powerCost(t, mode)])) as Record<PowerType, number>;

  return {
    id: s.id,
    settings: s.settings,
    status: s.status,
    paused: s.paused,
    autoPaused: s.autoPaused,
    mode,
    rules: MODE_RULES[mode],
    costs,
    hostId: s.hostId,
    youId: viewer?.id ?? null,
    serverNow: now,
    level: {
      index: levelIndex,
      sb: current.sb,
      bb: current.bb,
      endsAt: running && !s.paused ? s.levelEndsAt : null,
      remainingMs: running ? Math.max(0, s.levelEndsAt - clockNow) : s.settings.levelMinutes * 60_000,
      next: blindLevel(s.settings.startingSmallBlind, levelIndex + 1),
    },
    players,
    hand,
    me,
    log: s.log.slice(-LOG_ENTRIES_IN_VIEW),
    nextHandAt: running && !s.paused ? s.nextHandAt : null,
    handNumber: s.handNumber,
    winnerId: s.winnerId,
  };
}
