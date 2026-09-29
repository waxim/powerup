import { cardText, fullDeck, type Card } from "../shared/cards";
import {
  MAX_DEPLOYS_PER_HAND,
  MODE_RULES,
  POWERS,
  modeForPlayers,
  powerCost,
  type GameMode,
  type PowerType,
} from "../shared/powers";
import type { ActionType, LogEntry, Street } from "../shared/protocol";
import {
  UNLIMITED_REBUYS,
  blindLevel,
  cleanName,
  sanitizeSettings,
  type TableSettings,
} from "../shared/settings";
import { bestHand, type HandValue } from "./evaluator";
import { randomId, shuffle, type Rng } from "./rng";
import type { BoardCard, Hand, HandPlayer, Player, PotResult, PowerCard, TableState } from "./state";

/** A rule violation caused by the player's request (shown to that player, never a crash). */
export class GameError extends Error {}

export const TIMING = {
  firstHandDelay: 2500,
  /** Pause between streets when everyone is all-in. */
  runoutStep: 1500,
  showdownPause: 6000,
  foldWinPause: 2500,
  rebuyWindow: 30_000,
  /** Players marked away act automatically after this delay. */
  awayActDelay: 1200,
  /** Minimum time left on the clock after starting a power that needs a choice. */
  minChoiceTime: 12_000,
  /** Minimum time left to act after a power resolves. */
  minAfterPower: 6000,
};

const MAX_LOG = 80;
const STREET_ORDER: Street[] = ["preflop", "flop", "turn", "river"];
/** Standard board cards still to come, per street. */
const BOARD_STILL_NEEDED: Record<Street, number> = { preflop: 5, flop: 2, turn: 1, river: 0 };

export interface PowerParams {
  /** Board index for Disintegrate. */
  target?: number;
  /** Hole card indices for Reload. */
  indices?: number[];
}

export interface Legal {
  canFold: boolean;
  canCheck: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
  isBet: boolean;
}

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Optional behaviour for practice tables. Real tables never pass any, so they play exactly as before. */
export interface GameHooks {
  /** Choose the type of a power card being dealt. Ignored unless it is one of `candidates`. */
  pickPower?(player: Readonly<Player>, candidates: readonly PowerType[], handNumber: number): PowerType | undefined;
}

export class Game {
  constructor(
    public s: TableState,
    private rng: Rng,
    private hooks: GameHooks = {},
  ) {}

  /* ---------------------------------------------------------------- */
  /* Creation & lobby                                                  */
  /* ---------------------------------------------------------------- */

  static create(opts: {
    id: string;
    settings: Partial<Record<keyof TableSettings, unknown>>;
    hostName: string;
    now: number;
    rng: Rng;
    hooks?: GameHooks;
  }): { game: Game; host: Player } {
    const settings = sanitizeSettings(opts.settings);
    const state: TableState = {
      v: 1,
      id: opts.id,
      createdAt: opts.now,
      lastActivityAt: opts.now,
      settings,
      status: "lobby",
      paused: false,
      pausedAt: null,
      autoPaused: false,
      emptySince: null,
      hostId: "",
      mode: null,
      players: [],
      handNumber: 0,
      buttonSeat: 0,
      level: 0,
      levelEndsAt: 0,
      hand: null,
      nextHandAt: null,
      winnerId: null,
      log: [],
      logSeq: 0,
    };
    const game = new Game(state, opts.rng, opts.hooks);
    const host = game.join(opts.hostName, opts.now);
    state.hostId = host.id;
    return { game, host };
  }

  get mode(): GameMode {
    return this.s.mode ?? modeForPlayers(this.s.players.length);
  }

  player(id: string): Player {
    const p = this.s.players.find((x) => x.id === id);
    if (!p) throw new GameError("You're not seated at this table");
    return p;
  }

  playerByToken(token: string): Player | undefined {
    return token ? this.s.players.find((p) => p.token === token) : undefined;
  }

  join(rawName: string, now: number): Player {
    const s = this.s;
    if (s.status !== "lobby") throw new GameError("This game has already started. You can watch.");
    if (s.players.length >= s.settings.maxSeats) throw new GameError("The table is full");
    const name = cleanName(rawName);
    if (!name) throw new GameError("Please enter a name");
    if (s.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      throw new GameError("That name is already taken at this table");
    }
    const taken = new Set(s.players.map((p) => p.seat));
    let seat = 0;
    while (taken.has(seat)) seat++;
    const player: Player = {
      id: randomId(this.rng, 10),
      token: randomId(this.rng, 26),
      name,
      seat,
      status: "waiting",
      chips: 0,
      energy: 0,
      powers: [],
      rebuysUsed: 0,
      place: null,
      away: false,
      rebuyDeadline: null,
      rebuyDeclined: false,
      handStartChips: 0,
      joinedAt: now,
    };
    s.players.push(player);
    this.log(now, "system", `${name} joined the table`, { playerId: player.id });
    this.touch(now);
    return player;
  }

  leave(playerId: string, now: number): void {
    const s = this.s;
    if (s.status !== "lobby") throw new GameError("You can only leave before the game starts");
    if (playerId === s.hostId) throw new GameError("The host can't leave the table");
    const p = this.player(playerId);
    s.players = s.players.filter((x) => x.id !== playerId);
    this.log(now, "system", `${p.name} left the table`);
    this.touch(now);
  }

  kick(byId: string, targetId: string, now: number): void {
    this.requireHost(byId);
    if (this.s.status !== "lobby") throw new GameError("Players can only be removed before the game starts");
    if (targetId === this.s.hostId) throw new GameError("You can't remove yourself");
    const p = this.player(targetId);
    this.s.players = this.s.players.filter((x) => x.id !== targetId);
    this.log(now, "system", `${p.name} was removed by the host`);
    this.touch(now);
  }

