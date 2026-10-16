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
  title: string;
  /** Seconds. */
  duration: number;
  lufs: number;
};

/**
 * Several tracks for every mood, so a run does not hear the same piece all the way through.
 * Chosen to sit under dialogue: unhurried, few attacks a second, no big swells in loudness.
 * The loudness figures are measured on the encoded files; re-measure when a file changes.
 */
export const LIBRARY: Record<Mood, Bed[]> = {
  calm: [
    { file: "calm-bossa-antigua.mp3", title: "Bossa Antigua", duration: 283.350204, lufs: -22.1 },
    { file: "calm-easy-lemon.mp3", title: "Easy Lemon", duration: 126.380408, lufs: -16.2 },
    { file: "calm-deliberate-thought.mp3", title: "Deliberate Thought", duration: 177.455986, lufs: -18.2 },
    { file: "calm-windswept.mp3", title: "Windswept", duration: 208.344014, lufs: -16.6 },
  ],
  tension: [
    { file: "tension-sneaky-snitch.mp3", title: "Sneaky Snitch", duration: 136.620408, lufs: -17.9 },
    { file: "tension-marty-gots-a-plan.mp3", title: "Marty Gots a Plan", duration: 168.071837, lufs: -22.3 },
    { file: "tension-investigations.mp3", title: "Investigations", duration: 93.54449, lufs: -19.1 },
    { file: "tension-hidden-agenda.mp3", title: "Hidden Agenda", duration: 135.048005, lufs: -22.1 },
  ],
  warmth: [
    { file: "warmth-sincerely.mp3", title: "Sincerely", duration: 240.0, lufs: -13.6 },
    { file: "warmth-gymnopedie-no-1.mp3", title: "Gymnopedie No 1", duration: 187.08898, lufs: -20.4 },
    { file: "warmth-dream-culture.mp3", title: "Dream Culture", duration: 214.360816, lufs: -17.7 },
    { file: "warmth-teddy-bear-waltz.mp3", title: "Teddy Bear Waltz", duration: 195.265306, lufs: -17.1 },
  ],
};

/** The first track of each mood, for callers that want a single bed. */
export const BEDS: Record<Mood, Bed> = {
  calm: LIBRARY.calm[0]!,
  tension: LIBRARY.tension[0]!,
  warmth: LIBRARY.warmth[0]!,
};

/** A small stable hash, so a run picks the same tracks every time it is played. */
export function seedOffset(seed: string, n: number): number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return n > 0 ? (h >>> 0) % n : 0;
}

/** The mood's tracks in the order this run will hear them, starting somewhere different for different runs. */
export function playlist(mood: Mood, seed: string): Bed[] {
  const tracks = LIBRARY[mood];
  const start = seedOffset(`${mood}:${seed}`, tracks.length);
  return [...tracks.slice(start), ...tracks.slice(0, start)];
}

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
export function bedVolume(bed: Mood | Bed): number {
  const lufs = typeof bed === "string" ? BEDS[bed].lufs : bed.lufs;
  return 10 ** ((TARGET_LUFS - lufs) / 20);
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
