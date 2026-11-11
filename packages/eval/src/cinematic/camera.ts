/**
 * CAMERA: is it shot like a film. Reads director-track.jsonl: how many kinds of shot, whether one shot is used all the time, the cut rate,
 * whether the camera was on the speaker when the line started, and how many cues were dropped before they played.
 *
 * Shot-on-speaker is the director scorecard's own definition (hotel/src/director/cine/metrics.ts): the line's speaker, or a pair they are in, was
 * framed by a camera cue that had finished easing before the line started, in the same room, with no room cut since. Establishing, insert and
 * transition shots never count as covering a speaker. Re-implemented here so the scorer shares no code with the director.
 */
import type { Camera, RunBundle } from "./bundle.js";
import type { CinemaNorms } from "./norms.js";
import { groupOf, read, readFail, round1, type GroupScore, type Reading } from "./types.js";

export const MIN_SHOT_MS = 1800;
/** A drop for these reasons is a cue the director wanted and lost; "stopped" is the run ending with cues still queued. */
export const LOST_DROP_REASONS: ReadonlySet<string> = new Set(["stale", "unstageable"]);

export function shotOnSpeaker(camera: Camera): { onSpeaker: number; lines: number; ratio: number | null } {
  type Active = NonNullable<Camera["timeline"][number]["cue"]>;
  const events = [
    ...camera.timeline.map((t) => ({ t: t.tMs, order: 0, kind: t.kind, cue: t.cue, room: t.room })),
    ...camera.lines.map((l) => ({ t: l.tMs, order: 1, kind: "line" as const, cue: undefined, room: l.room, line: l })),
  ].sort((a, b) => a.t - b.t || a.order - b.order);
  let active: Active | undefined;
  let onSpeaker = 0;
  let lines = 0;
  for (const e of events) {
    if (e.kind === "cut") active = undefined;
    else if (e.kind === "cue" && e.cue) active = e.cue;
    else if (e.kind === "line" && "line" in e && e.line) {
      lines++;
      const speaker = e.line.avatar;
      if (speaker === null || !active) continue;
      if (active.shot === "establishing" || active.shot === "insert" || active.shot === "transition") continue;
      if (active.room !== undefined && e.line.room !== undefined && active.room !== e.line.room) continue;
      const covers = active.avatar === speaker || (active.pair?.includes(speaker) ?? false);
      if (covers && active.tMs + active.easeMs <= e.line.tMs) onSpeaker++;
    }
  }
  return { onSpeaker, lines, ratio: lines === 0 ? null : onSpeaker / lines };
}

export function scoreCamera(bundle: RunBundle, norms: CinemaNorms): GroupScore {
  const cam = bundle.camera;
  if (!cam) return groupOf("camera", [], { reason: "no director-track.jsonl in the run" });
  const B = norms.bands;
  const readings: Reading[] = [];
  const minutes = Math.max(1 / 6, Math.max(cam.durationMs, 1) / 60_000);

  const shots = new Map<string, number>();
  for (const c of cam.cues) shots.set(c.shot, (shots.get(c.shot) ?? 0) + 1);
  if (cam.cues.length === 0) {
    for (const [m, w] of [["distinctShots", 0.25], ["topShotShare", 0.1], ["shotsPerMin", 0.2], ["shortShotShare", 0.1]] as const) readings.push(readFail(m, w, "the track has no camera cue", B[m]));
  } else {
    readings.push(read("distinctShots", shots.size, 0.25, B.distinctShots, `shots: ${[...shots].map(([s, n]) => `${s} x${n}`).join(", ")}`));
    const top = [...shots].sort((a, b) => b[1] - a[1])[0]!;
    readings.push(read("topShotShare", top[1] / cam.cues.length, 0.1, B.topShotShare, `${top[0]} is ${top[1]} of ${cam.cues.length} camera cues`));
    readings.push(read("shotsPerMin", cam.cues.length / minutes, 0.2, B.shotsPerMin, `${cam.cues.length} camera cues in ${round1(minutes)} min (${cam.roomCuts} room cut(s))`));
    // camera-to-camera spans only: a room cut ends a shot at the director's call
    const spans: number[] = [];
    let prev: { tMs: number } | undefined;
    for (const t of cam.timeline) {
      if (t.kind === "cut") prev = undefined;
      else if (t.cue) {
        if (prev) spans.push(t.tMs - prev.tMs);
        prev = t;
      }
    }
    const short = spans.filter((d) => d < MIN_SHOT_MS).length;
    readings.push(
      spans.length === 0
        ? { metric: "shortShotShare", value: null, score: null, weight: 0.1, band: B.shortShotShare, note: "fewer than 2 shots in a row, no shot length to read" }
        : read("shortShotShare", short / spans.length, 0.1, B.shortShotShare, `${short} of ${spans.length} shots lasted under ${MIN_SHOT_MS} ms`),
    );
  }

  const sos = shotOnSpeaker(cam);
  readings.push(
    sos.ratio === null
      ? { metric: "shotOnSpeaker", value: null, score: null, weight: 0.2, band: B.shotOnSpeaker, note: "no staged line to be on" }
      : read("shotOnSpeaker", sos.ratio, 0.2, B.shotOnSpeaker, `camera was already on the speaker for ${sos.onSpeaker} of ${sos.lines} lines`),
  );

  const lost = cam.drops.filter((d) => LOST_DROP_REASONS.has(d.why)).length;
  const denom = cam.cueCount + lost;
  readings.push(
    denom === 0
      ? { metric: "staleDropRate", value: null, score: null, weight: 0.15, band: B.staleDropRate, note: "no cue and no drop" }
      : read("staleDropRate", lost / denom, 0.15, B.staleDropRate, `${lost} cue(s) dropped (stale or unstageable) against ${cam.cueCount} shown: ${round1((lost / denom) * 100)}% of everything the director queued`),
  );

  return groupOf("camera", readings, { cues: cam.cues.length, allCues: cam.cueCount, lost, drops: cam.drops.length, shotOnSpeaker: sos, roomCuts: cam.roomCuts, shots: Object.fromEntries(shots) });
}
