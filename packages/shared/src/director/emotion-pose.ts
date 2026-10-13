/**
 * Recorded emotion → a whole-body pose.
 *
 * The strongest social emotion picks the posture; arousal sets the breath and
 * the tremor. Like `faceFor`, this is a visual reading of recorded state and
 * never reads the message text. Every pose is a vector of numbers so a
 * timeline can blend between any two of them without a snap.
 */
import { FACE_POSES, type FaceState } from "../stage/emotion-face.js";
import type { ArmState, PersonaSignature } from "./persona-signature.js";
import type { DirectorMood } from "./types.js";

export type PoseKind = "rest" | "anger" | "shame" | "fear" | "warm" | "proud" | "suspicion" | "tired" | "peek";

/** A pose chosen by name; `toPoseVector` turns it into numbers. */
export type PoseTarget = {
  kind: PoseKind;
  strength: number;
  breath: number;
  lean: number;
  squash: number;
  puff: number;
  tremor: number;
  armL: ArmState;
  armR: ArmState;
  face: FaceState;
  gx: number;
  gy: number;
  tear: number;
  blush: number;
  sweat: number;
  clench: number;
  back: number;
  blur: number;
  dim: number;
  hide: number;
};

const nums = (d: string): number[] => (d.match(/-?\d+\.?\d*/g) ?? []).map(Number);

const ARM_PATHS: Record<ArmState, [number[], number[]]> = {
  down: [[46, 130, 30, 152, 36, 178], [174, 130, 190, 152, 184, 178]],
  folded: [[46, 134, 80, 168, 118, 152], [174, 134, 140, 170, 102, 154]],
  akimbo: [[46, 128, 12, 142, 40, 170], [174, 128, 208, 142, 180, 170]],
  up: [[44, 126, 12, 104, 24, 66], [176, 126, 208, 104, 196, 66]],
  hug: [[46, 138, 78, 184, 114, 166], [174, 138, 142, 184, 106, 168]],
  wring: [[46, 134, 70, 178, 106, 164], [174, 134, 150, 178, 114, 164]],
  open: [[46, 128, 16, 138, 10, 164], [174, 128, 204, 138, 210, 164]],
  behind: [[46, 136, 38, 156, 52, 172], [174, 136, 182, 156, 168, 172]],
  hold: [[46, 132, 58, 160, 92, 160], [174, 132, 158, 160, 124, 158]],
};

/** The numbers a renderer draws from. Position (`x`, `y`, `w`) rides along so walking blends like everything else. */
export type PoseVector = {
  lean: number;
  squash: number;
  puff: number;
  tremor: number;
  breath: number;
  ry: number;
  sry: number;
  bl: number[];
  br: number[];
  bo: number;
  m: number[];
  aL: number[];
  aR: number[];
  gx: number;
  gy: number;
  tear: number;
  blush: number;
  sweat: number;
  clench: number;
  back: number;
  blur: number;
  dim: number;
  hide: number;
  x: number;
  y: number;
  w: number;
};

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

