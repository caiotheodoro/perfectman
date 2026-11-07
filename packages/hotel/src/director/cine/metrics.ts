/**
 * Scorecard numbers read off the director track (camera-and-audio.md 5: the
 * client emits nothing back, so these are measured here).
 *
 * - dead air: stretches with nothing to read, hear or cut to. Target: none over
 *   `deadAirMs` (10 s). Paused time does not count.
 * - shot-on-speaker: the share of lines whose camera was already on the speaker
 *   (their close-up, a pair they are in, or a shot following them) when the
 *   line played. Target: at least 90%.
 * - cut rate: camera changes per minute, room cuts per minute, and how many
 *   shots were shorter than the minimum (jitter).
 */
import type { PerfectmanUi } from "../generated.js";
import type { TrackEntry } from "./types.js";

export type DirectorMetrics = {
  durationMs: number;
  lines: number;
  deadAir: { gapsOverLimit: number; maxGapMs: number; totalOverLimitMs: number; limitMs: number };
  shotOnSpeaker: { onSpeaker: number; lines: number; ratio: number };
  cuts: { shots: number; shotsPerMin: number; roomCuts: number; roomCutsPerMin: number; shortShots: number; minShotMs: number; meanShotMs: number };
  fillers: number;
  drops: number;
};

type Interval = [start: number, end: number];

/** The span a cue keeps the viewer's attention, or undefined if it is not a thing to read or hear. */
function attention(ui: PerfectmanUi, t: number): Interval | undefined {
  switch (ui.k) {
    case "card":
    case "caption":
    case "thought":
    case "lower_third":
    case "cut_fx":
      return [t, t + ui.ms];
    default:
      return undefined;
  }
}

function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

export function coversSpeaker(ui: PerfectmanUi, avatar: number): boolean {
  if (ui.k !== "camera" || ui.shot === "establishing" || ui.shot === "insert" || ui.shot === "transition") return false;
  const target = ui.target;
  if ("avatar" in target) return target.avatar === avatar;
  if ("pair" in target) return target.pair.includes(avatar);
  return false;
}

export function computeMetrics(track: readonly TrackEntry[], opts: { deadAirMs?: number; minShotMs?: number; now?: number } = {}): DirectorMetrics {
  const limit = opts.deadAirMs ?? 10_000;
  const minShot = opts.minShotMs ?? 1800;
  const entries = [...track].sort((a, b) => a.t - b.t);

  const start = entries.find((e) => e.k === "start")?.t ?? entries[0]?.t ?? 0;
  const endEntry = [...entries].reverse().find((e) => e.k === "end");
  const lastT = entries.reduce((m, e) => Math.max(m, e.t), start);
  // A film still playing ends "now": a stalled engine shows up as the trailing gap.
  const end = endEntry?.t ?? Math.max(lastT, opts.now ?? lastT);

  // ---- attention intervals, lines included ------------------------------------
  const activity: Interval[] = [];
  let lines = 0;
  const fillerBeats = new Set<string>();
  let drops = 0;
  for (const e of entries) {
    if (e.k === "line") {
      activity.push([e.t, e.t + e.ms]);
      lines++;
    } else if (e.k === "cue") {
      const iv = attention(e.ui, e.t);
      if (iv) activity.push(iv);
      if (e.beat?.startsWith("filler:")) fillerBeats.add(e.beat);
    } else if (e.k === "drop") drops++;
  }

  // Paused stretches are removed: the film is not supposed to play then.
  const pauses: Interval[] = [];
  let pausedAt: number | undefined;
  for (const e of entries) {
    if (e.k === "pause") pausedAt ??= e.t;
    else if (e.k === "resume" && pausedAt !== undefined) {
      pauses.push([pausedAt, e.t]);
      pausedAt = undefined;
    }
  }
  if (pausedAt !== undefined) pauses.push([pausedAt, end]);
  const busy = merge([...activity, ...pauses]);

  const gaps: number[] = [];
  let cursor = start;
  for (const [s, e] of busy) {
    if (s > cursor) gaps.push(s - cursor);
    cursor = Math.max(cursor, e);
  }
  if (end > cursor) gaps.push(end - cursor);
  const over = gaps.filter((g) => g > limit);

  // ---- shot on speaker --------------------------------------------------------
  let camera: Extract<TrackEntry, { k: "cue" }> | undefined;
  let onSpeaker = 0;
  let lineCount = 0;
  let shots = 0;
  const durations: number[] = [];
  for (const e of entries) {
    if (e.k === "cut") {
      camera = undefined;
    } else if (e.k === "cue" && e.ui.k === "camera") {
      // A shot that a room cut ends is the director's call, so only camera-to-camera spans count as shot lengths.
      if (camera) durations.push(e.t - camera.t);
      camera = e;
      shots++;
    } else if (e.k === "line") {
      lineCount++;
      // On the speaker *before* the line: the cue must have started and finished easing by then.
      if (e.avatar !== null && camera && camera.room === e.room && coversSpeaker(camera.ui, e.avatar) && camera.ui.k === "camera" && camera.t + camera.ui.ease_ms <= e.t) onSpeaker++;
    }
  }

  // ---- cut rate ---------------------------------------------------------------
  const roomCuts = entries.filter((e) => e.k === "cut").length;
  const minutes = Math.max(1 / 60, (end - start) / 60_000);
  const shortShots = durations.filter((d) => d < minShot).length;

  return {
    durationMs: end - start,
    lines,
    deadAir: { gapsOverLimit: over.length, maxGapMs: gaps.reduce((m, g) => Math.max(m, g), 0), totalOverLimitMs: over.reduce((s, g) => s + g, 0), limitMs: limit },
    shotOnSpeaker: { onSpeaker, lines: lineCount, ratio: lineCount === 0 ? 1 : onSpeaker / lineCount },
    cuts: {
      shots,
      shotsPerMin: shots / minutes,
      roomCuts,
      roomCutsPerMin: roomCuts / minutes,
      shortShots,
      minShotMs: durations.length ? Math.min(...durations) : 0,
      meanShotMs: durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : 0,
    },
    fillers: fillerBeats.size,
    drops,
  };
}
