/**
 * First run, once.
 *
 * The claim is that these agents decide when to speak, and that what they want
 * is not what they say. Asserting that in a paragraph is cheap; showing a room
 * where someone stays quiet on purpose costs six beats and is the only version
 * anyone believes. So the hero is the scene, played through the very page a
 * run plays on — the same room and caption — and the prose beside it is short
 * enough to read while it plays.
 */
import { useEffect, useMemo, useState } from "react";
import { idlePlacement, placeBeats } from "@perfectman/shared";
import { Attribution } from "../stage/Attribution.js";
import { Panel } from "../stage/Panel.js";
import { introRun } from "./intro-script.js";

export function Intro({ onDone }: { onDone: () => void }): JSX.Element {
  const run = useMemo(introRun, []);
  const staged = useMemo(() => {
    const ids = run.agents.map((a) => a.id);
    const idle = idlePlacement(run.channels[0], run.agents);
    return { ids, placements: placeBeats(run.beats, run.agents, run.channels, { seed: idle }) };
  }, [run]);

  const [index, setIndex] = useState(0);
  const beat = run.beats[index] ?? run.beats[0]!;

  // Loops, the way it always did.
  useEffect(() => {
    const timer = setTimeout(() => setIndex((i) => (i + 1) % run.beats.length), beat.duration * 1000);
    return () => clearTimeout(timer);
  }, [index, beat.duration, run.beats.length]);

  return (
    <main className="intro">
      <div className="intro__words">
        <h1>
          Three people in a room.
          <br />
          One is not saying what they want.
        </h1>
        <p className="intro__lede u-serif">
          Nobody here takes turns. Each character reads the room, weighs what it
          would cost to speak, and often decides against it. The scene beside
          this is the whole product: a line, and the reason behind it.
        </p>
        <div className="intro__actions">
          <button type="button" className="btn" onClick={onDone}>
            Build a room
          </button>
          <button type="button" className="btn--bare" onClick={onDone}>
            Skip
          </button>
        </div>
      </div>

      <div className="intro__scene flipbook">
        <Panel
          beat={beat}
          placement={staged.placements[index] ?? staged.placements[0]!}
          index={index}
          agents={run.agents}
          channels={run.channels}
          ids={staged.ids}
        />
        <Attribution beat={beat} agents={run.agents} channels={run.channels} ids={staged.ids} />
      </div>
    </main>
  );
}