/** Pose for a mood and a set of social emotions. `toward` is -1, 0 or 1: which way the person is facing. */
export function poseFrom(
  mood: DirectorMood,
  social: Record<string, number>,
  opts: { toward?: number } = {},
): PoseTarget {
  const s = (k: string): number => social[k] ?? 0;
  const energy = mood.energy ?? 1;
  const score: Record<Exclude<PoseKind, "rest" | "peek">, number> = {
    anger: s("resentment") * 3 + s("contempt") * 2 + s("jealousy") * 1.6 + s("envy") * 1.4,
    shame: s("humiliation") * 2.4 + s("shame") * 2.4,
    fear: s("fearOfExclusion") * 0.7 + s("socialAnxiety") * 1.4 + s("neediness") * 1.2,
    warm: s("affection") * 1.7 + s("admiration") * 1.6,
    proud: s("pride") * 2.3 + s("desireForStatus") * 0.9,
    suspicion: s("suspicion") * 3.6,
    tired: Math.max(0, 0.45 - energy) * 3,
  };
  let kind: PoseKind = "rest";
  let top = 0.34;
  for (const k of Object.keys(score) as Array<keyof typeof score>) {
    if (score[k] > top) {
      top = score[k];
      kind = k;
    }
  }
  const arousal = mood.arousal ?? 0.4;
  const t = opts.toward ?? 0;
  const P: PoseTarget = {
    kind, strength: top, breath: clamp(4.7 - (arousal - 0.25) * 8, 1.3, 4.7),
    lean: 0, squash: 1, puff: 1, tremor: 0, armL: "down", armR: "down", face: "neutral",
    gx: 0, gy: 0, tear: 0, blush: 0, sweat: 0, clench: 0, back: 0, blur: 0, dim: 0, hide: 0,
  };
  switch (kind) {
    case "anger": Object.assign(P, { puff: 1.07, squash: 0.985, lean: 4 * t, tremor: 1 + arousal * 2.4, armL: "akimbo", armR: arousal > 0.55 ? "up" : "akimbo", face: "angry", clench: 1 }); break;
    case "shame": Object.assign(P, { squash: 0.9, puff: 0.96, lean: -6 * (t || 1), armL: "hug", armR: "hug", face: "worried", gy: 1, gx: -t, blush: 1 }); break;
    case "fear": Object.assign(P, { squash: 0.955, lean: -8 * (t || 1), tremor: 0.5 + arousal, armL: "wring", armR: "wring", face: "worried", sweat: 1, gx: -t * 0.5 }); break;
    case "warm": Object.assign(P, { lean: 7 * (t || 1), squash: 1.01, armL: "open", armR: "open", face: "smile", blush: 0.5, gx: t }); break;
    case "proud": Object.assign(P, { squash: 1.05, puff: 1.03, lean: -2, armL: "akimbo", armR: "akimbo", face: "neutral", gy: -0.5 }); break;
    case "suspicion": Object.assign(P, { lean: -5, squash: 0.99, armL: "folded", armR: "folded", face: "tired", gx: t }); break;
    case "tired": Object.assign(P, { squash: 0.91, lean: 2, face: "tired", gy: 0.6 }); break;
    default: P.gx = t;
  }
  return P;
}

const parsedFace = (f: FaceState): { r: number; bl: number[]; br: number[]; bo: number; m: number[] } => {
  const p = FACE_POSES[f];
  return { r: p.eyeRy, bl: nums(p.browLeft), br: nums(p.browRight), bo: p.browOpacity, m: nums(p.mouth) };
};

/** Pose to numbers. The persona's resting habit shows through a pose that has no opinion of its own. */
export function toPoseVector(P: PoseTarget, sig?: Pick<PersonaSignature, "arms" | "lean" | "squash">): PoseVector {
  const f = parsedFace(P.face);
  const habit = (a: ArmState): ArmState => (a === "down" && sig && sig.arms !== "down" && P.kind === "rest" ? sig.arms : a);
  return {
    lean: P.lean + (sig?.lean ?? 0), squash: P.squash * (sig?.squash ?? 1), puff: P.puff, tremor: P.tremor, breath: P.breath,
    ry: f.r, sry: P.face === "tired" ? 7 : 12.5, bl: f.bl, br: f.br, bo: f.bo, m: f.m,
    aL: [...ARM_PATHS[habit(P.armL)][0]], aR: [...ARM_PATHS[habit(P.armR)][1]],
    gx: P.gx, gy: P.gy, tear: P.tear, blush: P.blush, sweat: P.sweat, clench: P.clench, back: P.back,
    blur: P.blur, dim: P.dim, hide: P.hide, x: 0, y: 0, w: 0,
  };
}

/** Plain-language reading of a posture, for captions and alt text. */
export function describePose(kind: PoseKind): string {
  return ({
    anger: "tense and puffed, fists on hips, a tremor in the jaw",
    shame: "shrunk in, arms wrapped, face turned away and flushed",
    fear: "cringing back, hands wringing, a bead of sweat",
    warm: "leaning in, arms open, easy smile",
    proud: "chest up, chin lifted, hands on hips",
    suspicion: "weight back, arms folded, eyes narrowed",
    tired: "sagging, eyes half shut",
    rest: "resting in their own habit",
    peek: "glancing over, keeping out of it",
  } as Record<PoseKind, string>)[kind];
}
