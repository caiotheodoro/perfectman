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

/** Seats are for using (embodiment.md 7.1, rule 11): an actor that has been on its feet this long sits down if a seat is free. */
export const SIT_EVERY_MS = 150_000;
/** ... and gets up again after this long, when nobody is talking to it. */
export const SIT_STAY_MS = 170_000;
/** Spread per actor so the cast does not sit and stand in unison. */
export const POSTURE_JITTER_MS = 60_000;
/** A seat that was refused (taken, no route) is not tried again for this long. */
export const SEAT_TRY_COOLDOWN_MS = 40_000;
/** How far an actor looks for a free seat. */
export const SEAT_RANGE = 12;

/** Initiative (rule 12): an actor acts on what it feels or wants without being asked, inside these budgets. */
export const INITIATIVE_COOLDOWN_MS = 150_000;
/** A person must have been in the room this long before an actor goes in for a hug or a kiss. */
export const PAIR_ACQUAINTED_MS = 75_000;
/** At most this many initiative pair acts toward one person in a run. */
export const PAIR_TRIES_PER_PERSON = 3;
/** Attraction and comfort that make an actor reach for someone on its own. */
export const REACH_ATTRACTION = 0.55;
export const REACH_COMFORT = 0.45;
/** An errand to another room starts no earlier than this after the actor's first plan, and not again for ERRAND_COOLDOWN_MS. */
export const ERRAND_AFTER_MS = 60_000;
export const ERRAND_COOLDOWN_MS = 600_000;
/** An errand's visit lasts about this long before the actor heads home. */
export const ERRAND_STAY_MS = 70_000;

/** After a person speaks to an actor (or the actor answers them) it keeps its eyes on them this long, whoever else talks. */
export const HUMAN_FACE_HOLD_MS = 7000;

// ---- drama (act-contract.md, verb-vocab.json `constants`) -----------------------------------------------------------

/** LAD-8: the killer is locked from the celebration gestures this long from contact. */
export const NO_REWARD_MS = 5000;
/** TBL-11: a tableau holds every actor within this many tiles of its actor. */
export const TABLEAU_RADIUS_TILES = 6;
