import { faceFor, emotionLabel } from "./avatar.js";
import type { RecordedEmotion, VideoStoryboard } from "./types.js";

type Mood = "calm" | "tension" | "warmth";
export type AudioCue = {
  id: string; file: string; start: number; duration: number; mediaStart: number;
  volume: number; fadeIn: number; fadeOut: number; kind: "music" | "sfx";
  mood?: Mood; reason?: string;
};
// Measured integrated LUFS, matched to an understated -28 LUFS bed.
const beds = {
  calm: { file: "calm-social.mp3", duration: 220.05551, lufs: -11.69 },
  tension: { file: "tension-conflict.mp3", duration: 192.052245, lufs: -24.75 },
  warmth: { file: "warmth-relief.mp3", duration: 214.360816, lufs: -17.72 },
};
const crossfade = 2;
const minimumMoodHold = 8;

function moodFor(emotion: RecordedEmotion): Mood {
  const labels = [emotion.label, ...emotion.drivers ?? []].filter(Boolean)
    .map(label => label!.toLowerCase().replaceAll("_", "").trim());
  if (labels.some(label => ["conflict", "fear", "fearofexclusion"].includes(label))) return "tension";
  if (labels.some(label => ["affection", "warmth", "relief"].includes(label))) return "warmth";
  const face = faceFor(emotion);
  return face === "angry" || face === "worried" ? "tension" : face === "smile" ? "warmth" : "calm";
}

/** Music illustrates explicit cues. Missing cues hold the score; unknown cues select calm. */
export function planSoundtrack(storyboard: VideoStoryboard): AudioCue[] {
  const end = storyboard.duration;
  if (!Number.isFinite(end) || end <= 0) throw new Error("Soundtrack duration must be finite and positive");
  const changes = [{ start: 0, mood: "calm" as Mood, reason: "Editorial calm baseline; no emotional cue recorded yet." }];
  let desired: Mood = "calm", reason = changes[0]!.reason, switchedAt = -Infinity;
  let previousStart = -Infinity;
  for (const beat of storyboard.beats) {
    if (!Number.isFinite(beat.start) || beat.start < 0 || beat.start < previousStart || beat.start >= end) {
      throw new Error("Soundtrack beats must have ordered starts inside the composition");
    }
    previousStart = beat.start;
    if (beat.pageIndex === 0 && beat.emotion) {
      desired = moodFor(beat.emotion);
      reason = `Editorial ${desired} from ${emotionLabel(beat.emotion)} at step ${beat.stepIndex + 1}; no dialogue or salience inference.`;
    }
    if (desired !== changes.at(-1)!.mood && beat.start - switchedAt >= minimumMoodHold) {
      changes.push({ start: beat.start, mood: desired, reason });
      switchedAt = beat.start;
    }
  }
  const cues: AudioCue[] = [];
  changes.forEach((change, index) => {
    const boundary = changes[index + 1]?.start ?? end;
    if (boundary <= change.start) return;
    const stop = Math.min(end, boundary + (index + 1 < changes.length ? crossfade : 0));
    const bed = beds[change.mood];
    for (let start = change.start; start < stop;) {
      if (cues.length >= 10000) throw new Error("Soundtrack exceeds 10,000 segments; split this run into episodes");
      const duration = Math.min(bed.duration, stop - start);
      const fade = Math.min(crossfade, duration / 2);
      cues.push({ id: `music-${cues.length}`, file: bed.file, start, duration, mediaStart: 0,
        volume: 10 ** ((-28 - bed.lufs) / 20), fadeIn: fade, fadeOut: fade,
        kind: "music", mood: change.mood, reason: change.reason });
      if (start + duration >= stop) break;
      start += duration - crossfade;
    }
  });
  for (const beat of storyboard.beats) {
    if (beat.pageIndex !== 0) continue;
    const sounds: Array<{ file: string; duration: number; reason: string }> = [];
    if (beat.kind === "message") sounds.push({ file: "message.ogg", duration: .100023, reason: "First page of a recorded or authored message." });
    if (beat.stageAction?.kind === "arrive") sounds.push({ file: "arrival.ogg", duration: .539002, reason: "Explicit arrival stage action." });
    if (beat.stageAction?.kind === "leave") sounds.push({ file: "departure.ogg", duration: .147778, reason: "Explicit departure stage action." });
    for (const sound of sounds) {
      const start = beat.start + .15, duration = Math.min(sound.duration, end - start);
      if (duration <= 0) continue;
      cues.push({ ...sound, id: `sfx-${cues.length}`, start, duration, mediaStart: 0,
        volume: .13, fadeIn: Math.min(.008, duration / 2), fadeOut: Math.min(.025, duration / 2), kind: "sfx" });
    }
  }
  return cues.sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

/** Volume automation is absolute in HyperFrames; plateau values include the base gain. */
export function renderSoundtrack(cues: AudioCue[]): string {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return cues.map((cue, index) => {
    if (!/^[a-z0-9-]+\.(mp3|ogg)$/.test(cue.file) || !/^[a-z0-9-]+$/.test(cue.id)) throw new Error("Invalid audio cue filename or ID");
    if (![cue.start, cue.duration, cue.mediaStart, cue.volume, cue.fadeIn, cue.fadeOut].every(Number.isFinite)
      || cue.start < 0 || cue.duration <= 0 || cue.mediaStart < 0 || cue.volume < 0 || cue.volume > 1
      || cue.fadeIn < 0 || cue.fadeOut < 0 || cue.fadeIn + cue.fadeOut > cue.duration + 1e-9) throw new Error("Invalid audio cue timing or gain");
    const points = [
      { t: 0, v: cue.fadeIn ? 0 : cue.volume }, { t: cue.fadeIn, v: cue.volume },
      { t: cue.duration - cue.fadeOut, v: cue.volume }, { t: cue.duration, v: cue.fadeOut ? 0 : cue.volume },
    ].filter((point, i, all) => i === 0 || point.t !== all[i - 1]!.t);
    const automation = escape(JSON.stringify({ version: 1, lanes: [{ target: "volume", points }] }));
    return `<audio id="${cue.id}" src="assets/audio/${cue.file}" data-start="${cue.start}" data-duration="${cue.duration}" data-media-start="${cue.mediaStart}" data-volume="${cue.volume}" data-track-index="${index + 1}" data-automation="${automation}"></audio>`;
  }).join("\n");
}

export const AUDIO_CREDITS = `Music: "Wallpaper", "Long Note Three", and "Dream Culture" by Kevin MacLeod (incompetech.com), CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Complete tracks re-encoded to 128 kbps stereo MP3 and mixed with fades. Interface sounds by Kenney (https://kenney.nl/assets/interface-sounds), CC0. Full credits and source links: assets/audio/ATTRIBUTION.md.`;
