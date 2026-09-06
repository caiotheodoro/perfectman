/**
 * One character.
 *
 * The drawing is the video renderer's figure, rebuilt as JSX so the face can be
 * React state rather than a GSAP tween into a pre-rendered node. Every pose is
 * a path swap and every path swap is a CSS transition, which is why this needs
 * no animation library.
 *
 * The figure is drawn in its own 100x160 space and positioned by the stage, so
 * nothing here knows where it stands.
 */
import { chipFor, headShapeFor, FACE_POSES, type FaceState } from "@perfectman/shared";

export type FigureProps = {
  index: number;
  name: string;
  face: FaceState;
  /** 0–1. Drives how far the arms swing and how much the body leans. */
  energy: number;
  speaking: boolean;
  /** Dimmed when someone is present but not part of this beat. */
  attentive: boolean;
};

export function Figure({ index, name, face, energy, speaking, attentive }: FigureProps): JSX.Element {
  const chip = chipFor(index);
  const pose = FACE_POSES[face];
  const round = headShapeFor(index) === "round";
  // Arms read the emotion: worried folds them up, angry plants them, otherwise
  // they hang. Arousal scales the swing so a calm agent still moves a little.
  const swing = (face === "worried" ? -26 : face === "angry" ? -10 : 6) * (0.65 + energy * 0.35);

  return (
    <div className={`figure${speaking ? " figure--speaking" : ""}${attentive ? "" : " figure--aside"}`}>
      <svg viewBox="0 0 100 168" className="figure__body" aria-hidden="true">
        {/* Every part carries the same hairline the page uses, so a pale
            character still reads as a drawn figure on warm paper. */}
        <g className="figure__torso" fill={chip} stroke={chip}>
          <path d="M39 126L34 150" strokeWidth="11" strokeLinecap="round" />
          <path d="M61 126L66 150" strokeWidth="11" strokeLinecap="round" />
          <rect className="figure__ink" x="28" y="87" width="44" height="46" rx="18" />
        </g>

        <g
          className="figure__arm"
          fill={chip}
          stroke={chip}
          strokeWidth="9"
          strokeLinecap="round"
          style={{ transform: `rotate(${swing}deg)`, transformOrigin: "31px 101px" }}
        >
          <path d="M31 101Q15 103 13 121" fill="none" />
          <circle className="figure__ink" cx="13" cy="124" r="6" />
        </g>
        <g
          className="figure__arm"
          fill={chip}
          stroke={chip}
          strokeWidth="9"
          strokeLinecap="round"
          style={{ transform: `rotate(${-swing}deg)`, transformOrigin: "69px 101px" }}
        >
          <path d="M69 101Q85 103 87 121" fill="none" />
          <circle className="figure__ink" cx="87" cy="124" r="6" />
        </g>

        <g className="figure__head">
          <g className="figure__ink" fill={chip}>
            {round ? (
              <circle cx="50" cy="48" r="43" />
            ) : (
              <path d="M50 6a42 42 0 1 0 30 72l16-2-11-14A42 42 0 0 0 50 6Z" />
            )}
          </g>
          <g className="figure__look">
            <ellipse className="figure__eye" cx="40" cy="47" rx="5.5" ry={pose.eyeRy} />
            <ellipse className="figure__eye" cx="60" cy="47" rx="5.5" ry={pose.eyeRy} />
            <path className="figure__brow" d={pose.browLeft} opacity={pose.browOpacity} />
            <path className="figure__brow" d={pose.browRight} opacity={pose.browOpacity} />
            <path className="figure__mouth" d={pose.mouth} opacity={face === "shock" ? 0 : 1} />
            <ellipse className="figure__gasp" cx="50" cy="65" rx="5" ry="7" opacity={face === "shock" ? 1 : 0} />
          </g>
        </g>
      </svg>
      <span className="figure__name u-hand">{name}</span>
    </div>
  );
}
