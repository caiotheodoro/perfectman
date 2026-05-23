/** Clamp value to [min, max] */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Linear interpolation */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

/** Angular distance between two angles in radians, shortest path */
export function angularDistance(a: number, b: number): number {
  let diff = ((b - a) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  if (diff > Math.PI) diff -= 2 * Math.PI;
  return Math.abs(diff);
}

/** Angular interpolation (shortest path) */
export function angularLerp(current: number, target: number, t: number): number {
  let diff = ((target - current) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  if (diff > Math.PI) diff -= 2 * Math.PI;
  return current + diff * clamp(t, 0, 1);
}

/** Damped spring step: moves current toward target with inertia */
export function dampedSpring(
  current: number,
  target: number,
  inertia: number,
  dt: number,
): number {
  return current + (target - current) * clamp(inertia * dt, 0, 1);
}

/** Mean of an array of numbers. Returns 0 for empty array. */
export function meanOf(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Valence and arousal from circumplex angle + radius */
export function circumplexToVA(
  angle: number,
  radius: number,
): { valence: number; arousal: number } {
  return {
    valence: Math.cos(angle) * radius,
    arousal: (Math.sin(angle) + 1) / 2,
  };
}

/** Circumplex angle from valence + arousal */
export function vaToCircumplexAngle(valence: number, arousal: number): number {
  // arousal maps [0,1] → [-1,1] for sin
  const a = arousal * 2 - 1;
  return Math.atan2(a, valence);
}