  start(byId: string, now: number): void {
    const s = this.s;
    this.requireHost(byId);
    if (s.status !== "lobby") throw new GameError("The game has already started");
    if (s.players.length < 2) throw new GameError("You need at least two players to start");
    const mode = modeForPlayers(s.players.length);
    const rules = MODE_RULES[mode];
    s.mode = mode;
    // Random seating.
    const order = shuffle(s.players, this.rng);
    order.forEach((p, i) => {
      p.seat = i;
      p.status = "playing";
      p.chips = s.settings.startingChips;
      p.energy = rules.startEnergy;
      p.powers = [];
      p.rebuysUsed = 0;
      p.place = null;
      p.away = false;
      p.rebuyDeadline = null;
      p.rebuyDeclined = false;
      p.handStartChips = p.chips;
      this.refillPowers(p);
    });
    s.players = order;
    s.buttonSeat = this.rng.int(order.length);
    s.handNumber = 0;
    s.level = 0;
    s.levelEndsAt = now + this.levelMs;
    s.status = "running";
    s.paused = false;
    s.pausedAt = null;
    s.autoPaused = false;
    s.winnerId = null;
    s.hand = null;
    s.nextHandAt = now + TIMING.firstHandDelay;
    const rulesText =
      mode === "double"
        ? `double game rules (${rules.handSize} powers, max ${rules.maxEnergy} energy)`
        : `classic rules (${rules.handSize} powers, max ${rules.maxEnergy} energy)`;
    this.log(now, "system", `Shuffle up and deal! ${order.length} players, ${rulesText}.`);
    this.touch(now);
  }

  rematch(byId: string, now: number): void {
    const s = this.s;
    this.requireHost(byId);
    if (s.status !== "finished") throw new GameError("The game isn't over yet");
    s.status = "lobby";
    s.mode = null;
    s.hand = null;
    s.handNumber = 0;
    s.nextHandAt = null;
    s.winnerId = null;
    s.paused = false;
    s.pausedAt = null;
    s.autoPaused = false;
    for (const p of s.players) {
      Object.assign(p, {
        status: "waiting",
        chips: 0,
        energy: 0,
        powers: [],
        rebuysUsed: 0,
        place: null,
        away: false,
        rebuyDeadline: null,
        rebuyDeclined: false,
      });
    }
    this.log(now, "system", "Rematch! Waiting for the host to start.");
    this.touch(now);
  }

  pause(byId: string, now: number): void {
    this.requireHost(byId);
    const s = this.s;
    if (s.status !== "running") throw new GameError("The game isn't running");
    if (s.paused) {
      s.autoPaused = false;
      return;
    }
    s.paused = true;
    s.pausedAt = now;
    s.autoPaused = false;
    this.log(now, "system", "The host paused the game");
    this.touch(now);
  }

  /** Pause because nobody is connected, so an abandoned table doesn't play itself out. */
  autoPause(now: number): void {
    const s = this.s;
    if (s.status !== "running" || s.paused) return;
    s.paused = true;
    s.pausedAt = now;
    s.autoPaused = true;
    this.log(now, "system", "Everyone left, so the game is paused. Any player can resume it.");
  }

  /** The host lifts their own pause; anyone seated can resume an auto-pause, or a pause whose host has gone. */
  resume(byId: string, now: number, opts: { hostAbsent?: boolean } = {}): void {
    const s = this.s;
    if (s.autoPaused || opts.hostAbsent) this.player(byId);
    else this.requireHost(byId);
    if (!s.paused || s.pausedAt === null) return;
    const delta = now - s.pausedAt;
    s.levelEndsAt += delta;
    if (s.nextHandAt !== null) s.nextHandAt += delta;
    if (s.hand) {
      if (s.hand.turnDeadline !== null) s.hand.turnDeadline += delta;
      if (s.hand.nextStepAt !== null) s.hand.nextStepAt += delta;
    }
    for (const p of s.players) if (p.rebuyDeadline !== null) p.rebuyDeadline += delta;
    s.paused = false;
    s.pausedAt = null;
    s.autoPaused = false;
    this.log(now, "system", "The game is back on");
    this.touch(now);
  }

  setBack(playerId: string, now: number): void {
    const p = this.player(playerId);
    if (!p.away) return;
    p.away = false;
    const h = this.s.hand;
    if (h && h.toAct === playerId && h.turnDeadline !== null && !this.s.paused) {
      h.turnDeadline = Math.max(h.turnDeadline, now + this.s.settings.turnSeconds * 1000);
    }
    this.log(now, "system", `${p.name} is back`);
    this.touch(now);
  }

  /* ---------------------------------------------------------------- */
  /* Timers                                                            */
  /* ---------------------------------------------------------------- */

  /** Run everything that is due. Returns true if the state changed. */
  tick(now: number): boolean {
    let changed = false;
    for (let guard = 0; guard < 100; guard++) {
      if (!this.stepDue(now)) break;
      changed = true;
    }
    return changed;
  }

  /** When `tick` next needs to run, or null if nothing is scheduled. */
  nextWakeAt(): number | null {
    const s = this.s;
    if (s.status !== "running" || s.paused) return null;
    const times: number[] = [];
    let pendingRebuy = false;
    for (const p of s.players) {
      if (p.status === "busted" && !p.rebuyDeclined && p.rebuyDeadline !== null) {
        times.push(p.rebuyDeadline);
        pendingRebuy = true;
      }
    }
    const h = s.hand;
    if (h && h.phase === "betting" && h.toAct && h.turnDeadline !== null) times.push(h.turnDeadline);
    if (h && h.phase === "runout" && h.nextStepAt !== null) times.push(h.nextStepAt);
    if ((!h || h.phase === "done") && s.nextHandAt !== null && !pendingRebuy) times.push(s.nextHandAt);
    return times.length ? Math.min(...times) : null;
  }

