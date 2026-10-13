/**
 * Reading the timeline at a moment.
 *
 * `sampleTimeline` is a pure function of the clock: scrubbing, speed, live
 * follow and video export all call it, so nothing on screen is ever
 * "triggered". Poses blend with a monotone cubic Hermite spline through every
 * key, so motion flows through keys instead of stopping at each one, and the
 * spline never overshoots a key.
 */
import type { PoseVector } from "./emotion-pose.js";
import type { PoseKey, Timeline } from "./timeline.js";
import type { Balloon, CameraState, Caption, ReactionMark, Scene } from "./types.js";

const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));
const ease = (k: number): number => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

type Num = number | number[];
type Fields = Record<string, Num>;

/** Fritsch-Carlson style tangents per component: zero at a turning point, harmonic mean otherwise. */
export function computeTangents(keys: PoseKey[]): void {
  const n = keys.length;
  if (n === 0) return;
  const proto = keys[0]!.v as unknown as Fields;
  const comp = (get: (k: PoseKey) => number): number[] => {
    const m = new Array<number>(n).fill(0);
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((get(keys[i + 1]!) - get(keys[i]!)) / (keys[i + 1]!.t - keys[i]!.t));
    for (let i = 1; i < n - 1; i++) {
      const a = d[i - 1]!, b = d[i]!;
      m[i] = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
    }
    if (n > 1) { m[0] = d[0]!; m[n - 1] = d[n - 2]!; }
    return m;
  };
  const tangents: Record<string, number[] | number[][]> = {};
  for (const f of Object.keys(proto)) {
    const x = proto[f]!;
    tangents[f] = Array.isArray(x)
      ? x.map((_, j) => comp((k) => ((k.v as unknown as Fields)[f] as number[])[j]!))
      : comp((k) => (k.v as unknown as Fields)[f] as number);
  }
  keys.forEach((k, i) => {
    const m: Fields = {};
    for (const f of Object.keys(proto)) {
      const t = tangents[f]!;
      m[f] = Array.isArray(proto[f]) ? (t as number[][]).map((a) => a[i]!) : (t as number[])[i]!;
    }
    k.m = m as unknown as PoseVector;
  });
}

function hermite(a: PoseKey, b: PoseKey, t: number): PoseVector {
  const h = b.t - a.t, s = (t - a.t) / h, s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const out: Fields = {};
  const av = a.v as unknown as Fields, bv = b.v as unknown as Fields, am = a.m as unknown as Fields, bm = b.m as unknown as Fields;
  for (const f of Object.keys(av)) {
    const x = av[f]!;
    if (Array.isArray(x)) {
      const y = bv[f] as number[], mx = am[f] as number[], my = bm[f] as number[];
      out[f] = x.map((_, j) => h00 * x[j]! + h10 * h * mx[j]! + h01 * y[j]! + h11 * h * my[j]!);
    } else {
      out[f] = h00 * x + h10 * h * (am[f] as number) + h01 * (bv[f] as number) + h11 * h * (bm[f] as number);
    }
  }
  return out as unknown as PoseVector;
}

/** The two entries around `t` in a sorted list, and how far between them. */
export function bracket<T extends { t: number }>(arr: T[], t: number): [T, T, number] {
  const first = arr[0]!, last = arr[arr.length - 1]!;
  if (t <= first.t) return [first, first, 0];
  if (t >= last.t) return [last, last, 0];
  let lo = 0, hi = arr.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (arr[mid]!.t <= t) lo = mid; else hi = mid; }
  return [arr[lo]!, arr[hi]!, (t - arr[lo]!.t) / (arr[hi]!.t - arr[lo]!.t)];
}

export function cameraAt(T: Timeline, t: number): CameraState {
  const [a, b, k] = bracket(T.cam, t);
  const e = ease(k);
  const out = { ...a.c };
  for (const f of Object.keys(a.c) as Array<keyof CameraState>) {
    // Zoom blends in log space, so a dolly feels even rather than rushing at the end.
    out[f] = f === "z" ? Math.exp(Math.log(a.c.z) + (Math.log(b.c.z) - Math.log(a.c.z)) * e) : a.c[f] + (b.c[f] - a.c[f]) * e;
  }
  const zc = Math.max(1, out.z);
  out.cx = clamp(out.cx, 600 / zc, 1200 - 600 / zc);
  out.cy = clamp(out.cy, 300 / zc, 600 - 300 / zc);
  return out;
}

export type CharacterSample = { v: PoseVector; walking: boolean; speak: number };
export type Sample = {
  t: number;
  chars: Record<string, CharacterSample>;
  cam: CameraState;
  /** Story minutes since midnight. */
  minute: number;
  balloons: Balloon[];
  marks: Array<{ m: ReactionMark; k: number }>;
  captions: Array<{ c: Caption; op: number }>;
  scene: Scene | undefined;
};

export type SampleOptions = {
  /** Show private thoughts. Off is the "fiction only" lens. */
  omniscient?: boolean;
};

export function sampleTimeline(T: Timeline, t: number, opts: SampleOptions = {}): Sample {
  const omniscient = opts.omniscient !== false;
  const chars: Record<string, CharacterSample> = {};
  for (const id of T.agents) {
    const ks = T.keys[id]!;
    const [x, y, k] = bracket(ks, t);
    const v = x === y ? x.v : hermite(x, y, t);
    const walking = x !== y && Math.hypot(y.v.x - x.v.x, y.v.y - x.v.y) > 30 && k > 0.02 && k < 0.98;
    // The mouth opens on each word as it lands and relaxes between words.
    let speak = 0;
    for (const [a0, a1, ws] of T.speak[id]!) {
      if (t < a0 - 0.05 || t > a1 + 0.15) continue;
      let w = 0;
      for (let i = ws.length - 1; i >= 0; i--) {
        if (ws[i]!.t <= t) { w = Math.exp(-(t - ws[i]!.t) / 0.09) * Math.min(1, 0.55 + ws[i]!.len / 7); break; }
      }
      speak = (t <= a1 ? 1 : Math.max(0, 1 - (t - a1) / 0.15)) * Math.max(0.25, w);
      break;
    }
    chars[id] = { v, walking, speak: Math.max(0, speak) };
  }
  const [la, lb, lk] = bracket(T.light, t);
  return {
    t, chars, cam: cameraAt(T, t), minute: la.minute + (lb.minute - la.minute) * lk,
    balloons: T.balloons.filter((b) => t >= b.t0 && t <= b.t1 && (omniscient || !b.omniscient)),
    marks: T.marks.filter((m) => t >= m.t && t <= m.t + m.dur).map((m) => ({ m, k: (t - m.t) / m.dur })),
    captions: T.captions.filter((c) => t >= c.t0 && t <= c.t1).map((c) => ({ c, op: Math.min(clamp((t - c.t0) / 0.3, 0, 1), clamp((c.t1 - t) / 0.3, 0, 1)) })),
    scene: T.scenes.find((s) => t >= s.t0 && t <= s.t1) ?? T.scenes[T.scenes.length - 1],
  };
}

/**
 * A copy of the timeline with everything private removed: the "fiction only"
 * cut for export, where a flag a renderer might forget is not good enough.
 */
export function stripOmniscient(T: Timeline): Timeline {
  return { ...T, balloons: T.balloons.filter((b) => !b.omniscient).map((b) => ({ ...b })) };
}
