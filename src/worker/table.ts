import { DurableObject } from "cloudflare:workers";
import { applyPlayerMessage, isPlayerMessage } from "../engine/dispatch";
import { Game, GameError } from "../engine/game";
import { cryptoRng } from "../engine/rng";
import type { TableState } from "../engine/state";
import { buildView } from "../engine/view";
import type { ClientMessage, ServerMessage } from "../shared/protocol";

interface Attachment {
  playerId: string | null;
}

/** Tables with no activity for this long are deleted. */
const IDLE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** A running game with no players connected pauses itself after this long. */
const AUTO_PAUSE_MS = 3 * 60 * 1000;
const MAX_MESSAGE_BYTES = 4096;
/** Per-socket rate limit (token bucket): bursts of 30 messages, refilling at 15 per second. */
const RATE_BURST = 30;
const RATE_PER_SECOND = 15;

export type CreateResult = { ok: true; playerId: string; token: string } | { ok: false; error: string; exists?: boolean };

/**
 * One poker table. The Durable Object is the single source of truth: it holds the deck and every
 * player's cards, validates each move with the game engine, persists the state, and pushes a
 * personalised view to every connected WebSocket. Alarms drive the turn clock and blind levels.
 */
export class PowerUpTable extends DurableObject<Env> {
  private state: TableState | null = null;
  /** What's in storage, so unchanged state isn't written again (Durable Object writes are metered). */
  private savedJson: string | null = null;
  private alarmAt: number | null = null;
  private buckets = new WeakMap<WebSocket, { tokens: number; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<TableState>("state")) ?? null;
      this.savedJson = this.state ? JSON.stringify(this.state) : null;
      this.alarmAt = await ctx.storage.getAlarm();
    });
    // Keep-alive pings are answered without waking the object up.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** RPC from the Worker: set up a brand new table with its host. */
  async create(input: { id: string; settings: unknown; hostName: string }): Promise<CreateResult> {
    if (this.state) return { ok: false, error: "Table already exists", exists: true };
    try {
      const now = Date.now();
      const { game, host } = Game.create({
        id: input.id,
        settings: (input.settings ?? {}) as never,
        hostName: input.hostName,
        now,
        rng: cryptoRng,
      });
      this.state = game.s;
      await this.persist(game);
      return { ok: true, playerId: host.id, token: host.token };
    } catch (err) {
      this.state = null;
      return { ok: false, error: err instanceof GameError ? err.message : "Could not create the table" };
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES || !this.allow(ws)) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return;
    if (!this.state) {
      this.send(ws, { t: "notfound" });
      return;
    }

    const now = Date.now();
    // Catch up on any timer that is due before applying the request.
    const game = this.catchUp(now);
    const before = structuredClone(game.s);
    try {
      this.handle(game, ws, msg, now);
    } catch (err) {
      // Roll back anything a failed request may have half-done.
      this.state = before;
      if (!(err instanceof GameError)) console.error("table error", err);
      this.send(ws, { t: "error", message: err instanceof GameError ? err.message : "Something went wrong" });
      // Only the sender hears about a rejected request, unless catching up changed the table.
      const restored = new Game(before, cryptoRng);
      if (await this.persist(restored)) this.broadcast(restored, now);
      return;
    }
    await this.persist(game);
    this.broadcast(game, now);
  }

  /** Run due timers; if the engine throws, keep the last good state instead. */
  private catchUp(now: number): Game {
    const snapshot = structuredClone(this.state!);
    const game = new Game(this.state!, cryptoRng);
    try {
      game.tick(now);
      return game;
    } catch (err) {
      console.error("tick failed", err);
      this.state = snapshot;
      return new Game(snapshot, cryptoRng);
    }
  }

  private handle(game: Game, ws: WebSocket, msg: ClientMessage, now: number): void {
    const seatedId = this.seatedPlayerId(game, ws);
    switch (msg.t) {
      case "hello": {
        const p = typeof msg.token === "string" ? game.playerByToken(msg.token) : undefined;
        ws.serializeAttachment({ playerId: p?.id ?? null } satisfies Attachment);
        return;
      }
      case "join": {
        if (seatedId) throw new GameError("You're already at this table");
        const p = game.join(String(msg.name ?? ""), now);
        ws.serializeAttachment({ playerId: p.id } satisfies Attachment);
        this.send(ws, { t: "joined", playerId: p.id, token: p.token });
        return;
      }
    }
    if (!seatedId) throw new GameError("Join the table first");
    const pid = seatedId;
    switch (msg.t) {
      case "leave":
        game.leave(pid, now);
        // The client forgets its seat token only once the server has actually let it go.
        this.send(ws, { t: "left" });
        return;
      case "kick": {
        const target = String(msg.playerId);
        game.kick(pid, target, now);
        for (const other of this.ctx.getWebSockets()) {
          if (this.attachment(other).playerId === target) this.send(other, { t: "left" });
        }
        return;
      }
      default:
        if (!isPlayerMessage(msg)) throw new GameError("Unknown request");
        // Anyone seated may lift a pause whose host has gone.
        const hostAbsent = msg.t === "resume" && !this.connectedPlayers(game).has(game.s.hostId);
        applyPlayerMessage(game, pid, msg, now, { hostAbsent });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
    await this.onDisconnect(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.onDisconnect(ws);
  }

  private async onDisconnect(closed: WebSocket): Promise<void> {
    if (!this.state) return;
    const game = new Game(this.state, cryptoRng);
    const now = Date.now();
    await this.persist(game, closed);
    this.broadcast(game, now, closed);
  }

  async alarm(): Promise<void> {
    this.alarmAt = null; // it just fired
    if (!this.state) return;
    const now = Date.now();
    const game = new Game(this.state, cryptoRng);
    if (now >= game.s.lastActivityAt + IDLE_TTL_MS) {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.close(1000, "Table closed");
        } catch {
          // ignore
        }
      }
      this.state = null;
      this.savedJson = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    const s = game.s;
    if (s.status === "running" && !s.paused && s.emptySince !== null && now - s.emptySince >= AUTO_PAUSE_MS) {
      game.autoPause(now);
    }
    const after = this.catchUp(now);
    await this.persist(after);
    this.broadcast(after, now);
  }

  /* ---------------------------------------------------------------- */

  private attachment(ws: WebSocket): Attachment {
    return (ws.deserializeAttachment() as Attachment | null) ?? { playerId: null };
  }

  private seatedPlayerId(game: Game, ws: WebSocket): string | null {
    const id = this.attachment(ws).playerId;
    return id && game.s.players.some((p) => p.id === id) ? id : null;
  }

  private openSockets(exclude?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws !== exclude && ws.readyState === WebSocket.OPEN);
  }

  private connectedPlayers(game: Game, exclude?: WebSocket): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.openSockets(exclude)) {
      const id = this.seatedPlayerId(game, ws);
      if (id) ids.add(id);
    }
    return ids;
  }

  /**
   * Save state (only if it changed) and set the alarm for the next timer: turn clock, runout, next hand,
   * auto-pause or cleanup. Returns true if the state changed.
   */
  private async persist(game: Game, exclude?: WebSocket): Promise<boolean> {
    const s = game.s;
    const now = Date.now();
    const anyoneHere = this.connectedPlayers(game, exclude).size > 0;
    if (anyoneHere || s.status !== "running" || s.paused) s.emptySince = null;
    else if (s.emptySince === null) s.emptySince = now;
    this.state = s;
    const json = JSON.stringify(s);
    const changed = json !== this.savedJson;
    if (changed) {
      await this.ctx.storage.put("state", s);
      this.savedJson = json;
    }

    const times = [s.lastActivityAt + IDLE_TTL_MS];
    const wake = game.nextWakeAt();
    if (wake !== null) times.push(wake);
    if (s.emptySince !== null) times.push(s.emptySince + AUTO_PAUSE_MS);
    const at = Math.max(now + 1, Math.min(...times));
    if (at !== this.alarmAt) {
      await this.ctx.storage.setAlarm(at);
      this.alarmAt = at;
    }
    return changed;
  }

  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(ws) ?? { tokens: RATE_BURST, at: now };
    bucket.tokens = Math.min(RATE_BURST, bucket.tokens + ((now - bucket.at) / 1000) * RATE_PER_SECOND);
    bucket.at = now;
    const ok = bucket.tokens >= 1;
    if (ok) bucket.tokens -= 1;
    this.buckets.set(ws, bucket);
    return ok;
  }

  private broadcast(game: Game, now: number, exclude?: WebSocket): void {
    const sockets = this.openSockets(exclude);
    const connected = this.connectedPlayers(game, exclude);
    for (const ws of sockets) {
      this.send(ws, { t: "state", view: buildView(game, this.seatedPlayerId(game, ws), now, connected) });
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // The socket went away; its close handler will tidy up.
    }
  }
}
