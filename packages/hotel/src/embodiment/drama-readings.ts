import type { ActVerb } from "@perfectman/shared";

/**
 * The emotion-to-body readings of verb-bible 4.2 to 4.5, as data. The sources give structure and no numbers (bible 4.5:
 * "starting seeds, stored as data and tuned"), so every threshold here is a seed: change it here, not in the rules.
 */

/** Volition a solo verb needs before the planner plays it (the verb's drivers are in `emotion-body.ts`). */
export const SOLO_THETA: Partial<Record<ActVerb, number>> = {
  storm_off: 0.7,
  cry: 0.8,
  faint: 0.85,
  turn_back: 0.6,
  recoil: 0.7,
  freeze_gasp: 0.7,
  tend_fallen: 0.6,
  restrain: 0.6,
  tableau: 0.6,
};

/** A solo verb is not played again by the planner for this long (the contract has no cooldown for them; this is taste). */
export const SOLO_COOLDOWN_MS: Partial<Record<ActVerb, number>> = {
  storm_off: 120_000,
  cry: 90_000,
  faint: 300_000,
  turn_back: 60_000,
  recoil: 20_000,
  freeze_gasp: 30_000,
  tend_fallen: 20_000,
  restrain: 20_000,
  tableau: 60_000,
};

/** The volition a posture or approach stance needs (verb-bible 4.2). */
export const STANCE_THETA = 0.6;
/** `act.strategicPatience` raises every escalation threshold by up to this much (bible 4.5); `impulsiveProvocation` lowers it. */
export const PATIENCE_RAISE = 0.15;
export const IMPULSE_LOWER = 0.15;
/** Rising arousal or worsening valence lowers the thresholds, falling or improving raises them (bible 4.4): gain and cap, per momentum. */
export const MOMENTUM_GAIN = 0.5;
export const MOMENTUM_MAX = 0.1;
/** Below this stability the anti-jitter reversal lock does not hold (bible 4.4: "low stability loosens the anti-jitter lock"). */
export const LOOSE_STABILITY = 0.3;
/** The mood face shows when the circumplex radius is at least this. */
export const MOOD_FACE_RADIUS = 0.6;
/** Grievance: `rel.resentment` at or above this, `rel.trust` at or below this, or the social resentment itself (bible 4.5). */
export const GRIEVANCE_RESENTMENT = 0.5;
export const GRIEVANCE_TRUST = -0.5;
/** Without a grievance the cold social emotions count for this much of themselves when they drive `turn_back`. */
export const NO_GRIEVANCE_FACTOR = 0.8;
/** `turn_back` is held this long, so the face rule does not turn the actor round (bible 3.4: hold 2000 to 5000). */
export const TURN_BACK_HOLD_MS = 5000;
/** `act.anxiousOverreach` cuts the acquaintance time before an initiative hug or kiss by up to this fraction. */
export const ANXIOUS_ACQUAINT_CUT = 0.6;
/** Jealousy alternates `angry` and `sad` on this period (bible 4.2). */
export const JEALOUS_ALTERNATE_MS = 4000;
/** Distances the stances keep, in tiles (bible 4.2). */
export const ENVY_KEEP = 3;
export const SUSPICION_KEEP = 4;
export const EDGE_OF_GROUP = 4;
