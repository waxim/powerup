/**
 * Plays bot-only practice sessions and prints how the bots behave, for tuning `src/client/practice/bot.ts`.
 * From the repository root:
 *   npx esbuild scripts/practice-sim.ts --bundle --platform=node --format=esm --outfile=/tmp/sim.mjs && node /tmp/sim.mjs [sessions]
 */
import { PERSONALITIES, newBotMemory, practiceBot } from "../src/client/practice/bot";
import { LocalTable, type BotMove, type BotPolicy } from "../src/client/practice/localTable";
import { seededRng } from "../src/engine/rng";
import type { TableView } from "../src/shared/protocol";

const sessions = Number(process.argv[2] ?? 12);
const T0 = 1_700_000_000_000;

interface Stats {
  hands: number;
  vpip: number;
  pfr: number;
  showdowns: number;
  powers: number;
  powerThenFold: number;
  decisions: number;
  ms: number[];
  byType: Record<string, number>;
  byStreet: Record<string, number>;
}
const blank = (): Stats => ({ hands: 0, vpip: 0, pfr: 0, showdowns: 0, powers: 0, powerThenFold: 0, decisions: 0, ms: [], byType: {}, byStreet: {} });
const coverage: number[] = [];
const stats: Record<string, Stats> = {};
for (const p of PERSONALITIES) stats[p.name] = blank();

for (let session = 0; session < sessions; session++) {
  const opponents = 1 + (session % 5);
  // Per bot, per hand: what it did preflop, and the street of its last power.
  // Power types the bots played in the first three orbits: what a newcomer gets to see.
  const seenEarly = new Set<string>();
  const handNotes = new Map<string, { vpip: boolean; pfr: boolean; powerStreet: string | null; counted: boolean }>();
  const note = (name: string, hand: number) => {
    const key = `${name}#${hand}`;
    if (!handNotes.has(key)) handNotes.set(key, { vpip: false, pfr: false, powerStreet: null, counted: false });
    return handNotes.get(key)!;
  };
  const traced = (profile: number): BotPolicy => (view, rng, _p, memory) => {
    const name = PERSONALITIES[profile].name;
    const st = stats[name];
    const t0 = performance.now();
    const move = practiceBot(view, rng, profile, memory);
    st.ms.push(performance.now() - t0);
    st.decisions++;
    record(view, name, move);
    return move;
  };
  const record = (view: TableView, name: string, move: BotMove | null) => {
    const h = view.hand;
    if (!h || !move) return;
    if (move.t === "power" && h.number <= 3 * (opponents + 1)) seenEarly.add(view.me!.powers.find((x) => x.id === move.powerId)!.type);
    const n = note(name, h.number);
    const st = stats[name];
    if (move.t === "power") {
      const type = view.me!.powers.find((x) => x.id === move.powerId)!.type;
      st.powers++;
      st.byType[type] = (st.byType[type] ?? 0) + 1;
      st.byStreet[h.street] = (st.byStreet[h.street] ?? 0) + 1;
      n.powerStreet = h.street;
    }
    if (move.t === "act") {
      if (h.street === "preflop" && (move.action === "call" || move.action === "raise")) n.vpip = true;
      if (h.street === "preflop" && move.action === "raise") n.pfr = true;
      if (move.action === "fold" && n.powerStreet === h.street) st.powerThenFold++;
    }
  };

  // Every seat is a bot: the "human" seat plays as a sixth personality slot (profile of the last bot + 1).
  const humanProfile = opponents % PERSONALITIES.length;
  const humanMemory = newBotMemory();
  const t = new LocalTable({ name: "Sim", opponents, orbits: 6, seed: 1000 + session }, T0, (view, rng, profile, memory) =>
    traced(profile)(view, rng, profile, memory),
  );
  const humanRng = seededRng(session);
  let now = T0;
  let lastHand = 0;
  for (let step = 0; step < 100_000 && !t.ended; step++) {
    const v = t.view(now);
    const h = t.game.s.hand;
    if (h && h.number !== lastHand && h.phase === "done") {
      lastHand = h.number;
      for (const hp of h.players) {
        const bot = t.bots.find((b) => b.id === hp.id);
        if (!bot) continue;
        const name = PERSONALITIES[bot.profile].name;
        const n = note(name, h.number);
        const st = stats[name];
        st.hands++;
        if (n.vpip) st.vpip++;
        if (n.pfr) st.pfr++;
        if (h.result?.showdown && !hp.folded) st.showdowns++;
      }
    }
    const needs = v.me?.legal || v.me?.rebuy || v.me?.scanner || v.me?.upgrade || v.me?.engineer;
    if (needs) {
      const move = practiceBot(v, humanRng, humanProfile, humanMemory);
      if (move) {
        try {
          t.send(move, now);
        } catch (err) {
          console.error("human move rejected", err, move);
          break;
        }
        continue;
      }
    }
    const next = t.nextWakeAt();
    if (next === null) break;
    now = Math.max(now, next);
    t.advance(now);
  }
  if (t.fallbacks) console.error(`session ${session}: ${t.fallbacks} fallbacks`);
  if (opponents === 2) coverage.push(seenEarly.size);
}

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "-");
console.log("bot     hands  VPIP  PFR   WTSD  pow/hand  pow→fold  p95ms  maxms  streets");
for (const [name, st] of Object.entries(stats)) {
  if (!st.hands) continue;
  st.ms.sort((a, b) => a - b);
  const p95 = st.ms[Math.floor(st.ms.length * 0.95)] ?? 0;
  console.log(
    `${name.padEnd(7)} ${String(st.hands).padStart(5)}  ${pct(st.vpip, st.hands).padStart(4)}  ${pct(st.pfr, st.hands).padStart(4)}  ${pct(st.showdowns, st.hands).padStart(4)}  ${(st.powers / st.hands).toFixed(2).padStart(8)}  ${pct(st.powerThenFold, st.powers).padStart(8)}  ${p95.toFixed(1).padStart(5)}  ${(st.ms.at(-1) ?? 0).toFixed(1).padStart(5)}  ${JSON.stringify(st.byStreet)}`,
  );
}
const types: Record<string, number> = {};
for (const st of Object.values(stats)) for (const [k, v] of Object.entries(st.byType)) types[k] = (types[k] ?? 0) + v;
console.log("powers:", JSON.stringify(types));
if (coverage.length) console.log("powers the bots showed in the first 3 orbits of each 3-handed session:", coverage.join(" "));
