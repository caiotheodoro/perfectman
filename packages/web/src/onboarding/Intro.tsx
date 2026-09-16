/** Six authored moments, rendered and played by the same components as a run. */
import { useMemo, useState } from "react";
import { idlePlacement, placeBeats } from "@perfectman/shared";
import { BrandMark } from "../design/Shell.js";
import { Attribution } from "../stage/Attribution.js";
import { ContactSheet } from "../stage/ContactSheet.js";
import { frameFor, frameLabel } from "../stage/Frame.js";
import { Panel } from "../stage/Panel.js";
import { useStageClock } from "../stage/useStageClock.js";
import { useDocumentVisible, useReadingPosition } from "../stage/motion.js";
import { RoomBuilder } from "./RoomBuilder.js";
import type { RoomFiles } from "./room-draft.js";
import { introRun } from "./intro-script.js";

export function Intro({ onDone, onCreate }: { onDone: () => void; onCreate?: (files: RoomFiles) => void }): JSX.Element {
  const [creating, setCreating] = useState(false);
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
  const clock = useStageClock(run.beats, { ready: visible && !creating });
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

  if (creating) return <RoomBuilder onBack={() => setCreating(false)} onCreate={files => { onCreate?.(files); onDone(); }} />;

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
              AI characters have different feelings and private goals.<br />
              Explore a short example, then make a simulation of your own.
            </p>
          </div>
          <div className="intro__choices">
            <button type="button" className="btn" onClick={() => { clock.seek(0); clock.play(); reading.reveal(); }}>Watch the demo</button>
            <button type="button" className="btn btn--quiet" onClick={() => { clock.pause(); setCreating(true); }}>Create your own</button>
            <button type="button" className="btn--bare" onClick={onDone}>Browse casts and scenes</button>
            <p className="u-dim">Demo: no account or key. Your own run: connect a model.</p>
          </div>
        </div>

        <nav className="intro__guide" aria-label="Explore the demo">
          {[
            { index: 0, title: "What they say", text: "Public messages are heard by the room." },
            { index: 2, title: "What they keep private", text: "You can see a thought that the other characters cannot." },
            { index: 5, title: "What they really feel", text: "A friendly reply can hide a very different feeling." },
          ].map(moment => <button key={moment.index} type="button" aria-pressed={clock.index >= moment.index && clock.index < (moment.index === 0 ? 2 : moment.index === 2 ? 5 : 6)}
            onClick={() => { clock.pause(); clock.seek(moment.index); reading.reveal(); }}>
            <strong>{moment.title}</strong><span>{moment.text}</span>
          </button>)}
        </nav>
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
            <p className="intro__provenance">Scripted demo · no model connected. Your own run is generated live.</p>
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
