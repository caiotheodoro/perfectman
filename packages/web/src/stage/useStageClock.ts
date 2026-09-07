/**
 * When each beat takes the stage.
 *
 * The MP4 pipeline plans a whole timeline up front from reading time, because a
 * film has an ending before it is rendered. A live run does not: beats appear
 * one pulse at a time, at whatever rate the model manages.
 *
 * So this is a queue, not a timeline. The current beat holds for its reading
 * time and then yields to whatever is next; if nothing is next, the stage
 * simply stays where it is and the figures keep breathing. If the model outruns
 * the reader the queue absorbs it and `behind` says by how much, rather than
 * skipping ahead and hiding that the view is not caught up.
 *
 * Replay is the same machine with the queue already full, which is why seeking
 * needs no second implementation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { StageBeat } from "@perfectman/shared";
import { reducedMotion } from "./motion.js";

export type StageClock = {
  index: number;
  beat: StageBeat | undefined;
  playing: boolean;
  /** Beats waiting behind the one on stage. */
  behind: number;
  /**
   * The furthest beat that has been on stage. Unlike `behind`, seeking back
   * does not lower it: what has been shown has been shown.
   */
  reached: number;
  atEnd: boolean;
  play: () => void;
  pause: () => void;
  seek: (index: number) => void;
  step: (delta: number) => void;
};

export function useStageClock(
  beats: readonly StageBeat[],
  { ready = true, runId = null }: { ready?: boolean; runId?: string | null } = {},
): StageClock {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !reducedMotion());
  // When the beat currently on stage began, so a beat that has already been up
  // for a while is not given a second full hold when the next one lands.
  const shown = useRef<{ id: string; runId: string | null; since: number } | null>(null);
  const [currentRun, setCurrentRun] = useState(runId);

  const bounded = Math.min(index, Math.max(0, beats.length - 1));
  const beat = beats[bounded];
  const atEnd = bounded >= beats.length - 1;
  const [reached, setReached] = useState(0);
  if (currentRun !== runId) {
    setCurrentRun(runId);
    setIndex(0);
    setReached(0);
    setPlaying(!reducedMotion());
  } else if (ready && bounded > reached) setReached(bounded);

  useEffect(() => {
    if (!ready || !playing || !beat) {
      shown.current = null;
      return;
    }
    // Reading time starts when a beat becomes visible, including the first
    // beat after a slow model warms up. Incoming beats do not restart it.
    if (shown.current?.id !== beat.id || shown.current.runId !== runId) {
      shown.current = { id: beat.id, runId, since: Date.now() };
    }
    if (atEnd) return;
    const held = (Date.now() - shown.current.since) / 1000;
    const remaining = Math.max(0, beat.duration - held);
    const timer = setTimeout(() => {
      setIndex((i) => i + 1);
    }, remaining * 1000);
    return () => clearTimeout(timer);
  }, [ready, playing, beat, atEnd, beats.length, runId]);

  const seek = useCallback((next: number) => {
    shown.current = null;
    setIndex(Math.max(0, next));
  }, []);

  const step = useCallback(
    (delta: number) => {
      setPlaying(false);
      seek(Math.min(Math.max(0, bounded + delta), Math.max(0, beats.length - 1)));
    },
    [bounded, beats.length, seek],
  );

  const play = useCallback(() => {
    shown.current = null;
    setPlaying(true);
  }, []);

  return {
    index: bounded,
    beat,
    playing,
    behind: Math.max(0, beats.length - 1 - bounded),
    reached: Math.max(reached, bounded),
    atEnd,
    play,
    pause: () => setPlaying(false),
    seek,
    step,
  };
}
