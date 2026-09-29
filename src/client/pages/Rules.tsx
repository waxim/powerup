import { Bot, ChevronLeft, Shield } from "lucide-react";
import { MAX_DEPLOYS_PER_HAND, MODE_RULES, POWERS, POWER_TYPES } from "../../shared/powers";
import { HandRankings } from "../components/HandRankings";
import { PowerIcon } from "../components/PowerCard";
import { TryLink } from "../components/TryLink";
import { linkHandler } from "../lib/router";
import { Logo } from "./Home";

export function Rules() {
  const c = MODE_RULES.classic;
  const d = MODE_RULES.double;
  return (
    <div className="page rules">
      <header className="lobby-head">
        <a href="/" onClick={linkHandler("/")} className="btn btn-ghost">
          <ChevronLeft size={18} aria-hidden /> Back
        </a>
        <Logo small />
      </header>

      <section className="panel-card prose">
        <h1>How to play</h1>
        <p>
          PowerUp is no-limit Texas hold'em with a twist. You get two hole cards, then a flop, turn and river as usual, and the best
          five-card hand wins. On top of that, every player holds <strong>powers</strong> that can bend the hand: peek at the deck,
          rebuild your hand, rip cards off the board.
        </p>
        <p>
          <TryLink className="btn btn-primary">
            <Bot size={18} aria-hidden /> Try a practice game against bots
          </TryLink>
        </p>
        <h2>The table</h2>
        <ul>
          <li>The host creates a table and shares the link. Players join with a name, no account needed.</li>
          <li>It's a sit &amp; go tournament: everyone starts with the same stack and the blinds rise on a timer. Last player with chips wins.</li>
          <li>If you bust and the table allows rebuys, you can buy back in for a fresh starting stack.</li>
          <li>Seats lock when the host starts the game. Anyone else with the link can watch.</li>
        </ul>
        <h2>Energy and powers</h2>
        <ul>
          <li>
            You start with {c.startEnergy} energy and gain {c.energyPerHand} more at the start of every hand, up to {c.maxEnergy}.
          </li>
          <li>
            You hold {c.handSize} different powers. Each one you play is replaced at the start of the next hand, so you always start a
            hand with a full set. You never hold two of the same, unless you Clone one.
          </li>
          <li>Play powers on your turn, before you bet. You can play several in one turn if you have the energy.</li>
          <li>
            Disintegrate can only target cards dealt on the <em>current</em> betting round. A deployed card counts as dealt when it
            lands.
          </li>
          <li>
            <Shield size={16} className="inline-icon" aria-hidden /> <strong>All-in shield:</strong> when anyone goes all-in, every
            card already on the board is locked (shown in red) and can't be targeted by powers.
          </li>
        </ul>

        <h2>The powers</h2>
        <div className="rules-powers">
          {POWER_TYPES.map((t) => {
            const p = POWERS[t];
            return (
              <article key={t} className="rules-power" style={{ ["--power" as string]: p.color }}>
                <header>
                  <span className="rules-power-icon">
                    <PowerIcon type={t} size={22} />
                  </span>
                  <h3>{p.name}</h3>
                  <span className="rules-cost" title="Energy cost (classic / double game)">
                    {p.cost.classic}
                    {p.cost.double !== p.cost.classic && <small> / {p.cost.double}</small>}⚡
                  </span>
                </header>
                <p>{p.rules}</p>
              </article>
            );
          })}
        </div>

        <h2>Hand rankings</h2>
        <p>Best to worst. You make the best five-card hand you can from your two cards and the board.</p>
        <HandRankings />

        <h2>The Double game (4 to 6 players)</h2>
        <p>
          The original Power Up is three-handed. With twice the opponents, some powers hit twice as hard, so tables that start with
          four or more players use Double game rules:
        </p>
        <table className="rules-table">
          <thead>
            <tr>
              <th />
              <th>Classic (2–3)</th>
              <th>Double (4–6)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Powers in hand</td>
              <td>{c.handSize}</td>
              <td>{d.handSize}</td>
            </tr>
            <tr>
              <td>Energy cap</td>
              <td>{c.maxEnergy}</td>
              <td>{d.maxEnergy}</td>
            </tr>
            <tr>
              <td>X-Ray</td>
              <td>{POWERS.xray.cost.classic}⚡</td>
              <td>{POWERS.xray.cost.double}⚡ (reveals up to five hands)</td>
            </tr>
            <tr>
              <td>EMP</td>
              <td>{POWERS.emp.cost.classic}⚡</td>
              <td>{POWERS.emp.cost.double}⚡ and dealt half as often (it silences up to five players)</td>
            </tr>
            <tr>
              <td>Deploy</td>
              <td>{POWERS.deploy.cost.classic}⚡</td>
              <td>{POWERS.deploy.cost.double}⚡ (the extra card helps more opponents)</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">
          At most {MAX_DEPLOYS_PER_HAND} cards can be deployed per hand. A card-drawing power can't be played if the deck would be left
          too thin to finish the board.
        </p>
      </section>
    </div>
  );
}
