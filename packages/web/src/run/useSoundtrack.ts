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
 * out. Sound starts on because pressing Run is the gesture browsers want — and
 * `unlock` has to be called inside that click, because Safari only lets an
 * element play later if it was played once during a gesture. If the browser
 * refuses anyway the toggle flips back rather than claiming to be playing; the
 * refusal is not saved, because a missing file today should not mute every
 * run tomorrow. Only the reader's own toggle persists.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BEDS,
  CROSSFADE_SECONDS,
  SFX,
  SFX_VOLUME,
  bedVolume,
  canChangeMood,
  moodFor,
  type Mood,
  type StageBeat,
} from "@perfectman/shared";
import { sfxCueFor } from "./sfx-cue.js";

const MUTED_KEY = "perfectman.sound.muted";
const AUDIO_BASE = "/audio";

type Cue = keyof typeof SFX;

export function useSoundtrack(beat: StageBeat | undefined, active: boolean, playing: boolean) {
  const [muted, setMuted] = useState(() => readMuted());
  const beds = useRef<Partial<Record<Mood, HTMLAudioElement>>>({});
  const cues = useRef<Partial<Record<Cue, HTMLAudioElement>>>({});
  const mood = useRef<Mood>("calm");
  const changedAt = useRef(0);
  const lastBeatId = useRef<string | undefined>(undefined);
  // iOS ignores writes to an element's volume, which makes the LUFS levelling
  // and the crossfade no-ops and would play a bed at full level over the
  // dialogue. Better no bed than that; the cues still play.
  const volumeLocked = useRef(false);
  const wantBeds = useRef(false);

  // One element per bed and per cue, created once and reused. Looping in the
  // element beats re-scheduling: the beds are minutes long and a run rarely
  // outlasts one. Cues are pre-created so `unlock` can reach them too.
  useEffect(() => {
    const probe = new Audio();
    probe.volume = 0.5;
    volumeLocked.current = probe.volume !== 0.5;

    for (const [key, bed] of Object.entries(BEDS)) {
      const audio = new Audio(`${AUDIO_BASE}/${bed.file}`);
      audio.loop = true;
      audio.volume = 0;
      audio.preload = "auto";
      beds.current[key as Mood] = audio;
    }
    for (const [key, file] of Object.entries(SFX)) {
      const audio = new Audio(`${AUDIO_BASE}/${file}`);
      audio.volume = SFX_VOLUME;
      audio.preload = "auto";
      cues.current[key as Cue] = audio;
    }
    const created = [...Object.values(beds.current), ...Object.values(cues.current)];
    return () => {
      for (const audio of created) {
        audio.pause();
        audio.src = "";
      }
      beds.current = {};
      cues.current = {};
    };
  }, []);

  wantBeds.current = active && !muted && !volumeLocked.current;

  // A refusal to play is shown, not stored: the control stops claiming sound
  // that is not there, and the next run gets to try again. An interrupted
  // play() is not a refusal — unlock pauses elements on purpose.
  const start = useCallback((audio: HTMLAudioElement) => {
    void audio.play().catch((error: unknown) => {
      if (isPlaybackRefusal(error)) setMuted(true);
    });
  }, []);

  useEffect(() => {
    const on = wantBeds.current;
    if (muted || !active) {
      for (const audio of Object.values(cues.current)) audio.pause();
    }
    for (const [key, audio] of Object.entries(beds.current)) {
      const target = key === mood.current && on ? bedVolume(key as Mood) : 0;
      fade(audio, target);
      if (target > 0 && audio.paused) start(audio);
      if (target === 0 && !audio.paused && !on) audio.pause();
    }
  }, [muted, active, start]);

  useEffect(() => {
    if (!beat) return;

    const now = Date.now() / 1000;
    const next = moodFor(beat.emotion);
    if (next !== mood.current && canChangeMood(changedAt.current, now)) {
      const leaving = beds.current[mood.current];
      if (leaving) fade(leaving, 0);
      mood.current = next;
      changedAt.current = now;
      const arriving = beds.current[next];
      if (arriving && wantBeds.current) {
        fade(arriving, bedVolume(next));
        if (arriving.paused) start(arriving);
      }
    }

    // Recorded emotion can arrive after the line. Revisit its bed without
    // replaying the one-shot cue for the same beat.
    if (beat.id === lastBeatId.current) return;
    lastBeatId.current = beat.id;

    // Cues only while the run is playing itself: stepping through beats by
    // hand should not click.
    if (muted || !active || !playing) return;
    const cue = sfxCueFor(beat);
    const sfx = cue ? cues.current[cue] : undefined;
    if (sfx) {
      sfx.currentTime = 0;
      void sfx.play().catch(() => undefined);
    }
  }, [beat, muted, active, playing, start]);

  /**
   * Call inside the click that starts the run. Plays and immediately pauses
   * every element at zero volume, which is what Safari and iOS need before an
   * element may play on its own later. Harmless elsewhere. Called even when
   * muted, so a later "Sound on" works.
   */
  const unlock = useCallback(() => {
    for (const [key, audio] of Object.entries(beds.current)) {
      void audio
        .play()
        .then(() => {
          // Unless, by the time this settles, this bed is the one that should
          // be playing anyway.
          if (!(wantBeds.current && key === mood.current)) audio.pause();
        })
        .catch(() => undefined);
    }
    for (const audio of Object.values(cues.current)) {
      const level = audio.volume;
      audio.volume = 0;
      void audio
        .play()
        .then(() => {
          audio.pause();
          audio.currentTime = 0;
        })
        .catch(() => undefined)
        .finally(() => {
          audio.volume = level;
        });
    }
  }, []);

  return {
    muted,
    unlock,
    toggle: () => {
      setMuted((was) => {
        writeMuted(!was);
        return !was;
      });
    },
  };
}

/**
 * Whether a rejected play() means the browser said no. Autoplay policy and an
 * unplayable file are refusals. An AbortError is a play() interrupted by a
 * pause() — which `unlock` does deliberately while a bed may already be
 * starting — and means nothing about whether sound is allowed.
 */
export function isPlaybackRefusal(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  return name === "NotAllowedError" || name === "NotSupportedError";
}

/** Whatever fade is running on an element; a new target cancels it. */
const fades = new WeakMap<HTMLAudioElement, number>();

/** Linear ramp over the same crossfade the rendered soundtrack uses. */
function fade(audio: HTMLAudioElement, to: number): void {
  const running = fades.get(audio);
  if (running !== undefined) {
    cancelAnimationFrame(running);
    fades.delete(audio);
  }
  const from = audio.volume;
  if (Math.abs(from - to) < 0.001) return;
  const started = performance.now();
  const tick = (): void => {
    const t = Math.min(1, (performance.now() - started) / (CROSSFADE_SECONDS * 1000));
    audio.volume = Math.max(0, Math.min(1, from + (to - from) * t));
    if (t < 1) {
      fades.set(audio, requestAnimationFrame(tick));
    } else {
      fades.delete(audio);
      if (to === 0) audio.pause();
    }
  };
  fades.set(audio, requestAnimationFrame(tick));
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
