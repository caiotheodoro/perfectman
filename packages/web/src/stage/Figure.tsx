/**
 * One character: a face.
 *
 * The body never carried information — the face does all of it, and at the
 * sizes the stage and the cards draw, a body only made the face smaller. So a
 * character is a head with a name under it. Every pose is a path swap and
 * every path swap is a CSS transition, which is why this needs no animation
 * library; the head also tilts with the feeling, the cheeks colour, and the
 * mouth moves while a line is being said.
 *
 * Drawn in its own 100×100 space and positioned by the stage, so nothing here
 * knows where it stands.
 */
import { chipFor, headShapeFor, FACE_POSES, type FaceState } from "@perfectman/shared";

export type FigureProps = {
  index: number;
  name: string;
  face: FaceState;
  /** 0–1. How much of the feeling shows: brows, cheeks, the tilt of the head. */
  energy: number;
  speaking: boolean;
  /** Dimmed when someone is present but not part of this beat. */
  attentive: boolean;
};

/** What the pose table does not say: where the eyes look and whether the cheeks colour. */
const EXPRESSION: Record<FaceState, { gaze: number; blush: number }> = {
  neutral: { gaze: 0, blush: 0 },
  smile: { gaze: 0, blush: 0.55 },
  worried: { gaze: -2.2, blush: 0.3 },
  angry: { gaze: 0, blush: 0.15 },
  tired: { gaze: 0.8, blush: 0 },
  shock: { gaze: 0, blush: 0.2 },
};

export function Figure({ index, name, face, energy, speaking, attentive }: FigureProps): JSX.Element {
  const chip = chipFor(index);
  const pose = FACE_POSES[face];
  const round = headShapeFor(index) === "round";
  const look = EXPRESSION[face] ?? EXPRESSION.neutral;
  const gaze = look.gaze * (0.6 + energy * 0.4);

  return (
    <div
      className={`figure figure--${face}${speaking ? " figure--speaking" : ""}${attentive ? "" : " figure--aside"}`}
      data-face={face}
    >
      <svg viewBox="0 0 100 100" className="figure__body" aria-hidden="true">
        <g className="figure__head">
          {/* The same hairline the page uses, so a pale character still reads
              as a drawn face on warm paper. */}
          <g className="figure__ink" fill={chip}>
            {round ? (
              <circle cx="50" cy="50" r="44" />
            ) : (
              <path d="M50 6a44 44 0 1 0 31 75l17-2-12-15A44 44 0 0 0 50 6Z" />
            )}
          </g>
          <ellipse className="figure__blush" cx="29" cy="62" rx="8" ry="4.5" style={{ opacity: look.blush }} />
          <ellipse className="figure__blush" cx="71" cy="62" rx="8" ry="4.5" style={{ opacity: look.blush }} />
          <g className="figure__look">
            <ellipse className="figure__eye" cx={39 + gaze} cy="49" rx="5.5" ry={pose.eyeRy} />
            <ellipse className="figure__eye" cx={61 + gaze} cy="49" rx="5.5" ry={pose.eyeRy} />
            <path className="figure__brow" d={pose.browLeft} opacity={pose.browOpacity} />
            <path className="figure__brow" d={pose.browRight} opacity={pose.browOpacity} />
            <path className="figure__mouth" d={pose.mouth} opacity={face === "shock" ? 0 : 1} />
            <ellipse className="figure__gasp" cx="50" cy="68" rx="5.5" ry="7.5" opacity={face === "shock" ? 1 : 0} />
          </g>
        </g>
      </svg>
      <span className="figure__name u-hand">{name}</span>
    </div>
  );
}
