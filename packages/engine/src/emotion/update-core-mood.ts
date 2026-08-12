import type { CoreMood, MoodImpulse, PersonaConfig } from "@perfectman/shared";
import { clamp, dampedSpring, vaToCircumplexAngle } from "@perfectman/shared";

const STABILITY_FLOOR = 0.1;
const SHOCK_THRESHOLD = 0.6; // impulse magnitude above which shock override applies

/**
 * Update L1 CoreMood given impulses, persona, and elapsed time.
 *
 * 5 steps:
 *   1. Apply shock override for high-magnitude impulses
 *   2. Damped spring toward baseline (moodInertia controls spring stiffness)
 *   3. Apply accumulated impulses with reactivity scaling
 *   4. Angular constraint (maxMoodRotation per dt)
 *   5. Energy regen toward 1.0; stability floor clamping
 */
export function updateCoreMood(
  current: CoreMood,
  impulses: MoodImpulse[],
  persona: PersonaConfig,
  dt: number,
): CoreMood {
  let valence = current.valence;
  let arousal = current.arousal;
  let stability = current.stability;
  let energy = current.energy;
  let momentumValence = current.momentumValence;
  let momentumArousal = current.momentumArousal;

  // Step 1: Damped spring toward baseline.
  // NOTE: personas document moodInertia as "high inertia = slow river"
  // (Mariana 0.8 barely moves; Goulart 0.25 swings fast). The spring's
  // pull-back must therefore be LARGER for LOW inertia: pull = (1-inertia).
  // With the previous `inertia * dt` formula the semantics were inverted
  // AND dt≈0 in fast bench runs → moods pinned at the clamps forever.
  const pullK = (1 - persona.moodInertia) * 0.18;
  valence = dampedSpring(valence, persona.baselineValence, pullK, dt);
  arousal = dampedSpring(arousal, persona.baselineArousal, pullK, dt);
  stability = dampedSpring(stability, persona.baselineStability, pullK * 0.5, dt);
  energy = dampedSpring(energy, persona.baselineEnergy, pullK * 0.3, dt);

  // Step 2: Energy regen toward baseline
  energy = clamp(energy + persona.energyRegen * dt, 0, 1);

  // Step 3: Apply impulses — with a per-pulse ceiling. A single pulse must
  // not swing mood to the clamps ("moving 30 degrees is natural drift").
  const MAX_DELTA_V_PER_PULSE = 0.3;
  const MAX_DELTA_A_PER_PULSE = 0.25;
  let totalDeltaV = 0;
  let totalDeltaA = 0;

  for (const impulse of impulses) {
    const scale = impulse.magnitude * persona.emotionalReactivity;
    totalDeltaV += impulse.deltaValence * scale;
    totalDeltaA += impulse.deltaArousal * scale;

    // Shock override: large impulse drops stability
    if (impulse.magnitude >= SHOCK_THRESHOLD) {
      stability -= impulse.magnitude * 0.3;
    }
  }
  totalDeltaV = clamp(totalDeltaV, -MAX_DELTA_V_PER_PULSE, MAX_DELTA_V_PER_PULSE);
  totalDeltaA = clamp(totalDeltaA, -MAX_DELTA_A_PER_PULSE, MAX_DELTA_A_PER_PULSE);

  // Momentum accumulates but decays
  const MOMENTUM_DECAY = 0.75;
  momentumValence = momentumValence * MOMENTUM_DECAY + totalDeltaV * 0.3;
  momentumArousal = momentumArousal * MOMENTUM_DECAY + totalDeltaA * 0.3;

  valence += totalDeltaV + momentumValence * 0.1;
  arousal += totalDeltaA + momentumArousal * 0.1;

  // Step 4: Angular constraint — limit rotation per dt
  const oldAngle = current.circumplexAngle;
  const newAngle = vaToCircumplexAngle(valence, arousal);
  const maxRotation = persona.maxMoodRotation * dt;
  let angleDelta = newAngle - oldAngle;
  // Normalize angle delta to [-π, π]
  while (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
  while (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;
  const clampedDelta = clamp(angleDelta, -maxRotation, maxRotation);
  const constrainedAngle = ((oldAngle + clampedDelta) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

  // Step 5: Clamp all values
  valence   = clamp(valence, -1, 1);
  arousal   = clamp(arousal, 0, 1);
  stability = Math.max(STABILITY_FLOOR, clamp(stability, STABILITY_FLOOR, 1));
  energy    = clamp(energy, 0, 1);

  const circumplexRadius = clamp(
    Math.sqrt(valence * valence + (arousal - 0.5) * (arousal - 0.5)),
    0,
    1,
  );

  return {
    valence,
    arousal,
    stability,
    energy,
    circumplexAngle: constrainedAngle,
    circumplexRadius,
    momentumValence: clamp(momentumValence, -0.5, 0.5),
    momentumArousal: clamp(momentumArousal, -0.5, 0.5),
  };
}
