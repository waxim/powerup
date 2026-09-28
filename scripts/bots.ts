/**
 * Plays complete PowerUp games against a running server with random bots, to check the
 * Worker + Durable Object end to end (hidden information, chip conservation, powers, rebuys).
 *
 *   npm run dev            # in another terminal
 *   node scripts/bots.ts --players 4 --url http://localhost:5173
 */
import WebSocket from "ws";
import type { ServerMessage, TableView } from "../src/shared/protocol";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = arg("url", "http://localhost:5173");
const PLAYERS = Number(arg("players", "3"));
const REBUYS = Number(arg("rebuys", "1"));
const CHIPS = 300;
const TIMEOUT_MS = Number(arg("timeout", "240000"));

interface Bot {
  name: string;
  token: string;
  id: string;
  ws: WebSocket;
  view: TableView | null;
  busy: boolean;
}

const problems: string[] = [];
const powersUsed: Record<string, number> = {};
const handsSeen = new Set<number>();
let rebuysTaken = 0;

function fail(msg: string) {
  if (problems.length < 20) problems.push(msg);
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function checkView(bot: Bot, view: TableView) {
  const h = view.hand;
  // Nobody may see another player's face-down cards.
  for (const p of view.players) {
    if (p.id === bot.id) continue;
    const showdown = h?.phase === "done" && p.handLabel;
    for (const c of p.hole) if (c.card && !c.exposed && !showdown) fail(`${bot.name} can see ${p.name}'s hidden card`);
  }
  if (view.me && h && view.me.hole.length && view.me.hole.length !== 2 && !view.me.upgrade) {
    fail(`${bot.name} has ${view.me.hole.length} hole cards`);
  }
  // Chips are conserved: stacks + pot = buy-ins.
  const buyIns = view.players.reduce((sum, p) => sum + CHIPS * (1 + p.rebuysUsed), 0);
  const inPot = h && h.phase !== "done" ? h.pot : 0;
  const total = view.players.reduce((sum, p) => sum + p.chips, 0) + inPot;
  if (view.status === "running" && total !== buyIns) fail(`chips ${total} != buy-ins ${buyIns} (hand ${h?.number})`);
  if (h) handsSeen.add(h.number);
}

function act(bot: Bot) {
  const v = bot.view;
  if (!v || !v.me || bot.busy) return;
  const me = v.me;
  const send = (msg: object) => {
    bot.busy = true;
    bot.ws.send(JSON.stringify(msg));
  };
  if (me.rebuy) {
    const accept = Math.random() < 0.6;
    if (accept) rebuysTaken++;
    return send({ t: "rebuy", accept });
  }
  if (me.scanner) return send({ t: "choose", index: pick([null, 0, 1]) });
  if (me.upgrade) return send({ t: "choose", index: Math.floor(Math.random() * 3) });
  if (me.engineer) return send({ t: "choose", index: Math.floor(Math.random() * 3) });
  if (!me.legal) return;
  const playable = me.powers.filter((p) => p.playable);
  if (playable.length && Math.random() < 0.35) {
    const power = pick(playable);
    powersUsed[power.type] = (powersUsed[power.type] ?? 0) + 1;
    const targets = v.hand!.board.flatMap((b, i) => (b.current && !b.locked ? [i] : []));
    return send({ t: "power", powerId: power.id, target: pick(targets.length ? targets : [0]), indices: pick([[0], [1], [0, 1]]) });
  }
  const legal = me.legal;
  const r = Math.random();
  if (r < 0.15 && legal.canFold) return send({ t: "act", action: "fold" });
  if (r < 0.4 && legal.canRaise) {
    const amount = legal.minRaiseTo + Math.floor(Math.random() * (legal.maxRaiseTo - legal.minRaiseTo + 1));
    return send({ t: "act", action: "raise", amount });
  }
  return send({ t: "act", action: legal.canCheck ? "check" : "call" });
}

function connect(bot: Bot, tableId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/api/tables/${tableId}/ws`);
    bot.ws = ws;
    ws.on("open", () => {
      ws.send(JSON.stringify({ t: "hello", token: bot.token || undefined }));
      resolve();
    });
    ws.on("error", reject);
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data)) as ServerMessage;
      if (msg.t === "joined") {
        bot.token = msg.token;
        bot.id = msg.playerId;
      } else if (msg.t === "state") {
        bot.busy = false;
        bot.view = msg.view;
        checkView(bot, msg.view);
        // Small think time so several bots don't all fire in the same millisecond.
        setTimeout(() => act(bot), 20 + Math.random() * 60);
      } else if (msg.t === "error") {
        bot.busy = false;
        if (!/not your turn|nothing to|Finish your power/i.test(msg.message)) fail(`${bot.name}: server error "${msg.message}"`);
      }
    });
  });
}

async function main() {
  const res = await fetch(`${BASE}/api/tables`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Bot0",
      settings: { maxSeats: PLAYERS, startingChips: CHIPS, startingSmallBlind: 5, levelMinutes: 1, rebuys: REBUYS, turnSeconds: 15 },
    }),
  });
  const created = (await res.json()) as { id: string; playerId: string; token: string };
  console.log(`table ${created.id} (${BASE}/t/${created.id})`);
  const bots: Bot[] = [{ name: "Bot0", token: created.token, id: created.playerId, ws: null!, view: null, busy: false }];
  await connect(bots[0], created.id);
  for (let i = 1; i < PLAYERS; i++) {
    const bot: Bot = { name: `Bot${i}`, token: "", id: "", ws: null!, view: null, busy: false };
    bots.push(bot);
    await connect(bot, created.id);
    bot.ws.send(JSON.stringify({ t: "join", name: bot.name }));
  }
  // A spectator must never see any hole cards.
  const spectator: Bot = { name: "Spectator", token: "", id: "none", ws: null!, view: null, busy: true };
  await connect(spectator, created.id);

  await new Promise((r) => setTimeout(r, 500));
  bots[0].ws.send(JSON.stringify({ t: "start" }));

  const started = Date.now();
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const v = bots[0].view;
      if (v?.status === "finished" || Date.now() - started > TIMEOUT_MS) {
        clearInterval(timer);
        resolve();
      }
    }, 250);
  });

  const v = bots[0].view!;
  const winner = v.players.find((p) => p.id === v.winnerId);
  console.log(
    JSON.stringify(
      {
        status: v.status,
        mode: v.mode,
        winner: winner?.name,
        places: v.players.map((p) => `${p.place}:${p.name}`).sort(),
        hands: handsSeen.size,
        rebuysTaken,
        powersUsed,
        seconds: Math.round((Date.now() - started) / 1000),
      },
      null,
      1,
    ),
  );
  for (const b of [...bots, spectator]) b.ws.close();
  if (v.status !== "finished") fail("game did not finish in time");
  if (problems.length) {
    console.error("PROBLEMS:\n" + problems.join("\n"));
    process.exit(1);
  }
  console.log("OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
