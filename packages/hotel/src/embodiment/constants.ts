/** Seeds (embodiment.md 7.3); calibrate after the first real runs. */
export const FACE_TOLERANCE_DEG = 45;
export const DWELL_POSTURE_MS = 20_000;
export const DWELL_ZONE_MS = 30_000;
export const GESTURE_COOLDOWN_MS = 15_000;
export const SHOUT_COOLDOWN_MS = 60_000;
export const LAUGH_COOLDOWN_MS = 20_000;
export const FIDGET_COOLDOWN_MS = 45_000;
export const CMD_BUDGET = { count: 4, windowMs: 5000 } as const;
/** The hotel's own backstop per actor, `walk` included (lead resolution R10). */
export const HOTEL_BACKSTOP = { count: 8, windowMs: 5000 } as const;
export const SPEAKER_RECENT_MS = 8000;
/** Whoever an actor is talking with stays its interlocutor this long after the last line either way: it keeps facing them. */
export const INTERLOCUTOR_MS = 20_000;
export const WALK_TICK_MS = 300;

/** Distance bands in Chebyshev tiles (embodiment.md 2). */
export const BAND = { intimate: 1, personal: 2, socialMax: 6, publicMax: 12 } as const;
/** Approach when this far or farther, step back when this close: a dead band either side of the targets. */
export const APPROACH_AT = 4;
export const WITHDRAW_AT = 1;

/** A human who dodged or pushed away a pair act is left alone this long (D31). */
export const PAIR_REFUSAL_COOLDOWN_MS = 60_000;
/** At most this many actors head for the same human at once. */
export const MAX_APPROACHERS = 2;