  private stepDue(now: number): boolean {
    const s = this.s;
    if (s.status !== "running" || s.paused) return false;
    for (const p of s.players) {
      if (p.status === "busted" && !p.rebuyDeclined && p.rebuyDeadline !== null && p.rebuyDeadline <= now) {
        p.rebuyDeclined = true;
        p.rebuyDeadline = null;
        this.log(now, "system", `${p.name} didn't rebuy`);
        this.resolveBusts(now);
        return true;
      }
    }
    if (s.status !== "running") return false;
    const h = s.hand;
    if (h && h.phase === "betting" && h.toAct && h.turnDeadline !== null && h.turnDeadline <= now) {
      this.timeout(now);
      return true;
    }
    if (h && h.phase === "runout" && h.nextStepAt !== null && h.nextStepAt <= now) {
      this.runoutStep(now);
      return true;
    }
    if (
      (!h || h.phase === "done") &&
      s.nextHandAt !== null &&
      s.nextHandAt <= now &&
      !s.players.some((p) => p.status === "busted")
    ) {
      s.nextHandAt = null;
      this.startHand(now);
      return true;
    }
    return false;
  }

  private timeout(now: number): void {
    const h = this.s.hand!;
    const hp = this.handPlayer(h.toAct!);
    const p = this.player(hp.id);
    if (h.pending && h.pending.playerId === hp.id) this.resolvePendingDefault(now);
    if (!p.away) {
      p.away = true;
      this.log(now, "system", `${p.name} ran out of time and is marked away`, { playerId: p.id });
    }
    this.perform(hp, hp.streetBet >= h.currentBet ? "check" : "fold", 0, now);
  }

  /* ---------------------------------------------------------------- */
  /* Hands                                                             */
  /* ---------------------------------------------------------------- */

  private get levelMs(): number {
    return this.s.settings.levelMinutes * 60_000;
  }

  private startHand(now: number): void {
    const s = this.s;
    const active = s.players.filter((p) => p.status === "playing").sort((a, b) => a.seat - b.seat);
    if (active.length < 2) {
      this.checkWinner(now);
      return;
    }
    // Blind levels advance on the clock; a new level applies from the next hand.
    let leveled = false;
    while (now >= s.levelEndsAt) {
      s.level++;
      s.levelEndsAt += this.levelMs;
      leveled = true;
    }
    const { sb, bb } = blindLevel(s.settings.startingSmallBlind, s.level);
    if (leveled) this.log(now, "level", `Blinds are now ${sb}/${bb}`);

    s.handNumber++;
    if (s.handNumber > 1 || !active.some((p) => p.seat === s.buttonSeat)) {
      s.buttonSeat = this.nextSeat(active.map((p) => p.seat), s.buttonSeat);
    }

    const rules = MODE_RULES[this.mode];
    for (const p of active) {
      if (s.handNumber > 1) p.energy = Math.min(rules.maxEnergy, p.energy + rules.energyPerHand);
      this.refillPowers(p);
      p.handStartChips = p.chips;
    }

    const n = active.length;
    const btnIdx = active.findIndex((p) => p.seat === s.buttonSeat);
    const sbPlayer = n === 2 ? active[btnIdx] : active[(btnIdx + 1) % n];
    const bbPlayer = n === 2 ? active[(btnIdx + 1) % n] : active[(btnIdx + 2) % n];

    const hand: Hand = {
      number: s.handNumber,
      deck: shuffle(fullDeck(), this.rng),
      muck: [],
      board: [],
      street: "preflop",
      phase: "betting",
      players: active.map((p) => ({
        id: p.id,
        seat: p.seat,
        hole: [],
        folded: false,
        allIn: false,
        streetBet: 0,
        totalBet: 0,
        acted: false,
        actedAt: 0,
        lastAction: null,
        intel: false,
        showCards: false,
      })),
      buttonSeat: s.buttonSeat,
      sbSeat: sbPlayer.seat,
      bbSeat: bbPlayer.seat,
      sb,
      bb,
      currentBet: bb,
      minRaise: bb,
      toAct: null,
      turnDeadline: null,
      empStreet: null,
      empBy: null,
      deploys: 0,
      powerHistory: [],
      knownTop: null,
      pending: null,
      nextStepAt: null,
      result: null,
    };
    s.hand = hand;

    const sbHp = this.handPlayer(sbPlayer.id);
    const bbHp = this.handPlayer(bbPlayer.id);
    this.commit(sbHp, Math.min(sb, sbPlayer.chips));
    sbHp.lastAction = sbHp.allIn ? "All-in" : null;
    this.commit(bbHp, Math.min(bb, bbPlayer.chips));
    bbHp.lastAction = bbHp.allIn ? "All-in" : null;

    for (let round = 0; round < 2; round++) {
      for (const hp of hand.players) hp.hole.push({ card: this.drawCard(), exposed: false });
    }

    this.log(now, "deal", `Hand #${hand.number}: blinds ${sb}/${bb}`);
    this.touch(now);
    this.advance(now, hand.bbSeat);
  }

  /** Move the game forward after something changed, until someone must act or a timer is needed. */
  private advance(now: number, fromSeat: number): void {
    const h = this.s.hand!;
    for (;;) {
      if (h.pending) return;
      const live = h.players.filter((p) => !p.folded);
      if (live.length === 1) {
        this.winUncontested(now, live[0]);
        return;
      }
      const next = this.nextToAct(fromSeat);
      if (next) {
        this.setTurn(next, now);
        return;
      }
      // The betting round is complete.
      h.toAct = null;
      h.turnDeadline = null;
      this.returnUncalled(now);
      if (h.street === "river") {
        this.showdown(now);
        return;
      }
      if (live.filter((p) => !p.allIn).length <= 1) {
        // Nobody left to bet against: run the board out, a street at a time.
        h.phase = "runout";
        h.nextStepAt = now + TIMING.runoutStep;
        return;
      }
      this.dealNextStreet(now);
      fromSeat = h.buttonSeat;
    }
  }

