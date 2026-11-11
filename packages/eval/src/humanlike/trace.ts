/**
 * The human-likeness trace (cinematic revamp B5): what a run LOOKED like, in one flat, time-ordered list, whether it came from a real run's frame log
 * (`loadRunTrace`) or from the offline sim (`sim.ts`). Every metric in `metrics.ts` reads a trace and nothing else, so a real run and a sim arm are
 * measured by the same code. Times are milliseconds from the trace's own zero.
 */

export type Tile = readonly [number, number];

export type TraceActor = { ref: string; name: string; human: boolean };

export type TraceEvent =
  /** Where an avatar is and which way it faces; one event per change the hotel reported. `state` is stand/walk/sit/lay/dance. */
  | { t: number; kind: "pos"; ref: string; tile: Tile; dir: number; state: string }
  | { t: number; kind: "typing"; ref: string; on: boolean }
  /** A line on the wire. `to` is the person it was for when the run knows. */
  | { t: number; kind: "chat"; ref: string; to?: string; text: string; mode: string }
  /** An arm gesture: wave, thumbs, laugh, sign, blow, dance. */
  | { t: number; kind: "gesture"; ref: string; a: string; style?: number }
  /** A face: smile, angry, sad, surprised, sleepy, neutral, fear, disgust, smug. */
  | { t: number; kind: "expression"; ref: string; face: string }
  /** A body command the sidecar sent (walk, face, sit, ...), for how many of each. */
  | { t: number; kind: "cmd"; ref: string; cmd: string };

export type HumanTrace = {
  run: string;
  source: "run" | "sim";
  /** From the scene's start (the first line, or the first event) to the last event, ms. */
  durationMs: number;
  /** Ms from the trace's zero to the scene's start. Rates are counted from here. */
  sceneStartMs: number;
  actors: TraceActor[];
  events: TraceEvent[];
  /** The sim arm, when there is one: `h=0`, `h=0.6`. */
  arm?: string;
};

export type Placement = { tile: Tile; dir: number; state: string };

/** Per-avatar position, facing and face over time, queried by `at`. */
export class Timeline {
  private readonly pos = new Map<string, Array<{ t: number } & Placement>>();
  private readonly face = new Map<string, Array<{ t: number; face: string }>>();

  constructor(events: readonly TraceEvent[]) {
    for (const e of events) {
      if (e.kind === "pos") {
        const list = this.pos.get(e.ref) ?? [];
        list.push({ t: e.t, tile: e.tile, dir: e.dir, state: e.state });
        this.pos.set(e.ref, list);
      } else if (e.kind === "expression") {
        const list = this.face.get(e.ref) ?? [];
        list.push({ t: e.t, face: e.face });
        this.face.set(e.ref, list);
      }
    }
    for (const list of this.pos.values()) list.sort((a, b) => a.t - b.t);
    for (const list of this.face.values()) list.sort((a, b) => a.t - b.t);
  }

  /** The placement at time `t`: the last `pos` at or before it. */
  at(ref: string, t: number): Placement | undefined {
    const list = this.pos.get(ref);
    if (!list || list.length === 0) return undefined;
    let lo = 0;
    let hi = list.length - 1;
    if (list[0]!.t > t) return undefined;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (list[mid]!.t <= t) lo = mid;
      else hi = mid - 1;
    }
    return list[lo];
  }

  /** Every placement change of an avatar in [from, to]. */
  between(ref: string, from: number, to: number): Array<{ t: number } & Placement> {
    return (this.pos.get(ref) ?? []).filter((p) => p.t >= from && p.t <= to);
  }

  refs(): string[] {
    return [...this.pos.keys()];
  }
}

/** Chebyshev distance between two tiles, the metric of the hotel's distance bands (embodiment.md 2). */
export const chebyshev = (a: Tile, b: Tile): number => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));

/** Tilehouse `direction()`: 0 is toward -y, increasing clockwise. */
export function bearing(from: Tile, to: Tile): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 && dy === 0) return 0;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((Math.round(deg / 45) % 8) + 8) % 8;
}

/** Smallest angle between two directions, degrees (0..180). */
export function dirDiffDeg(a: number, b: number): number {
  const d = (((a - b) % 8) + 8) % 8;
  return Math.min(d, 8 - d) * 45;
}
