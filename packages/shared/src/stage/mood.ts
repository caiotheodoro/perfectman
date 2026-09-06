/**
 * Which bed plays, and when it is allowed to change.
 *
 * Ported from `packages/eval/src/video/soundtrack.ts`. The MP4 path plans a
 * whole timeline up front; a live run cannot, so only the selection rule and
 * the hold moves here. The rule itself is unchanged: an explicit emotion label
 * or driver wins, and everything else falls through to the same face the figure
 * is already wearing, so the music and the expression never disagree.
 *
 * The measured LUFS values are why the beds sit under dialogue instead of over
 * it. Each is scaled to a common −28 LUFS floor; changing a file means
 * re-measuring, not guessing a volume.
 */
import { faceFor, type RecordedEmotion } from "./emotion-face.js";

export type Mood = "calm" | "tension" | "warmth";

export type Bed = {
  file: string;
  /** Seconds. Beds are shorter than most runs, so they loop. */
  duration: number;
  lufs: number;
};

export const BEDS: Record<Mood, Bed> = {
  calm: { file: "calm-social.mp3", duration: 220.05551, lufs: -11.69 },
  tension: { file: "tension-conflict.mp3", duration: 192.052245, lufs: -24.75 },
  warmth: { file: "warmth-relief.mp3", duration: 214.360816, lufs: -17.72 },
};

export const SFX = {
  message: "message.ogg",
  arrival: "arrival.ogg",
  departure: "departure.ogg",
} as const;

const TARGET_LUFS = -28;
export const CROSSFADE_SECONDS = 2;
/** A bed that flips every other line is worse than no music at all. */
export const MINIMUM_MOOD_HOLD_SECONDS = 8;
export const SFX_VOLUME = 0.13;

/** Playback gain that brings a bed down to the shared floor. */
export function bedVolume(mood: Mood): number {
  return 10 ** ((TARGET_LUFS - BEDS[mood].lufs) / 20);
}

export function moodFor(emotion?: RecordedEmotion): Mood {
  if (!emotion) return "calm";
  const labels = [emotion.label, ...(emotion.drivers ?? [])]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase().replaceAll("_", "").trim());

  if (labels.some((l) => ["conflict", "fear", "fearofexclusion"].includes(l))) return "tension";
  if (labels.some((l) => ["affection", "warmth", "relief"].includes(l))) return "warmth";

  const face = faceFor(emotion);
  if (face === "angry" || face === "worried") return "tension";
  if (face === "smile") return "warmth";
  return "calm";
}

/**
 * Whether a mood change is allowed yet. The hold is what stops a room whose
 * emotion oscillates from turning the soundtrack into a stutter.
 */
export function canChangeMood(lastChangeSeconds: number, nowSeconds: number): boolean {
  return nowSeconds - lastChangeSeconds >= MINIMUM_MOOD_HOLD_SECONDS;
}
