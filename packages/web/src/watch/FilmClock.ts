/**
 * The film's clock: a time, a speed, and a playing flag. No timers, so it is
 * trivial to test; the player calls `tick` with the time since the last frame.
 */
export type FilmSpeed = 1 | 2 | 4;

export class FilmClock {
  t = 0;
  playing = false;
  speed: FilmSpeed = 1;

  constructor(public duration: number) {}

  /** Advance by `dt` real seconds. Returns true if the film just ended. */
  tick(dt: number): boolean {
    if (!this.playing) return false;
    // A tab that was in the background must not leap: a long gap counts as one frame.
    this.t = Math.min(this.duration, this.t + Math.min(dt, 0.1) * this.speed);
    if (this.t >= this.duration) { this.playing = false; return true; }
    return false;
  }

  seek(t: number): void {
    this.t = Math.max(0, Math.min(this.duration, t));
  }

  /** Starts, pauses, or restarts from the top if the film has ended. */
  toggle(): void {
    if (!this.playing && this.t >= this.duration) this.t = 0;
    this.playing = !this.playing;
  }

  /**
   * A run that is still going grew: the film is longer, and the viewer stays exactly
   * where they were. If they had caught up with the end, they carry on into the new part.
   */
  extend(duration: number): void {
    const caughtUp = this.t >= this.duration - 0.05;
    this.duration = duration;
    if (caughtUp && duration > this.t + 0.05) this.playing = true;
  }

  /** Swap in a new timeline of a different length, keeping the same place in the story. */
  retime(duration: number): void {
    const fraction = this.duration > 0 ? this.t / this.duration : 0;
    this.duration = duration;
    this.t = fraction * duration;
  }
}
