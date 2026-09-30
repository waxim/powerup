import type { ClientMessage } from "../shared/protocol";
import { Game, GameError } from "./game";

/** Messages a seated player sends during a game, as opposed to joining, leaving or kicking. */
export type PlayerMessage = Extract<
  ClientMessage,
  { t: "start" | "act" | "power" | "choose" | "rebuy" | "back" | "pause" | "resume" | "rematch" }
>;

export function isPlayerMessage(msg: ClientMessage): msg is PlayerMessage {
  switch (msg.t) {
    case "start":
    case "act":
    case "power":
    case "choose":
    case "rebuy":
    case "back":
    case "pause":
    case "resume":
    case "rematch":
      return true;
    default:
      return false;
  }
}

/**
 * Apply a seated player's message to the game. Shared by real tables (the Durable Object) and practice
 * tables in the browser, so both treat every message, including malformed input, the same way.
 */
export function applyPlayerMessage(
  game: Game,
  playerId: string,
  msg: PlayerMessage,
  now: number,
  opts: { hostAbsent?: boolean } = {},
): void {
  switch (msg.t) {
    case "start":
      game.start(playerId, now);
      return;
    case "act":
      game.act(playerId, msg.action, typeof msg.amount === "number" ? msg.amount : undefined, now);
      return;
    case "power":
      game.playPower(
        playerId,
        String(msg.powerId),
        {
          target: typeof msg.target === "number" ? msg.target : undefined,
          indices: Array.isArray(msg.indices) ? msg.indices.filter((i) => typeof i === "number") : undefined,
        },
        now,
      );
      return;
    case "choose":
      game.choose(playerId, typeof msg.index === "number" ? msg.index : null, now);
      return;
    case "rebuy":
      game.rebuy(playerId, msg.accept === true, now);
      return;
    case "back":
      game.setBack(playerId, now);
      return;
    case "pause":
      game.pause(playerId, now);
      return;
    case "resume":
      game.resume(playerId, now, opts);
      return;
    case "rematch":
      game.rematch(playerId, now);
      return;
    default:
      throw new GameError("Unknown request");
  }
}