  private othersCanBet(p: HandPlayer): boolean {
    return this.s.hand!.players.some((o) => o !== p && !o.folded && !o.allIn);
  }

  /** The street bet `p` has to match. If every opponent is all-in, only what they actually put in. */
  private amountToMatch(p: HandPlayer): number {
    const h = this.s.hand!;
    if (this.othersCanBet(p)) return h.currentBet;
    const maxOther = Math.max(0, ...h.players.filter((o) => o !== p && !o.folded).map((o) => o.streetBet));
    return Math.min(h.currentBet, maxOther);
  }

  private needsAction(p: HandPlayer): boolean {
    if (p.folded || p.allIn) return false;
    if (p.streetBet < this.amountToMatch(p)) return true;
    if (p.acted) return false;
    // Hasn't acted this street: only needed if someone else can still bet.
    return this.othersCanBet(p);
  }

  private nextToAct(fromSeat: number): HandPlayer | null {
    const h = this.s.hand!;
    const ordered = this.seatOrderAfter(h.players, fromSeat);
    return ordered.find((p) => this.needsAction(p)) ?? null;
  }

  /** Players ordered clockwise starting after `seat`. */
  private seatOrderAfter<T extends { seat: number }>(items: T[], seat: number): T[] {
    const sorted = [...items].sort((a, b) => a.seat - b.seat);
    const after = sorted.filter((p) => p.seat > seat);
    const before = sorted.filter((p) => p.seat <= seat);
    return [...after, ...before];
  }

  private nextSeat(seats: number[], from: number): number {
    const sorted = [...seats].sort((a, b) => a - b);
    return sorted.find((x) => x > from) ?? sorted[0];
  }

  private setTurn(hp: HandPlayer, now: number): void {
    const h = this.s.hand!;
    const p = this.player(hp.id);
    h.toAct = hp.id;
    h.turnDeadline = now + (p.away ? TIMING.awayActDelay : this.s.settings.turnSeconds * 1000);
  }

  private commit(hp: HandPlayer, amount: number): void {
    const p = this.player(hp.id);
    const amt = Math.max(0, Math.min(amount, p.chips));
    p.chips -= amt;
    hp.streetBet += amt;
    hp.totalBet += amt;
    if (p.chips === 0) hp.allIn = true;
  }

  handPlayer(id: string): HandPlayer {
    const hp = this.s.hand?.players.find((p) => p.id === id);
    if (!hp) throw new GameError("You're not in this hand");
    return hp;
  }

  legal(playerId: string): Legal | null {
    const h = this.s.hand;
    if (!h || h.phase !== "betting" || h.toAct !== playerId || h.pending || this.s.paused) return null;
    const hp = this.handPlayer(playerId);
    const p = this.player(playerId);
    const toCall = Math.max(0, this.amountToMatch(hp) - hp.streetBet);
    const maxRaiseTo = hp.streetBet + p.chips;
    const reopened = !hp.acted || h.currentBet - hp.actedAt >= h.minRaise;
    const canRaise = reopened && this.othersCanBet(hp) && p.chips > toCall;
    return {
      canFold: toCall > 0,
      canCheck: toCall === 0,
      callAmount: Math.min(toCall, p.chips),
      canRaise,
      minRaiseTo: Math.min(maxRaiseTo, h.currentBet + h.minRaise),
      maxRaiseTo,
      isBet: h.currentBet === 0,
    };
  }

  act(playerId: string, action: ActionType, amount: number | undefined, now: number): void {
    this.requirePlaying();
    const h = this.s.hand;
    if (!h || h.phase !== "betting") throw new GameError("There's nothing to act on right now");
    if (h.toAct !== playerId) throw new GameError("It's not your turn");
    if (h.pending) throw new GameError("Finish your power first");
    const p = this.player(playerId);
    if (p.away) {
      p.away = false;
      this.log(now, "system", `${p.name} is back`);
    }
    this.perform(this.handPlayer(playerId), action, amount ?? 0, now);
  }

  private perform(hp: HandPlayer, action: ActionType, amount: number, now: number): void {
    const h = this.s.hand!;
    const p = this.player(hp.id);
    const legal = this.legal(hp.id);
    if (!legal) throw new GameError("It's not your turn");
    switch (action) {
      case "fold":
        if (!legal.canFold) throw new GameError("Nothing to call, so check instead");
        hp.folded = true;
        hp.lastAction = "Fold";
        this.log(now, "action", `${p.name} folds`, { playerId: p.id });
        break;
      case "check":
        if (!legal.canCheck) throw new GameError("You can't check, there's a bet to call");
        hp.lastAction = "Check";
        this.log(now, "action", `${p.name} checks`, { playerId: p.id });
        break;
      case "call": {
        if (legal.callAmount <= 0) throw new GameError("There's nothing to call");
        this.commit(hp, legal.callAmount);
        hp.lastAction = hp.allIn ? `All-in ${hp.streetBet}` : `Call ${legal.callAmount}`;
        this.log(now, "action", hp.allIn ? `${p.name} calls all-in (${hp.streetBet})` : `${p.name} calls ${legal.callAmount}`, {
          playerId: p.id,
        });
        break;
      }
      case "raise": {
        if (!legal.canRaise) throw new GameError("You can't raise right now");
        let to = Math.floor(Number(amount));
        if (!Number.isFinite(to)) throw new GameError("Invalid amount");
        if (to >= legal.maxRaiseTo) to = legal.maxRaiseTo;
        if (to < legal.minRaiseTo) throw new GameError(`The minimum is ${legal.minRaiseTo}`);
        const raiseBy = to - h.currentBet;
        this.commit(hp, to - hp.streetBet);
        // A short all-in doesn't change the minimum raise.
        if (raiseBy >= h.minRaise) h.minRaise = raiseBy;
        h.currentBet = Math.max(h.currentBet, to);
        const verb = legal.isBet ? "bets" : "raises to";
        hp.lastAction = hp.allIn ? `All-in ${to}` : legal.isBet ? `Bet ${to}` : `Raise ${to}`;
        this.log(now, "action", `${p.name} ${verb} ${to}${hp.allIn ? " (all-in)" : ""}`, { playerId: p.id });
        break;
      }
      default:
        throw new GameError("Unknown action");
    }
    hp.acted = true;
    hp.actedAt = h.currentBet;
    if (hp.allIn) this.lockBoard(now, p);
    this.touch(now);
    this.advance(now, hp.seat);
  }

