/**
 * The page the room is drawn on.
 *
 * A change of room is a page turning. The page that is leaving stays mounted
 * for the length of the turn, still drawing the beat it was on, and the new
 * room comes in behind it — forwards when the run moves on, backwards when
 * the reader seeks back. Two lines in the same room are not a turn; the room
 * just updates, and the balloon and faces do their own transitions.
 *
 * This is deliberately not the View Transitions API: that snapshots the whole
 * document, so the breathing figures and the sheet's scroll would freeze for
 * the turn, and it cannot be tested in jsdom. Two keyed pages and a timer can.
 */
import { useEffect, useRef, useState } from "react";
import type { LiveChannel, Placement, StageBeat } from "@perfectman/shared";
import { reducedMotion } from "./motion.js";
import { Stage, type StageAgent } from "./Stage.js";

/** Mirrors `--turn` in tokens.css. */
export const TURN_MS = 520;

type Direction = "forward" | "back";

type Page = {
  roomKey: string;
  index: number;
  beat: StageBeat | undefined;
  placement: Placement;
};

export function Panel({
  beat,
  placement,
  index,
  agents,
  channels,
  ids,
}: {
  beat: StageBeat | undefined;
  placement: Placement;
  /** Position in the run, so a turn knows which way to go. */
  index: number;
  agents: readonly StageAgent[];
  channels: readonly LiveChannel[];
  ids: readonly string[];
}): JSX.Element {
  const current: Page = { roomKey: placement.roomKey, index, beat, placement };
  // What was on the page last render. A ref, not state: it is a memo of the
  // previous picture, and writing it must not cause a render of its own.
  const last = useRef<Page>(current);
  const direction = useRef<Direction>("forward");
  const [leaving, setLeaving] = useState<(Page & { dir: Direction }) | null>(null);

  if (last.current.roomKey !== current.roomKey) {
    const dir: Direction = index >= last.current.index ? "forward" : "back";
    direction.current = dir;
    // Setting state during render is how React wants a derived reset done: it
    // re-renders this component at once, before any child is committed.
    if (!reducedMotion()) setLeaving({ ...last.current, dir });
  }
  last.current = current;

  // A timer rather than `animationend`: the room's own children animate too and
  // their end events bubble, and a page can be replaced before its turn ends.
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setLeaving(null), TURN_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <div className="panel">
      {leaving ? (
        <div key={leaving.roomKey} className={`panel__page panel__page--leave-${leaving.dir}`} aria-hidden="true">
          <Stage beat={leaving.beat} placement={leaving.placement} agents={agents} channels={channels} ids={ids} />
        </div>
      ) : null}
      <div key={current.roomKey} className={`panel__page panel__page--enter-${direction.current}`}>
        <Stage beat={beat} placement={placement} agents={agents} channels={channels} ids={ids} />
      </div>
    </div>
  );
}
