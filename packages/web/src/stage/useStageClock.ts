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

export type StageClock = {
  index: number;
  beat: StageBeat | undefined;
  playing: boolean;
  /** Beats waiting behind the one on stage. */
  behind: number;
  atEnd: boolean;
  play: () => void;
  pause: () => void;
  seek: (index: number) => void;
  step: (delta: number) => void;
};

export function useStageClock(beats: readonly StageBeat[], speed = 1): StageClock {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  // When the beat currently on stage began, so a beat that has already been up
  // for a while is not given a second full hold when the next one lands.
  const startedAt = useRef(Date.now());

  const bounded = Math.min(index, Math.max(0, beats.length - 1));
  const beat = beats[bounded];
  const atEnd = bounded >= beats.length - 1;

  useEffect(() => {
    if (!playing || !beat || atEnd) return;
    const held = (Date.now() - startedAt.current) / 1000;
    const remaining = Math.max(0, beat.duration / speed - held);
    const timer = setTimeout(() => {
      startedAt.current = Date.now();
      setIndex((i) => i + 1);
    }, remaining * 1000);
    return () => clearTimeout(timer);
  }, [playing, beat, atEnd, speed, beats.length]);

  const seek = useCallback((next: number) => {
    startedAt.current = Date.now();
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
    startedAt.current = Date.now();
    setPlaying(true);
  }, []);

  return {
    index: bounded,
    beat,
    playing,
    behind: Math.max(0, beats.length - 1 - bounded),
    atEnd,
    play,
    pause: () => setPlaying(false),
    seek,
    step,
  };
}