  /** The all-in shield: board cards already out can no longer be targeted by powers. */
  private lockBoard(now: number, p: Player): void {
    const h = this.s.hand!;
    const unlocked = h.board.filter((b) => !b.locked);
    if (!unlocked.length) return;
    for (const b of unlocked) b.locked = true;
    this.log(now, "system", `${p.name}'s all-in shield locks the board`, { playerId: p.id });
  }

  private returnUncalled(now: number): void {
    const h = this.s.hand!;
    const sorted = [...h.players].sort((a, b) => b.streetBet - a.streetBet);
    const top = sorted[0];
    const second = sorted[1]?.streetBet ?? 0;
    if (!top || top.streetBet <= second) return;
    const refund = top.streetBet - second;
    top.streetBet -= refund;
    top.totalBet -= refund;
    const p = this.player(top.id);
    p.chips += refund;
    if (p.chips > 0) top.allIn = false;
    if (h.currentBet > top.streetBet) h.currentBet = top.streetBet;
    this.log(now, "system", `Uncalled ${refund} returned to ${p.name}`, { playerId: p.id });
  }

  private dealNextStreet(now: number): void {
    const h = this.s.hand!;
    const next = STREET_ORDER[STREET_ORDER.indexOf(h.street) + 1];
    for (const hp of h.players) {
      hp.streetBet = 0;
      hp.acted = false;
      hp.actedAt = 0;
      if (!hp.folded) hp.lastAction = hp.allIn ? "All-in" : null;
    }
    h.currentBet = 0;
    h.minRaise = h.bb;
    h.street = next;
    const count = next === "flop" ? 3 : 1;
    const cards: Card[] = [];
    for (let i = 0; i < count; i++) cards.push(this.drawCard());
    h.board.push(...cards.map((card): BoardCard => ({ card, street: next, deployed: false, locked: false })));
    const label = next[0].toUpperCase() + next.slice(1);
    this.log(now, "deal", `${label}: ${cards.map(cardText).join(" ")}`);
  }

  private runoutStep(now: number): void {
    const h = this.s.hand!;
    if (h.street === "river") {
      this.showdown(now);
      return;
    }
    this.dealNextStreet(now);
    h.nextStepAt = now + TIMING.runoutStep;
  }

  private drawCard(): Card {
    const h = this.s.hand!;
    if (h.deck.length === 0) {
      // Should never happen thanks to the deck reserve rule; recycle the muck just in case.
      h.deck = shuffle(h.muck, this.rng);
      h.muck = [];
    }
    const card = h.deck.shift();
    if (!card) throw new Error("Deck exhausted");
    return card;
  }

  /** Can `n` cards be taken from the deck and still leave enough to complete the board? */
  private canTake(n: number): boolean {
    const h = this.s.hand!;
    return h.deck.length - n >= BOARD_STILL_NEEDED[h.street];
  }

  private showdown(now: number): void {
    const h = this.s.hand!;
    h.phase = "done";
    h.toAct = null;
    h.turnDeadline = null;
    h.nextStepAt = null;
    const live = h.players.filter((p) => !p.folded);
    const board = h.board.map((b) => b.card);
    const values = new Map<string, HandValue>();
    for (const hp of live) {
      hp.showCards = true;
      values.set(hp.id, bestHand([...hp.hole.map((c) => c.card), ...board]));
    }
    const pots = this.buildPots();
    const won: Record<string, number> = {};
    for (const pot of pots) {
      const best = Math.max(...pot.eligible.map((id) => values.get(id)!.score));
      const winners = this.seatOrderAfter(
        h.players.filter((p) => pot.eligible.includes(p.id) && values.get(p.id)!.score === best),
        h.buttonSeat,
      );
      const share = Math.floor(pot.amount / winners.length);
      let odd = pot.amount - share * winners.length;
      for (const w of winners) {
        const amount = share + (odd > 0 ? 1 : 0);
        odd--;
        pot.winners.push({ id: w.id, amount });
        this.player(w.id).chips += amount;
        won[w.id] = (won[w.id] ?? 0) + amount;
      }
    }
    const hands: Record<string, { label: string; best: Card[] }> = {};
    for (const [id, v] of values) hands[id] = { label: v.label, best: v.cards };
    h.result = { showdown: true, pots, hands, won };
    pots.forEach((pot, i) => {
      const potName = pots.length > 1 ? (i === 0 ? "the main pot" : `side pot ${i}`) : "the pot";
      const names = pot.winners.map((w) => this.player(w.id).name);
      const label = values.get(pot.winners[0].id)!.label;
      const verb = names.length > 1 ? "split" : "wins";
      this.log(now, "win", `${names.join(" & ")} ${verb} ${potName} (${pot.amount}) with ${label}`, {
        playerId: pot.winners[0].id,
      });
    });
    this.finishHand(now, TIMING.showdownPause);
  }

