/**
 * The landing page: a film first, then one way in.
 *
 * The film is scripted (see `packages/shared/src/demo`) and drawn by the same
 * director that draws a real run, so nothing here is a mock-up of the product.
 * Out loud the characters are having an ordinary evening; flip the switch and
 * you read what they are actually thinking. That gap is the whole idea.
 */
import { useMemo, useState } from "react";
import { surpriseParty } from "@perfectman/shared";
import { BrandMark } from "../design/Shell.js";
import { FilmPlayer } from "../watch/FilmPlayer.js";

export type Starter = { id: string; title: string };
/** What the visitor already told us, so the next screen starts filled in. */
export type StartChoice = { story?: string; presetId?: string };

export function Intro({ starters, onStart, onWatch, liveRun, onWatchLive }: {
  starters: readonly Starter[];
  onStart: (choice: StartChoice) => void;
  onWatch?: () => void;
  /** A run is going on the server right now. */
  liveRun?: { pulsesRun: number; maxPulses: number } | null;
  onWatchLive?: () => void;
}): JSX.Element {
  const replay = useMemo(surpriseParty, []);
  const [story, setStory] = useState("");
  const picks = starters.slice(0, 3);
  const surprise = (): void => {
    const pick = starters[Math.floor(Math.random() * starters.length)];
    onStart(pick ? { presetId: pick.id } : {});
  };

  return (
    <div className="intro-shell">
      <header className="shell__bar intro__bar">
        <BrandMark />
        <span className="intro__links">
          {liveRun && onWatchLive ? (
            <button type="button" className="btn shell__live" onClick={onWatchLive}>
              <span className="shell__dot" aria-hidden="true" />Watch the run in progress{liveRun.maxPulses > 0 ? ` · ${liveRun.pulsesRun} of ${liveRun.maxPulses}` : ""}
            </button>
          ) : null}
          {onWatch ? <button type="button" className="btn--bare" onClick={onWatch}>Watch a past run</button> : null}
        </span>
      </header>
      <main className="landing">
        <div className="landing__head">
          <h1>Nobody says everything.</h1>
          <p className="landing__lede">
            Put a few AI characters in a room. Each one wants something and has a reason to keep quiet about it.
            You watch what they say, and read what they don’t.
          </p>
        </div>

        <section className="landing__film" aria-label="Demo film">
          <FilmPlayer replay={replay} title={replay.simulationName} variant="hero" autoplay loop pace="fast" />
          <p className="landing__provenance u-dim">A scripted demo, drawn by the same engine as a real run. No model, no account.</p>
        </section>

        <div className="landing__start">
          <form onSubmit={(event) => { event.preventDefault(); onStart(story.trim() ? { story: story.trim() } : {}); }}>
            <label htmlFor="landing-story">What is going on in the room?</label>
            <div className="landing__row">
              <input
                id="landing-story" value={story} maxLength={300} autoComplete="off"
                placeholder="Three flatmates and one leaked screenshot"
                onChange={(event) => setStory(event.target.value)}
              />
              <button type="submit" className="btn">Start a room</button>
            </div>
          </form>
          <p className="landing__starters">
            <span className="u-dim">Or begin with</span>
            {picks.map((s) => <button key={s.id} type="button" className="chip" onClick={() => onStart({ presetId: s.id })}>{s.title}</button>)}
            {starters.length > 0 ? <button type="button" className="chip chip--wild" onClick={surprise}>Surprise me</button> : null}
          </p>
        </div>
      </main>
    </div>
  );
}
