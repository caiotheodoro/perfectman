/** Six authored moments, rendered and played by the same components as a run. */
import { useMemo } from "react";
import { idlePlacement, placeBeats } from "@perfectman/shared";
import { BrandMark } from "../design/Shell.js";
import { Attribution } from "../stage/Attribution.js";
import { ContactSheet } from "../stage/ContactSheet.js";
import { frameFor, frameLabel } from "../stage/Frame.js";
import { Panel } from "../stage/Panel.js";
import { useStageClock } from "../stage/useStageClock.js";
import { useDocumentVisible, useReadingPosition } from "../stage/motion.js";
import { introRun } from "./intro-script.js";

export function Intro({ onDone }: { onDone: () => void }): JSX.Element {
  const run = useMemo(introRun, []);
  const staged = useMemo(() => {
    const ids = run.agents.map((a) => a.id);
    const idle = idlePlacement(run.channels[0], run.agents);
    const placements = placeBeats(run.beats, run.agents, run.channels, { seed: idle });
    return {
      ids,
      placements,
      frames: run.beats.map((beat, i) => frameFor(beat, placements[i]!, ids)),
      labels: run.beats.map((beat, i) => `Beat ${i + 1}: ${frameLabel(beat, run.agents, run.channels[0])}`),
    };
  }, [run]);
  const visible = useDocumentVisible();
  const clock = useStageClock(run.beats, { ready: visible });
  const beat = clock.beat!;
  const reading = useReadingPosition(visible ? beat.id : undefined);

  function togglePlay(): void {
    if (clock.atEnd) {
      clock.seek(0);
      clock.play();
      reading.reveal();
    } else if (clock.playing) clock.pause();
    else { clock.play(); reading.reveal(); }
  }

  return (
    <div className="intro-shell">
      <header className="shell__bar intro__bar">
        <BrandMark />
        <span className="intro__about">An AI social simulation</span>
      </header>
      <main className="intro">
        <div className="intro__words">
          <div className="intro__premise">
            <h1>Nobody says everything.</h1>
            <p className="intro__lede">
              Three AI agents. One awkward conversation.<br />
              Watch what they say. See what they keep to themselves.
            </p>
          </div>
          <button type="button" className="btn intro__start" aria-label="Build a room" onClick={onDone}>
            Build a room
          </button>
        </div>

        <section className="intro__scene flipbook" aria-label="Authored preview" ref={reading.ref}>
          <Panel
            beat={beat}
            placement={staged.placements[clock.index]!}
            index={clock.index}
            playing={visible && clock.playing && !clock.atEnd}
            agents={run.agents}
            channels={run.channels}
            ids={staged.ids}
          />
          <div className="intro__caption">
            <Attribution beat={beat} agents={run.agents} channels={run.channels} ids={staged.ids} />
            <p className="intro__provenance">Authored preview · no model connected</p>
          </div>
          <div className="intro__playback">
            <div className="intro__controls" role="group" aria-label="Preview playback">
              <button
                type="button" className="btn btn--quiet intro__step"
                aria-label="Previous beat" disabled={clock.index === 0} onClick={() => { clock.step(-1); reading.reveal(); }}
              >
                <span aria-hidden="true">←</span>
              </button>
              <button
                type="button" className="btn intro__play"
                aria-label={clock.atEnd ? "Replay preview" : clock.playing ? "Pause preview" : "Play preview"}
                onClick={togglePlay}
              >
                {clock.atEnd ? "Replay" : clock.playing ? "Pause" : "Play"}
              </button>
              <button
                type="button" className="btn btn--quiet intro__step"
                aria-label="Next beat" disabled={clock.atEnd} onClick={() => { clock.step(1); reading.reveal(); }}
              >
                <span aria-hidden="true">→</span>
              </button>
              <span className="intro__position" aria-label={`Beat ${clock.index + 1} of ${run.beats.length}`}>
                {clock.index + 1} / {run.beats.length}
              </span>
            </div>
            <ContactSheet
              frames={staged.frames}
              labels={staged.labels}
              index={clock.index}
              reached={clock.reached}
              live={false}
              onSeek={(index) => { clock.pause(); clock.seek(index); reading.reveal(); }}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
