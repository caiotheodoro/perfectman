/**
 * The music for a stretch of mood changes: each mood has several tracks, the next
 * one begins when a track ends, and a mood that returns later gets a different
 * track, so a long video does not repeat one piece. The first track of each mood
 * depends on `seed` (the video's title), so the same video always sounds the same.
 */
import { bedVolume, playlist, type Mood } from "@perfectman/shared";
import type { AudioCue } from "./soundtrack.js";

const CROSSFADE = 2;

export type MoodChange = { start: number; mood: Mood; reason: string };

export function planMusic(changes: MoodChange[], end: number, seed: string): AudioCue[] {
  const cues: AudioCue[] = [];
  const turn: Record<Mood, number> = { calm: 0, tension: 0, warmth: 0 };
  const heard = new Set<Mood>();
  changes.forEach((change, index) => {
    const boundary = changes[index + 1]?.start ?? end;
    if (boundary <= change.start) return;
    const stop = Math.min(end, boundary + (index + 1 < changes.length ? CROSSFADE : 0));
    if (heard.has(change.mood)) turn[change.mood] += 1;
    heard.add(change.mood);
    const tracks = playlist(change.mood, seed);
    for (let start = change.start; start < stop;) {
      if (cues.length >= 10000) throw new Error("Soundtrack exceeds 10,000 segments; split this run into episodes");
      const bed = tracks[turn[change.mood] % tracks.length]!;
      const duration = Math.min(bed.duration, stop - start);
      const fade = Math.min(CROSSFADE, duration / 2);
      cues.push({ id: `music-${cues.length}`, file: bed.file, start, duration, mediaStart: 0, volume: bedVolume(bed), fadeIn: fade, fadeOut: fade, kind: "music", mood: change.mood, reason: change.reason });
      if (start + duration >= stop) break;
      turn[change.mood] += 1;
      start += duration - CROSSFADE;
    }
  });
  return cues;
}
