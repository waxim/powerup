import { Pause, Play, Radar, RotateCcw, Trophy, Wrench, ChevronsUp, Coins } from "lucide-react";
import type { ReactNode } from "react";
import type { ClientMessage, TableView } from "../../shared/protocol";
import { PlayingCard } from "../components/PlayingCard";
import { chips, clock, ordinal } from "../lib/format";
import { navigate } from "../lib/router";

function Modal({ title, icon, children, tone }: { title: string; icon?: ReactNode; children: ReactNode; tone?: string }) {
  return (
    <div className="modal-backdrop">
      <div className={`modal ${tone ? `modal-${tone}` : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>
          {icon}
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

interface Props {
  view: TableView;
  send: (msg: ClientMessage) => void;
  serverNow: number;
  /** A practice game has its own end screen. */
  practice?: boolean;
}

/** Choices that interrupt play: power decisions, rebuys, pause and the final standings. */
export function Overlays({ view, send, serverNow, practice = false }: Props) {
  const me = view.me;
  const you = view.players.find((p) => p.isYou);
  const isHost = view.youId === view.hostId;

  if (view.status === "finished" && !practice) {
    const standings = [...view.players].sort((a, b) => (a.place ?? 99) - (b.place ?? 99));
    const winner = standings[0];
    return (
      <Modal title={winner?.isYou ? "You win!" : `${winner?.name} wins!`} icon={<Trophy size={24} aria-hidden />} tone="win">
        <ol className="standings">
          {standings.map((p) => (
            <li key={p.id} className={p.isYou ? "is-you" : ""}>
              <span className="standings-place">{p.place ? ordinal(p.place) : "–"}</span>
              <span className="standings-name">{p.name}</span>
              <span className="standings-meta">{p.rebuysUsed ? `${p.rebuysUsed} rebuy${p.rebuysUsed > 1 ? "s" : ""}` : ""}</span>
            </li>
          ))}
        </ol>
        <div className="modal-actions">
          {isHost ? (
            <button type="button" className="btn btn-primary" onClick={() => send({ t: "rematch" })}>
              <RotateCcw size={18} aria-hidden /> Rematch
            </button>
          ) : (
            <p className="muted small">Waiting for the host to start a rematch…</p>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => navigate("/")}>
            New table
          </button>
        </div>
      </Modal>
    );
  }

  if (me?.rebuy) {
    const left = me.rebuy.deadline - serverNow;
    return (
      <Modal title="Out of chips" icon={<Coins size={24} aria-hidden />}>
        <p>
          Buy back in for {chips(view.settings.startingChips)} chips?{" "}
          {me.rebuy.remaining === -1 ? "Rebuys are unlimited." : `You have ${me.rebuy.remaining} rebuy${me.rebuy.remaining === 1 ? "" : "s"} left.`}
        </p>
        <p className="muted small">Decide in {clock(left)} or you're out.</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={() => send({ t: "rebuy", accept: true })}>
            Rebuy
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => send({ t: "rebuy", accept: false })}>
            I'm out
          </button>
        </div>
      </Modal>
    );
  }

  if (me?.scanner) {
    return (
      <Modal title="Scanner" icon={<Radar size={22} aria-hidden />} tone="power">
        <p>The next two cards off the deck. Only you can see them. Discard one?</p>
        <div className="choice-cards">
          {me.scanner.map((c, i) => (
            <div key={c} className="choice">
              <span className="choice-label">{i === 0 ? "Next" : "After that"}</span>
              <PlayingCard card={c} size="lg" />
              <button type="button" className="btn btn-danger" onClick={() => send({ t: "choose", index: i })}>
                Discard
              </button>
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={() => send({ t: "choose", index: null })}>
            Keep both
          </button>
        </div>
      </Modal>
    );
  }

  if (me?.upgrade) {
    return (
      <Modal title="Upgrade" icon={<ChevronsUp size={22} aria-hidden />} tone="power">
        <p>Tap the card you want to throw away.</p>
        <div className="choice-cards">
          {me.hole.map((c, i) => (
            <PlayingCard key={c.card} card={c.card} size="lg" exposed={c.exposed} selectable onClick={() => send({ t: "choose", index: i })} label={i === 2 ? "new" : undefined} />
          ))}
        </div>
      </Modal>
    );
  }

  if (me?.engineer) {
    return (
      <Modal title="Engineer" icon={<Wrench size={22} aria-hidden />} tone="power">
        <p>Pick the next card off the deck. Everyone can see these three; the other two are discarded.</p>
        <div className="choice-cards">
          {me.engineer.map((c, i) => (
            <PlayingCard key={c} card={c} size="lg" selectable onClick={() => send({ t: "choose", index: i })} />
          ))}
        </div>
      </Modal>
    );
  }

  if (view.paused) {
    const hostHere = view.players.some((p) => p.isHost && p.connected);
    const canResume = isHost || ((view.autoPaused || !hostHere) && !!you);
    return (
      <Modal title="Paused" icon={<Pause size={22} aria-hidden />}>
        <p>
          {practice
            ? "The clock is stopped."
            : view.autoPaused
              ? "Everyone left, so the game paused itself."
              : hostHere
                ? "The host has paused the game. The clock is stopped."
                : "The host paused the game and has gone offline. Anyone can resume."}
        </p>
        {canResume && (
          <div className="modal-actions">
            <button type="button" className="btn btn-primary" onClick={() => send({ t: "resume" })}>
              <Play size={18} aria-hidden /> Resume
            </button>
          </div>
        )}
      </Modal>
    );
  }

  return null;
}
