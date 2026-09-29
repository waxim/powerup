import { Eye, Zap } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Card } from "../../shared/cards";
import type { LogEntry } from "../../shared/protocol";
import { chips } from "../lib/format";
import { sfx } from "../lib/sfx";
import { getPref, setPref } from "../lib/storage";
import { useTicker, type TableConnection } from "../lib/useTable";
import { Announcer } from "./Announcer";
import { Center } from "./Center";
import { seatGeometry } from "./layout";
import { LogPanel } from "./LogPanel";
import { MyPanel, type PowerSelection } from "./MyPanel";
import { Overlays } from "./Overlays";
import { Seat } from "./Seat";
import { TopBar, type PracticeControls } from "./TopBar";

interface Props {
  conn: TableConnection;
  /** Set for a practice game against bots: changes the menu (no invite links) and the labels. */
  practice?: PracticeControls;
  /** Extra content between the table and your controls (practice tips). */
  belowTable?: ReactNode;
  /** Extra overlay content (practice end-of-session card). */
  overlay?: ReactNode;
}

export function GameTable({ conn, practice, belowTable, overlay }: Props) {
  const v = conn.view!;
  const { send } = conn;
  useTicker(200);
  const now = conn.serverNow();
  const me = v.me;
  const you = v.players.find((p) => p.isYou) ?? null;
  const h = v.hand;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadPick, setReloadPick] = useState<number[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [fourColor, setFourColorState] = useState(() => getPref("fourColor", true));
  const [sound, setSoundState] = useState(() => getPref("sound", true));

  const setFourColor = (value: boolean) => {
    setPref("fourColor", value);
    setFourColorState(value);
  };
  const setSound = (value: boolean) => {
    setPref("sound", value);
    setSoundState(value);
    if (value) sfx.unlock();
  };

  useEffect(() => {
    document.body.classList.toggle("four-color", fourColor);
  }, [fourColor]);

  // Drop any half-made power choice when the decision point changes.
  const myTurn = !!me?.legal;
  useEffect(() => {
    setSelectedId(null);
    setReloadPick([]);
  }, [h?.number, h?.street, myTurn]);

  const selected = me?.powers.find((p) => p.id === selectedId && p.playable) ?? null;
  const power: PowerSelection = {
    selected,
    select: (id) => {
      setSelectedId(id);
      setReloadPick([]);
    },
    reloadPick,
    toggleReload: (i) => setReloadPick((pick) => (pick.includes(i) ? pick.filter((x) => x !== i) : [...pick, i].slice(-2))),
  };

  // Sounds: your turn, powers, wins.
  const prevTurn = useRef(false);
  useEffect(() => {
    if (myTurn && !prevTurn.current && sound) sfx.yourTurn();
    prevTurn.current = myTurn;
  }, [myTurn, sound]);
  const onNewLog = useCallback(
    (entries: LogEntry[]) => {
      if (!sound) return;
      if (entries.some((e) => e.kind === "power" && e.playerId !== v.youId)) sfx.power();
      else if (entries.some((e) => e.kind === "win" && e.playerId === v.youId)) sfx.win();
    },
    [sound, v.youId],
  );

  // You at the bottom, everyone else clockwise.
  const seated = useMemo(() => [...v.players].sort((a, b) => a.seat - b.seat), [v.players]);
  const youIndex = seated.findIndex((p) => p.isYou);
  const ordered = youIndex > 0 ? [...seated.slice(youIndex), ...seated.slice(0, youIndex)] : seated;

  const turnMs = v.settings.turnSeconds * 1000;
  const timeLeftFor = (playerId: string): number | null => {
    if (!h || h.toAct !== playerId || h.turnDeadline === null) return null;
    return Math.max(0, Math.min(1, (h.turnDeadline - now) / turnMs));
  };

  // Highlight the winning five cards at showdown.
  const winningCards: Card[] | null = useMemo(() => {
    if (!h || h.phase !== "done") return null;
    const cards = v.players.filter((p) => p.won > 0 && p.bestCards).flatMap((p) => p.bestCards!);
    return cards.length ? cards : null;
  }, [h, v.players]);

  const targets = selected?.type === "disintegrate" ? h?.board.flatMap((b, i) => (b.current && !b.locked ? [i] : [])) ?? [] : null;

  return (
    <div className="game" onPointerDown={sound ? sfx.unlock : undefined}>
      <TopBar
        view={v}
        send={send}
        serverNow={now}
        fourColor={fourColor}
        setFourColor={setFourColor}
        sound={sound}
        setSound={setSound}
        onToggleLog={() => setLogOpen((o) => !o)}
        practice={practice}
      />
      {!you && (
        <div className="banner banner-info">
          <Eye size={16} aria-hidden /> You're watching. Seats lock once a game starts.
        </div>
      )}
      {you?.away && v.status === "running" && (
        <div className="banner banner-warn">
          You ran out of time and are sitting out.
          <button type="button" className="btn btn-primary btn-small" onClick={() => send({ t: "back" })}>
            I'm back
          </button>
        </div>
      )}
      <div className="game-main">
        <div className={`table-area seats-${ordered.length}`}>
          <div className={`felt ${h?.empBy ? "is-emp" : ""}`} aria-hidden />
          {ordered.map((p, i) => {
            const geo = seatGeometry(ordered.length, i);
            return (
              <div key={p.id} className="seat-slot">
                <Seat player={p} style={geo.seat as CSSProperties} timeLeft={timeLeftFor(p.id)} winningCards={winningCards} />
                {p.streetBet > 0 && h?.phase !== "done" && (
                  <div className="bet" style={geo.bet as CSSProperties}>
                    <span className="chip-stack" aria-hidden />
                    {chips(p.streetBet)}
                  </div>
                )}
              </div>
            );
          })}
          <Center view={v} targets={targets} onTarget={(i) => {
            if (!selected) return;
            send({ t: "power", powerId: selected.id, target: i });
            setSelectedId(null);
          }} winningCards={winningCards} />
          <Announcer log={v.log} onNew={onNewLog} />
        </div>
        <aside className={logOpen ? "side is-open" : "side"}>
          <LogPanel log={v.log} onClose={() => setLogOpen(false)} />
        </aside>
      </div>
      {belowTable}
      {me && you ? (
        <MyPanel view={v} send={send} power={power} timeLeft={timeLeftFor(you.id)} winningCards={winningCards} />
      ) : (
        <div className="mypanel mypanel-spectator">
          <Zap size={16} aria-hidden /> Spectating · {v.players.filter((p) => p.status === "playing").length} players left
        </div>
      )}
      <Overlays view={v} send={send} serverNow={now} />
      {overlay}
    </div>
  );
}
