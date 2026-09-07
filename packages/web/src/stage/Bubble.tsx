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
  scale,
  contentKey,
  said,
  thought,
}: {
  /** The speaker's mark, measured for where the head really is. */
  speaker: RefObject<HTMLElement>;
  /** Fraction from the room's top, used until the mark has been laid out. */
  headTopGuess: number;
  x: number;
  /** The speaker's slot scale; a mark is 15% of the room wide at scale 1. */
  scale: number;
  contentKey: string;
  said: string;
  thought?: string;
}): JSX.Element {
  // A balloon that could not fit above the head sits beside it instead, clear
  // of the figure: half a mark's width plus a little. Balloons open away from
  // the nearest wall, unless that would run them off the side of the room.
  const clearance = 0.075 * scale + 0.015;
  const { ref, bottom, beside, side } = useBubbleAnchor(speaker, headTopGuess, contentKey, x, clearance);
  const left = !beside ? x : side === "right" ? x + clearance : x - clearance;

  return (
    <div
      ref={ref}
      className={`bubbles bubbles--${side}${beside ? " bubbles--beside" : ""}`}
      style={{ left: `${left * 100}%`, bottom }}
    >
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
