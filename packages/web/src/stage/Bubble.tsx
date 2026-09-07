/**
 * One balloon. Speech is paper with a hard tail; a thought is a soft cloud with
 * a trail of dots, in italic. Never both at once — that pairing does not fit
 * above a figure at the back of the room, and a thought reads better as its
 * own moment anyway.
 */
import type { RefObject } from "react";
import { useBubbleAnchor } from "./useBubbleAnchor.js";

export function Bubble({
  speaker,
  headTopGuess,
  x,
  contentKey,
  said,
  thought,
}: {
  /** The speaker's mark, measured for where the head really is. */
  speaker: RefObject<HTMLElement>;
  /** Fraction from the room's top, used until the mark has been laid out. */
  headTopGuess: number;
  x: number;
  contentKey: string;
  said: string;
  thought?: string;
}): JSX.Element {
  const { ref, bottom } = useBubbleAnchor(speaker, headTopGuess, contentKey);
  // Balloons open away from the nearest wall, so an edge figure's does not run
  // off the side of the room.
  const side = x > 0.5 ? "left" : "right";

  return (
    <div ref={ref} className={`bubbles bubbles--${side}`} style={{ left: `${x * 100}%`, bottom }}>
      {thought !== undefined ? (
        <div className="bubble bubble--thought">
          <p className="bubble__thought u-hand">{thought}</p>
          <span className="bubble__tail" aria-hidden="true" />
        </div>
      ) : (
        <div className="bubble bubble--speech">
          <p className="bubble__said u-serif">{said}</p>
          <span className="bubble__tail" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
