/**
 * First run, once.
 *
 * The claim is that these agents decide when to speak, and that what they want
 * is not what they say. Asserting that in a paragraph is cheap; showing a room
 * where someone stays quiet on purpose costs six beats and is the only version
 * anyone believes. So the hero is the scene, and the prose beside it is short
 * enough to read while it plays.
 */
import { useEffect, useState } from "react";
import { gestureEnergy } from "@perfectman/shared";
import { Figure } from "../stage/Figure.js";
import { INTRO_BEATS, INTRO_CAST } from "./intro-script.js";

export function Intro({ onDone }: { onDone: () => void }): JSX.Element {
  const [index, setIndex] = useState(0);
  const beat = INTRO_BEATS[index] ?? INTRO_BEATS[0]!;

  useEffect(() => {
    const timer = setTimeout(() => setIndex((i) => (i + 1) % INTRO_BEATS.length), beat.hold);
    return () => clearTimeout(timer);
  }, [index, beat.hold]);

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
          would cost to speak, and often decides against it. What you see below
          is the whole product: a line, and the reason behind it.
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

      <div className="intro__scene" aria-hidden="true">
        <div className="intro__cast">
          {INTRO_CAST.map((name, i) => (
            <Figure
              key={name}
              index={i}
              name={name}
              face={beat.faces[i] ?? "neutral"}
              energy={gestureEnergy(beat.emotions[i])}
              speaking={beat.actor === i && Boolean(beat.line)}
              attentive={beat.actor === i || !beat.thought}
            />
          ))}
        </div>

        <div className="intro__utterance">
          {beat.line ? (
            <p key={`line-${index}`} className="intro__line u-serif">
              <span className="intro__who">{INTRO_CAST[beat.actor]}</span>
              {beat.line}
            </p>
          ) : (
            <p key={`thought-${index}`} className="intro__thought u-hand">
              {beat.thought}
              <span className="intro__thought-note">
                {INTRO_CAST[beat.actor]} says nothing this turn
              </span>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
