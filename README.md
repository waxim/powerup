# PowerUp ⚡

Texas hold'em with game-changing powers: a fan-made recreation of PokerStars' **Power Up**, built for
friends. Create a table, share the link, and everyone joins with just a name. No accounts, no downloads,
play money only.

Runs entirely on Cloudflare: a Worker serves the app and each table lives in its own Durable Object.

<p align="center">
  <img src="docs/table-mobile.jpg" alt="A six-player Double game on a phone" width="300" />
  &nbsp;
  <img src="docs/showdown-desktop.jpg" alt="A showdown on desktop" width="520" />
</p>

## How it works for players

1. **Create a table.** Pick your name, seats (2–6), starting chips, starting blinds, how often blinds go up,
   rebuys per player, time to act and (optionally) which powers are in play.
2. **Share the link** (`https://your-domain/t/<table-id>`). Friends open it, type a name and take a seat.
3. **The host presses Start.** Seats lock; anyone else with the link can watch.
4. Play until one player has all the chips. Busted players can rebuy while they have rebuys left.
   The host can pause, and can start a rematch with the same players at the end.

Your seat is remembered in your browser. To move to another device, use **Menu → Copy my seat link**.

## Try it against bots

New to Power Up? Open **`/try`** (or "Try it against bots" on the home page) to play a few orbits against
computer players before your first real game. It runs entirely in your browser: no table is created and
nothing is sent to the server.

- **Pick 1–5 opponents and 2, 3 or 5 orbits.** Four or more players gets you the Double game. Stacks are
  1,500 at 10/20 with blinds rising every 4 minutes, and rebuys are free.
- **Meet every power.** Your first hand holds X-Ray, Reload and Deploy. Each power you use is replaced by
  one you haven't held yet, so a few orbits introduce all ten. Only the power types are chosen for you;
  the cards are never rigged, and the bots are dealt normally.
- **Tips as things happen.** A short tip explains each power the first time you pick it up or a bot plays
  it, plus your first turn, the flop, showdowns, the all-in shield and more. Tap **Hint** on your turn for
  the coach's view (your odds, the price of a call, a power worth trying), or open the **cheat sheet** for
  all the powers and the hand rankings.
- **Nothing runs while you're away.** The game clock stops while you read a tip, while the tab is hidden
  and while your phone sleeps, so you never time out mid-read.
- **Bots with personalities.** Pixel loves a power, Bolt bluffs, Echo likes to see flops, Nova is solid
  and Vega waits for a big pot. They play position-aware preflop ranges, bet from simulated equity, use
  powers when the chips they expect to gain outweigh the energy spent, and only ever see what a player in
  their seat would. They take it easy for the first two hands.
- **At the end**, a summary shows your chips, best hand, biggest pot and which powers you've tried, with
  buttons to keep playing, play again or create a real table.

## Rules

PowerUp is no-limit hold'em: two hole cards, flop, turn, river, best five-card hand wins. It's a sit & go
tournament. Everyone starts with the same stack, blinds rise on a timer, and the last player with chips wins.

On top of that everyone holds **powers**, following the official PokerStars guide:

- You start with **10 energy** and gain **+2 at the start of every hand**, up to a maximum (15 classic / 20 double).
- You hold **3 different powers** (4 in a Double game). Used powers are replaced at the start of the next
  hand. You never hold duplicates, except by using Clone.
- Powers are played **on your turn, before you bet**. You can play several in one turn if you have the energy.
- **All-in shield:** when anyone goes all-in, every card already on the board is locked (shown in red) and
  can't be targeted by powers.

| Power | Cost (classic / double) | Effect |
| --- | --- | --- |
| X-Ray | 2 / 4 | Every opponent in the hand exposes one random hole card to the whole table. |
| Upgrade | 5 | Draw a third hole card, then discard one. |
| Scanner | 4 | Privately see the top two cards of the deck; you may discard one. Opponents see whether you discarded, not which. |
| Reload | 5 | Swap one or both of your hole cards for new ones. |
| Intel | 3 | See the top card of the deck for the rest of the hand. |
| Engineer | 5 | The next three cards are shown to everyone. You choose which comes next; the other two are discarded. |
| EMP | 3 / 4 | Opponents can't play powers for the rest of this street. You still can. |
| Disintegrate | 4 | Destroy a board card dealt this street; the top card of the deck replaces it. |
| Clone | 2 | Get a copy of the last power played this hand. |
| Deploy | 3 / 2 | Add the top card of the deck to the board as an extra community card (max two per hand). |