  private winUncontested(now: number, winner: HandPlayer): void {
    const h = this.s.hand!;
    this.returnUncalled(now);
    const total = h.players.reduce((sum, p) => sum + p.totalBet, 0);
    this.player(winner.id).chips += total;
    h.phase = "done";
    h.toAct = null;
    h.turnDeadline = null;
    h.nextStepAt = null;
    h.pending = null;
    h.result = {
      showdown: false,
      pots: [{ amount: total, eligible: [winner.id], winners: [{ id: winner.id, amount: total }] }],
      hands: {},
      won: { [winner.id]: total },
    };
    this.log(now, "win", `${this.player(winner.id).name} wins the pot (${total})`, { playerId: winner.id });
    this.finishHand(now, TIMING.foldWinPause);
  }

  /** Main pot and side pots from everyone's total contributions. */
  buildPots(): PotResult[] {
    const h = this.s.hand!;
    const contrib = h.players.map((p) => ({ id: p.id, amount: p.totalBet, live: !p.folded }));
    const levels = [...new Set(contrib.filter((c) => c.live && c.amount > 0).map((c) => c.amount))].sort((a, b) => a - b);
    const pots: PotResult[] = [];
    let prev = 0;
    for (const level of levels) {
      let amount = 0;
      for (const c of contrib) amount += Math.max(0, Math.min(c.amount, level) - Math.min(c.amount, prev));
      const eligible = contrib.filter((c) => c.live && c.amount >= level).map((c) => c.id);
      const last = pots[pots.length - 1];
      if (last && last.eligible.length === eligible.length && last.eligible.every((id) => eligible.includes(id))) {
        last.amount += amount;
      } else if (amount > 0) {
        pots.push({ amount, eligible, winners: [] });
      }
      prev = level;
    }
    // Dead money above the biggest live contribution (only possible from folded players).
    const total = contrib.reduce((sum, c) => sum + c.amount, 0);
    const covered = pots.reduce((sum, p) => sum + p.amount, 0);
    if (total > covered && pots.length) pots[pots.length - 1].amount += total - covered;
    return pots;
  }

  private finishHand(now: number, pause: number): void {
    const s = this.s;
    const h = s.hand!;
    h.pending = null;
    for (const hp of h.players) {
      const p = this.player(hp.id);
      if (p.status === "playing" && p.chips === 0) {
        p.status = "busted";
        if (this.canRebuy(p)) {
          p.rebuyDeclined = false;
          p.rebuyDeadline = now + pause + TIMING.rebuyWindow;
          this.log(now, "system", `${p.name} is out of chips, rebuy?`, { playerId: p.id });
        } else {
          p.rebuyDeclined = true;
          p.rebuyDeadline = null;
        }
      }
    }
    s.nextHandAt = now + pause;
    this.touch(now);
    this.resolveBusts(now);
  }

  private canRebuy(p: Player): boolean {
    const r = this.s.settings.rebuys;
    return r === UNLIMITED_REBUYS || p.rebuysUsed < r;
  }

  rebuy(playerId: string, accept: boolean, now: number): void {
    const p = this.player(playerId);
    if (this.s.status !== "running" || p.status !== "busted" || p.rebuyDeclined) {
      throw new GameError("There's no rebuy waiting for you");
    }
    if (accept) {
      p.chips = this.s.settings.startingChips;
      p.rebuysUsed++;
      p.status = "playing";
      p.rebuyDeadline = null;
      p.away = false;
      this.log(now, "system", `${p.name} rebuys for ${p.chips}`, { playerId: p.id });
    } else {
      p.rebuyDeclined = true;
      p.rebuyDeadline = null;
      this.log(now, "system", `${p.name} doesn't rebuy`, { playerId: p.id });
    }
    this.touch(now);
    this.resolveBusts(now);
  }

  /** Once every busted player has decided, eliminate the ones who didn't rebuy. */
  private resolveBusts(now: number): void {
    const s = this.s;
    const busted = s.players.filter((p) => p.status === "busted");
    if (busted.some((p) => !p.rebuyDeclined)) return;
    if (busted.length) {
      const remaining = s.players.filter((p) => p.status === "playing" || p.status === "busted").length;
      // Bigger stack at the start of the hand finishes higher.
      busted.sort((a, b) => a.handStartChips - b.handStartChips);
      busted.forEach((p, i) => {
        p.status = "out";
        p.place = remaining - i;
        p.rebuyDeadline = null;
        this.log(now, "system", `${p.name} finishes ${ordinal(p.place)}`, { playerId: p.id });
      });
    }
    this.checkWinner(now);
  }

