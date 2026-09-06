/**
 * The soundtrack, following the room.
 *
 * The MP4 path plans every cue before rendering. Live cannot, so this keeps the
 * two halves that matter: the same mood rule (so the music and the faces can
 * never disagree) and the same eight-second hold (so a room whose emotion
 * oscillates does not turn the score into a stutter).
 *
 * Beds loop and crossfade; the volume per bed comes from its measured LUFS, so
 * all three sit at the same level under the dialogue rather than one jumping
 * out. Sound starts on because pressing Run is the gesture browsers want, and a
 * silent first run means nobody finds out it exists. If the browser refuses
 * anyway the toggle flips back rather than claiming to be playing.
 */
import { useEffect, useRef, useState } from "react";
import {
  BEDS,
  CROSSFADE_SECONDS,
  MINIMUM_MOOD_HOLD_SECONDS,
  SFX,
  SFX_VOLUME,
  bedVolume,
  moodFor,
  type Mood,
  type StageBeat,
} from "@perfectman/shared";

const MUTED_KEY = "perfectman.sound.muted";
const AUDIO_BASE = "/audio";

export function useSoundtrack(beat: StageBeat | undefined, active: boolean) {
  const [muted, setMuted] = useState(() => readMuted());
  const beds = useRef<Partial<Record<Mood, HTMLAudioElement>>>({});
  const mood = useRef<Mood>("calm");
  const changedAt = useRef(0);
  const lastBeatId = useRef<string | undefined>(undefined);

  // One element per bed, created once and reused. Looping in the element beats
  // re-scheduling: the beds are minutes long and a run rarely outlasts one.
  useEffect(() => {
    for (const [key, bed] of Object.entries(BEDS)) {
      const audio = new Audio(`${AUDIO_BASE}/${bed.file}`);
      audio.loop = true;
      audio.volume = 0;
      beds.current[key as Mood] = audio;
    }
    const created = beds.current;
    return () => {
      for (const audio of Object.values(created)) {
        audio.pause();
        audio.src = "";
      }
      beds.current = {};
    };
  }, []);

  useEffect(() => {
    const wanted = active && !muted;
    for (const [key, audio] of Object.entries(beds.current)) {
      const target = key === mood.current && wanted ? bedVolume(key as Mood) : 0;
      fade(audio, target);
      if (target > 0 && audio.paused) {
        void audio.play().catch(() => {
          // Autoplay refused, or the file is missing. Say so by flipping the
          // control rather than leaving it claiming to play.
          setMuted(true);
          writeMuted(true);
        });
      }
      if (target === 0 && !audio.paused && !wanted) audio.pause();
    }
  }, [muted, active]);

  useEffect(() => {
    if (!beat || beat.id === lastBeatId.current) return;
    lastBeatId.current = beat.id;

    const now = Date.now() / 1000;
    const next = moodFor(beat.emotion);
    if (next !== mood.current && now - changedAt.current >= MINIMUM_MOOD_HOLD_SECONDS) {
      const leaving = beds.current[mood.current];
      if (leaving) fade(leaving, 0);
      mood.current = next;
      changedAt.current = now;
      const arriving = beds.current[next];
      if (arriving && active && !muted) {
        fade(arriving, bedVolume(next));
        void arriving.play().catch(() => undefined);
      }
    }

    if (!muted && active) {
      const cue = beat.stageAction?.kind === "leave" ? SFX.departure : beat.stageAction ? SFX.arrival : beat.kind === "message" ? SFX.message : null;
      if (cue) {
        const sfx = new Audio(`${AUDIO_BASE}/${cue}`);
        sfx.volume = SFX_VOLUME;
        void sfx.play().catch(() => undefined);
      }
    }
  }, [beat, muted, active]);

  return {
    muted,
    toggle: () => {
      setMuted((was) => {
        writeMuted(!was);
        return !was;
      });
    },
  };
}

/** Linear ramp over the same crossfade the rendered soundtrack uses. */
function fade(audio: HTMLAudioElement, to: number): void {
  const from = audio.volume;
  if (Math.abs(from - to) < 0.001) return;
  const started = performance.now();
  const tick = (): void => {
    const t = Math.min(1, (performance.now() - started) / (CROSSFADE_SECONDS * 1000));
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t < 1) requestAnimationFrame(tick);
    else if (to === 0) audio.pause();
  };
  requestAnimationFrame(tick);
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeMuted(value: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, value ? "1" : "0");
  } catch {
    // Preference is not important enough to surface a failure for.
  }
}