Deploy was added to the live game after the original nine; the host can switch any power off when creating a table.

### The Double game (4–6 players)

The original is strictly three-handed. With twice as many opponents, tables that **start with 4–6 players**
use rebalanced rules:

- **4 powers** in hand and a **20 energy** cap, so there's room to combo in bigger pots.
- **X-Ray costs 4.** It can reveal up to five hands, not two.
- **EMP costs 4 and is dealt half as often.** It silences up to five players at once.
- **Deploy costs 2.** The extra card now helps more opponents, so it's worth less to you.

A card-drawing power can't be played if it would leave too few cards to finish the board, so the deck
never runs dry even at six-handed with every power flying.

## Tech

```
Browser (React SPA) ──WebSocket──▶ Worker ──▶ Durable Object "PowerUpTable" (one per table)
                      POST /api/tables          ├─ game engine (pure TypeScript)
                                                ├─ SQLite-backed storage (table state)
                                                └─ alarms (turn clock, runouts, next hand, cleanup)
```

- **`src/engine/`**: the complete game as a deterministic, pure TypeScript state machine: NLHE betting
  (incomplete all-in raises, side pots, odd chips, uncalled bets), blind levels, busts/rebuys/placements,
  timeouts, and all ten powers. `view.ts` builds each player's personalised view, which is the only thing sent
  to browsers, so hidden cards, the deck and seat tokens never leave the server.
- **`src/worker/`**: the Worker routes (`POST /api/tables`, `GET /api/tables/:id/ws`) and the
  `PowerUpTable` Durable Object. It uses hibernatable WebSockets (idle tables cost nothing), persists state
  after every change, rolls back on errors, pauses a game when everyone has left, and deletes tables idle
  for 3 days.
- **`src/client/`**: React UI (Vite), mobile-first, with self-hosted fonts (SIL OFL).
- **`src/client/practice/`**: the Try mode, lazy-loaded so the main bundle doesn't carry the engine.
  `LocalTable` runs the same engine, message dispatch and views as a real table, stepping timers and bot
  moves one event at a time in virtual time. `PracticeRunner` drives it from the browser, and `bot.ts` is the
  bot brain: preflop tables, Monte Carlo "worlds" shared across options, and per-power valuations.
- Accountless identity: joining returns a random seat token stored in `localStorage`. Whoever holds the
  token owns the seat.

## Development

```sh
npm install
npm run dev          # Vite + the Worker/Durable Object running locally in workerd → http://localhost:5173
npm test             # engine, practice driver and bot tests, including randomised full games
npm run typecheck
npm run check:bundle # build, then check the practice mode stays out of the main bundle
node scripts/bots.ts --players 6   # bots play a full game against the dev server

# Tune the practice bots: plays bot-only sessions and prints how often they play, raise and use powers
npx esbuild scripts/practice-sim.ts --bundle --platform=node --format=esm --outfile=/tmp/sim.mjs && node /tmp/sim.mjs
```

## Deploying to Cloudflare

Durable Objects with SQLite storage are available on the Workers **Free** plan, so no paid plan is needed.
The Free plan allows 100,000 Durable Object row writes per day. A table writes roughly once per action, so
that's plenty of home games a day; the Workers Paid plan lifts the limit if you ever need it.

**From your machine**

```sh
npx wrangler login
npm run deploy       # builds, then `wrangler deploy`
```

Wrangler prints your URL (`https://powerup.<your-subdomain>.workers.dev`). Add a custom domain under
*Workers & Pages → powerup → Settings → Domains & Routes*.

**Or from GitHub (Workers Builds)**: in the Cloudflare dashboard go to *Workers & Pages → Create →
Import a repository* and pick this repo. The defaults work as-is: `npx wrangler deploy` runs the build
itself (see `build.command` in `wrangler.jsonc`). You can also set the build command to `npm run build`
explicitly; either way works. Every push to the production branch then deploys automatically.

## Credits

A fan-made recreation of PokerStars' Power Up for private games with friends. Not affiliated with or endorsed
by PokerStars. No real money is involved. Fonts: Orbitron (The Orbitron Project Authors) and Rajdhani
(Indian Type Foundry), both under the SIL Open Font License.