  private checkWinner(now: number): void {
    const s = this.s;
    if (s.status !== "running") return;
    const alive = s.players.filter((p) => p.status === "playing" || p.status === "busted");
    if (alive.length === 1 && alive[0].status === "playing") {
      const w = alive[0];
      w.place = 1;
      s.status = "finished";
      s.winnerId = w.id;
      s.nextHandAt = null;
      s.paused = false;
      s.pausedAt = null;
      s.autoPaused = false;
      this.log(now, "win", `🏆 ${w.name} wins the game!`, { playerId: w.id });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Powers                                                            */
  /* ---------------------------------------------------------------- */

  private refillPowers(p: Player): void {
    const handSize = MODE_RULES[this.mode].handSize;
    const pool = this.s.settings.powers;
    while (p.powers.length < handSize) {
      const held = new Set(p.powers.map((c) => c.type));
      let candidates = pool.filter((t) => !held.has(t));
      if (!candidates.length) candidates = [...pool];
      const hint = this.hooks.pickPower?.(p, candidates, this.s.handNumber);
      const type = hint && candidates.includes(hint) ? hint : this.rollPower(candidates);
      p.powers.push({ id: randomId(this.rng, 8), type });
    }
  }

  /** A random power type, weighted by how often each is dealt in this mode. */
  private rollPower(candidates: PowerType[]): PowerType {
    const mode = this.mode;
    const weights = candidates.map((t) => Math.round(POWERS[t].weight[mode] * 100));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = this.rng.int(total);
    for (let i = 0; i < candidates.length; i++) {
      if (roll < weights[i]) return candidates[i];
      roll -= weights[i];
    }
    return candidates[candidates.length - 1];
  }

  lastClonable(): PowerType | null {
    const h = this.s.hand;
    if (!h) return null;
    for (let i = h.powerHistory.length - 1; i >= 0; i--) {
      if (h.powerHistory[i].type !== "clone") return h.powerHistory[i].type;
    }
    return null;
  }

  disintegrateTargets(): number[] {
    const h = this.s.hand;
    if (!h) return [];
    return h.board.flatMap((b, i) => (b.street === h.street && !b.locked ? [i] : []));
  }

  private xrayTargets(playerId: string): HandPlayer[] {
    const h = this.s.hand!;
    return h.players.filter((p) => p.id !== playerId && !p.folded && p.hole.length > 0 && !p.hole.some((c) => c.exposed));
  }

  /** Why `playerId` can't play a `type` power right now (null if they can). */
  powerBlockReason(playerId: string, type: PowerType): string | null {
    const s = this.s;
    const h = s.hand;
    if (s.status !== "running" || !h || h.phase !== "betting") return "Powers are played during a hand";
    if (s.paused) return "The game is paused";
    if (h.toAct !== playerId) return "Wait for your turn";
    if (h.pending) return "Finish your current power first";
    if (h.empStreet === h.street && h.empBy !== playerId) return "Knocked out by EMP this street";
    const p = this.player(playerId);
    const hp = this.handPlayer(playerId);
    const cost = powerCost(type, this.mode);
    if (p.energy < cost) return `Needs ${cost} energy`;
    const thin = "Not enough cards left in the deck";
    switch (type) {
      case "clone":
        return this.lastClonable() ? null : "No power has been played this hand";
      case "deploy":
        if (h.deploys >= MAX_DEPLOYS_PER_HAND) return "Already two cards deployed this hand";
        return this.canTake(1) ? null : thin;
      case "disintegrate":
        if (!this.disintegrateTargets().length) return "No unshielded card dealt this street";
        return this.canTake(1) ? null : thin;
      case "emp":
        return h.empStreet === h.street ? "Your EMP is already active" : null;
      case "engineer":
        return h.deck.length >= 3 && this.canTake(2) ? null : thin;
      case "intel":
        return hp.intel ? "Intel is already active" : null;
      case "reload":
        return this.canTake(1) ? null : thin;
      case "scanner":
        return h.deck.length >= 2 && this.canTake(1) ? null : thin;
      case "upgrade":
        return this.canTake(1) ? null : thin;
      case "xray":
        return this.xrayTargets(playerId).length ? null : "No opponent left to X-Ray";
    }
  }

  playPower(playerId: string, powerId: string, params: PowerParams, now: number): void {
    this.requirePlaying();
    const p = this.player(playerId);
    const card = p.powers.find((c) => c.id === powerId);
    if (!card) throw new GameError("You don't have that power");
    const reason = this.powerBlockReason(playerId, card.type);
    if (reason) throw new GameError(reason);
    const h = this.s.hand!;
    const hp = this.handPlayer(playerId);

    // Validate targets before paying.
    let target = -1;
    let indices: number[] = [];
    if (card.type === "disintegrate") {
      target = Number(params.target);
      if (!this.disintegrateTargets().includes(target)) {
        throw new GameError("Pick an unshielded board card dealt this street");
      }
    }
    if (card.type === "reload") {
      indices = [...new Set((params.indices ?? []).map(Number))];
      if (!indices.length || indices.length > hp.hole.length || indices.some((i) => !Number.isInteger(i) || i < 0 || i >= hp.hole.length)) {
        throw new GameError("Pick one or both of your hole cards to reload");
      }
      if (!this.canTake(indices.length)) throw new GameError("Not enough cards left in the deck");
    }

    p.energy -= powerCost(card.type, this.mode);
    p.powers = p.powers.filter((c) => c.id !== card.id);
    h.powerHistory.push({ playerId, type: card.type });
    if (p.away) p.away = false;
    const name = p.name;
    const meta = { playerId, power: card.type };

    switch (card.type) {
      case "clone": {
        const copied = this.lastClonable()!;
        // lastClonable ignores the clone we just recorded, so this is the previous real power.
        p.powers.push({ id: randomId(this.rng, 8), type: copied });
        this.log(now, "power", `${name} plays Clone and copies ${POWERS[copied].name}`, meta);
        break;
      }
      case "deploy": {
        const c = this.drawCard();
        h.board.push({ card: c, street: h.street, deployed: true, locked: false });
        h.deploys++;
        this.log(now, "power", `${name} plays Deploy: ${cardText(c)} joins the board`, meta);
        break;
      }
      case "disintegrate": {
        const old = h.board[target];
        h.muck.push(old.card);
        const c = this.drawCard();
        h.board[target] = { ...old, card: c, locked: false };
        this.log(now, "power", `${name} plays Disintegrate: ${cardText(old.card)} is destroyed, ${cardText(c)} replaces it`, meta);
        break;
      }
      case "emp":
        h.empStreet = h.street;
        h.empBy = playerId;
        this.log(now, "power", `${name} plays EMP: opponents' powers are offline this street`, meta);
        break;
      case "engineer": {
        const options = [this.drawCard(), this.drawCard(), this.drawCard()];
        h.pending = { kind: "engineer", playerId, cards: options };
        this.log(now, "power", `${name} plays Engineer: ${options.map(cardText).join(" ")}. Which comes next?`, meta);
        break;
      }
      case "intel":
        hp.intel = true;
        this.log(now, "power", `${name} plays Intel and can see the top of the deck`, meta);
        break;
      case "reload": {
        const exposed: Card[] = [];
        for (const i of indices) {
          const old = hp.hole[i];
          if (old.exposed) exposed.push(old.card);
          h.muck.push(old.card);
          hp.hole[i] = { card: this.drawCard(), exposed: false };
        }
        const what = indices.length === 2 ? "both hole cards" : "a hole card";
        const extra = exposed.length ? ` (including the exposed ${exposed.map(cardText).join(" ")})` : "";
        this.log(now, "power", `${name} plays Reload and swaps ${what}${extra}`, meta);
        break;
      }
      case "scanner":
        h.pending = { kind: "scanner", playerId, cards: h.deck.slice(0, 2) };
        this.log(now, "power", `${name} plays Scanner and peeks at the top two cards`, meta);
        break;
      case "upgrade":
        hp.hole.push({ card: this.drawCard(), exposed: false });
        h.pending = { kind: "upgrade", playerId };
        this.log(now, "power", `${name} plays Upgrade and draws a third hole card`, meta);
        break;
      case "xray": {
        const shown: string[] = [];
        for (const target of this.xrayTargets(playerId)) {
          const hidden = target.hole.map((c, i) => (c.exposed ? -1 : i)).filter((i) => i >= 0);
          const pick = hidden[this.rng.int(hidden.length)];
          target.hole[pick].exposed = true;
          shown.push(`${this.player(target.id).name} shows ${cardText(target.hole[pick].card)}`);
        }
        this.log(now, "power", `${name} plays X-Ray: ${shown.join(", ")}`, meta);
        break;
      }
    }

    if (h.turnDeadline !== null) {
      const min = h.pending ? TIMING.minChoiceTime : TIMING.minAfterPower;
      h.turnDeadline = Math.max(h.turnDeadline, now + min);
    }
    this.touch(now);
  }

  choose(playerId: string, index: number | null, now: number): void {
    this.requirePlaying();
    const h = this.s.hand;
    const pending = h?.pending;
    if (!h || !pending || pending.playerId !== playerId) throw new GameError("There's nothing to choose");
    this.resolvePending(index, now);
    if (h.turnDeadline !== null) h.turnDeadline = Math.max(h.turnDeadline, now + TIMING.minAfterPower);
    this.touch(now);
  }

  private resolvePending(index: number | null, now: number): void {
    const h = this.s.hand!;
    const pending = h.pending!;
    const p = this.player(pending.playerId);
    switch (pending.kind) {
      case "scanner": {
        if (index === null) {
          this.log(now, "power", `${p.name} keeps both cards on the deck`, { playerId: p.id, power: "scanner" });
        } else if (index === 0 || index === 1) {
          const card = pending.cards[index];
          const at = h.deck.indexOf(card);
          if (at >= 0) h.deck.splice(at, 1);
          h.muck.push(card);
          // Opponents learn that a card was discarded, not which one, so an Engineer-revealed top card
          // stops being public either way.
          h.knownTop = null;
          this.log(now, "power", `${p.name} discards one of the top cards`, { playerId: p.id, power: "scanner" });
        } else {
          throw new GameError("Choose a card to discard, or keep both");
        }
        break;
      }
      case "upgrade": {
        const hp = this.handPlayer(p.id);
        if (index === null || !Number.isInteger(index) || index < 0 || index >= hp.hole.length) {
          throw new GameError("Choose a hole card to discard");
        }
        const [removed] = hp.hole.splice(index, 1);
        h.muck.push(removed.card);
        const what = removed.exposed ? `their exposed ${cardText(removed.card)}` : "a hole card";
        this.log(now, "power", `${p.name} discards ${what}`, { playerId: p.id, power: "upgrade" });
        break;
      }
      case "engineer": {
        if (index === null || !Number.isInteger(index) || index < 0 || index >= pending.cards.length) {
          throw new GameError("Choose the next card");
        }
        const chosen = pending.cards[index];
        h.deck.unshift(chosen);
        for (const c of pending.cards) if (c !== chosen) h.muck.push(c);
        h.knownTop = chosen;
        this.log(now, "power", `${p.name} engineers ${cardText(chosen)} as the next card`, { playerId: p.id, power: "engineer" });
        break;
      }
    }
    h.pending = null;
  }

  private resolvePendingDefault(now: number): void {
    const pending = this.s.hand!.pending!;
    if (pending.kind === "scanner") this.resolvePending(null, now);
    else if (pending.kind === "upgrade") this.resolvePending(this.handPlayer(pending.playerId).hole.length - 1, now);
    else this.resolvePending(0, now);
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  private requireHost(byId: string): void {
    if (byId !== this.s.hostId) throw new GameError("Only the host can do that");
  }

  private requirePlaying(): void {
    if (this.s.status !== "running") throw new GameError("The game isn't running");
    if (this.s.paused) throw new GameError("The game is paused");
  }

  touch(now: number): void {
    this.s.lastActivityAt = now;
  }

  log(now: number, kind: LogEntry["kind"], text: string, extra: Partial<Pick<LogEntry, "playerId" | "power">> = {}): void {
    const s = this.s;
    s.logSeq++;
    s.log.push({ seq: s.logSeq, at: now, kind, text, ...extra });
    if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
  }

  /** Every card currently in play (for invariant checks in tests). */
  allCards(): Card[] {
    const h = this.s.hand;
    if (!h) return [];
    const out: Card[] = [...h.deck, ...h.muck, ...h.board.map((b) => b.card)];
    for (const hp of h.players) out.push(...hp.hole.map((c) => c.card));
    if (h.pending?.kind === "engineer") out.push(...h.pending.cards);
    return out;
  }

  powersOf(playerId: string): PowerCard[] {
    return this.player(playerId).powers;
  }
}
