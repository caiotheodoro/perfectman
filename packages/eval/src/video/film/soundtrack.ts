import { BEDS, bedVolume, type Timeline } from "@perfectman/shared";
import type { AudioCue } from "../soundtrack.js";

const CROSSFADE = 2;
const SFX = { message: { file: "message.ogg", duration: 0.100023 }, arrival: { file: "arrival.ogg", duration: 0.539002 }, departure: { file: "departure.ogg", duration: 0.147778 } } as const;

/**
 * Music follows the room's recorded mood (already held for at least eight
 * seconds by the director); a soft pop lands with each message; a door sound
 * marks a pair slipping away and the group coming back together.
 */
export function planFilmSoundtrack(T: Timeline, end: number): AudioCue[] {
  if (!Number.isFinite(end) || end <= 0) throw new Error("Soundtrack duration must be finite and positive");
  const cues: AudioCue[] = [];
  T.moods.forEach((change, i) => {
    const next = T.moods[i + 1];
    const boundary = next ? next.t : end;
    if (boundary <= change.t) return;
    const stop = Math.min(end, boundary + (next ? CROSSFADE : 0));
    const bed = BEDS[change.mood];
    for (let start = change.t; start < stop;) {
      if (cues.length >= 10000) throw new Error("Soundtrack exceeds 10,000 segments; split this run into episodes");
      const duration = Math.min(bed.duration, stop - start);
      const fade = Math.min(CROSSFADE, duration / 2);
      cues.push({ id: `music-${cues.length}`, file: bed.file, start, duration, mediaStart: 0, volume: bedVolume(change.mood), fadeIn: fade, fadeOut: fade, kind: "music", mood: change.mood, reason: `The room's recorded mood reads as ${change.mood}.` });
      if (start + duration >= stop) break;
      start += duration - CROSSFADE;
    }
  });
  const sfx = (kind: keyof typeof SFX, at: number, reason: string): void => {
    const start = at, duration = Math.min(SFX[kind].duration, end - start);
    if (duration <= 0) return;
    cues.push({ id: `sfx-${cues.length}`, file: SFX[kind].file, start, duration, mediaStart: 0, volume: 0.13, fadeIn: Math.min(0.008, duration / 2), fadeOut: Math.min(0.025, duration / 2), kind: "sfx", reason });
  };
  for (const m of T.msgs) sfx("message", m.s0 + 0.05, "A line lands.");
  T.scenes.forEach((s, i) => {
    if (s.type === "huddle") sfx("departure", s.t0 + 0.1, "Two people slip away from the group.");
    else if (i > 0 && T.scenes[i - 1]!.type === "huddle") sfx("arrival", s.t0 + 0.1, "The group comes back together.");
  });
  return cues.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}
