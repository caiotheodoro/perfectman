/** Graphic AI agents. Identity comes from the sorted cast, expression from recorded state. */
import type { CSSProperties } from "react";
import { FACE_POSES, type FaceState } from "@perfectman/shared";

const COLORS = ["#e3ad33", "#ee6149", "#709344", "#9693c1", "#cb7286", "#58a59c"];
const SHAPES = [
  "M26 166Q18 143 30 120L21 102Q17 90 36 76L31 62Q29 50 54 40L59 21Q63 9 84 27L102 16Q113 9 129 28L149 24Q163 25 165 43L187 54Q197 61 186 80L199 103Q204 117 188 130L192 147Q190 166 169 172L160 190 134 180 111 192 91 179 68 186 56 171Z",
  "M68 173C44 150 42 114 53 88L32 43Q25 18 44 14Q60 11 66 33L80 65Q90 60 101 61L119 24Q131 2 145 12Q158 21 145 42L126 74C153 88 163 117 153 143Q147 170 124 182L90 184ZM150 105q30 7 39-12-4 32-35 36M62 111q-27-1-34 16 6-33 29-34",
  "M23 100 71 76 91 18Q93 10 102 17L129 53 176 35Q185 32 181 43L166 89 204 134Q209 141 199 144L150 150 117 191Q111 199 108 188L92 153 44 168Q33 171 37 159L49 128Z",
  "M48 72C13 44 65 7 95 34C123-7 174 14 166 55C214 58 215 107 179 119C211 164 171 199 131 177C101 213 54 192 57 166C11 163 4 108 48 99Z",
  "M49 22 165 22 185 47 185 83 207 105 185 127 185 161 163 187 51 187 31 163 31 129 10 107 31 85 31 48Z",
  "M36 37Q71 3 121 28L189 64 167 94 187 132Q184 168 145 188L101 165 57 190 31 157 57 125 28 91 65 64Z",
];

// ponytail: six visual identities repeat for larger casts; add artwork if larger rosters need unique silhouettes.
function variant(index: number): number { return ((index % SHAPES.length) + SHAPES.length) % SHAPES.length; }
export function agentColor(index: number): string { return COLORS[variant(index)]!; }

/** The same silhouette is used by the cast picker, stage and contact sheet. */
export function AgentSilhouette({ index, detail = false }: { index: number; detail?: boolean }): JSX.Element {
  const shape = variant(index);
  return <g className="figure__silhouette" data-shape={shape} fill={agentColor(index)}>
    <path d={SHAPES[shape]} />
    {detail && shape === 0 ? <>
      <path d="M37 80 53 99l-10 25 17 18-6 26M68 41 77 59M168 52l-7 21 16 23-12 24 12 24-13 23" fill="none" stroke="#c58e26" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M84 30 88 57M132 31l-7 21" stroke="#f7c957" strokeWidth="7" strokeLinecap="round" />
      <path d="m71 180 20-1 20 13 23-12 22 8" fill="none" stroke="#9a741d" strokeWidth="4" strokeLinecap="round" />
    </> : null}
    {detail && shape === 1 ? <>
      <path d="M68 171q9 20 30 21l-8-33Zm53 8 27 2-2-26Z" fill="#c94b35" />
      <path d="M42 40 57 78M131 31l-18 41" stroke="#ff9273" strokeWidth="7" strokeLinecap="round" />
      <path d="M68 143q-10-30 1-50" stroke="#ff8064" strokeWidth="8" fill="none" strokeLinecap="round" />
    </> : null}
    {detail && shape === 2 ? <>
      <path d="m102 17 4 63 70-45-29 66 57 39-71-9-17 60-20-65-54 40 28-66-46-1 49-22Z" fill="#8ead55" />
      <path d="m102 17 4 63 27 51-17 60-20-65-25-26 2-23Z" fill="#769845" />
      <path d="m106 80 27 51 71 9-57-39 29-66Z" fill="#587e38" />
      <path d="m42 166 29-66 25 26Z" fill="#a8c26b" />
      <path d="m106 80 27 51M71 100l25 26" stroke="#526f35" strokeWidth="2" />
    </> : null}
    {detail && shape === 3 ? <path d="M49 72q22 18 40-7M179 119q-23-12-31 4M57 166q13-21 25-15" fill="none" stroke="#736ca4" strokeWidth="7" strokeLinecap="round" /> : null}
    {detail && shape === 4 ? <path d="M49 22 64 48h82l19-26M31 48l22 16v82l-22 17M185 47l-20 18v81l20 15M51 187l16-22h82l14 22" fill="none" stroke="#a44d67" strokeWidth="7" /> : null}
    {detail && shape === 5 ? <path d="m36 37 29 27-8 61 44 40 44 23-17-46 39-48 22-30-57 10-11-46" fill="none" stroke="#387e78" strokeWidth="8" strokeLinejoin="round" /> : null}
  </g>;
}

export type FigureProps = {
  index: number;
  name: string;
  face: FaceState;
  energy: number;
  speaking: boolean;
  attentive: boolean;
  /** Visual orientation toward this beat's audience, not recorded physical movement. */
  gaze?: { x: number; y: number };
};

export function Figure({ index, name, face, energy, speaking, attentive, gaze = { x: 0, y: 0 } }: FigureProps): JSX.Element {
  const pose = FACE_POSES[face];
  const open = face === "shock" || (speaking && face === "neutral");
  return (
    <div className={`figure figure--${face}${speaking ? " figure--speaking" : ""}${attentive ? "" : " figure--aside"}`}
      data-face={face} data-gaze-x={gaze.x} data-gaze-y={gaze.y}
      style={{ "--gaze-tilt": `${gaze.x * 2}deg`, "--expression-energy": Math.max(0, Math.min(1, energy)) } as CSSProperties}>
      <svg viewBox="0 0 220 210" className="figure__body" aria-hidden="true" focusable="false">
        <ellipse className="figure__shadow" cx="110" cy="197" rx="59" ry="5" />
        <g className="figure__head">
          <AgentSilhouette index={index} detail />
          <g transform="translate(31 25) scale(1.6)">
            <g className="figure__look" transform={`translate(${gaze.x * 3} ${gaze.y * 2})`}>
              <ellipse className="figure__socket" cx="39" cy="49" rx="8.5" ry={face === "tired" ? 7 : 12.5} />
              <ellipse className="figure__socket" cx="61" cy="49" rx="8.5" ry={face === "tired" ? 7 : 12.5} />
              <ellipse className="figure__eye" cx={39 + gaze.x * 3} cy={49 + gaze.y * 2} rx="3.4" ry={pose.eyeRy} />
              <ellipse className="figure__eye" cx={61 + gaze.x * 3} cy={49 + gaze.y * 2} rx="3.4" ry={pose.eyeRy} />
              <path className="figure__brow" d={pose.browLeft} opacity={pose.browOpacity} />
              <path className="figure__brow" d={pose.browRight} opacity={pose.browOpacity} />
              <path className="figure__mouth" d={pose.mouth} opacity={open ? 0 : 1} />
              <ellipse className="figure__gasp" cx="50" cy="68" rx={face === "shock" ? 5.5 : 4.5} ry={face === "shock" ? 7 : 3.5} opacity={open ? 1 : 0} />
            </g>
          </g>
        </g>
      </svg>
      <span className="figure__name">{name}</span>
    </div>
  );
}
