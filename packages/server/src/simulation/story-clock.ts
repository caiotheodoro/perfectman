/**
 * The scene's wall clock, as the characters would read it.
 *
 * Deliberately separate from `pulseIntervalMs`: that is the simulated clock the
 * emotion math reads and it is bounded to a few seconds per pulse. A scene that
 * unfolds over an evening needs minutes per pulse, and stretching the interval
 * to get them would change every decay curve. This clock is presentation only —
 * it never feeds the engine, it only tells a character what time it is.
 */
export type StoryClockConfig = {
  /** 24-hour "HH:MM" the scene opens at (pulse 0). */
  start: string;
  /** Story minutes that pass between one pulse and the next. */
  minutesPerPulse: number;
};

const START_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export function isValidStoryClockStart(value: string): boolean {
  return START_PATTERN.test(value);
}

/** "11:52pm" for pulse `pulseIndex`; wraps past midnight. */
export function formatStoryClock(clock: StoryClockConfig, pulseIndex: number): string {
  const match = START_PATTERN.exec(clock.start);
  if (!match) return clock.start;
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  const total = Math.round(startMinutes + pulseIndex * clock.minutesPerPulse);
  const dayMinutes = ((total % 1440) + 1440) % 1440;
  const hours24 = Math.floor(dayMinutes / 60);
  const minutes = dayMinutes % 60;
  const suffix = hours24 >= 12 ? "pm" : "am";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, "0")}${suffix}`;
}
