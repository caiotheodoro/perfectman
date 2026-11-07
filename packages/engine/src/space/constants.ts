/**
 * Seeds for the physical-space model (docs/embodiment.md sections 2, 3.1, 7.3).
 * Calibrate after the first real runs.
 */

/** One Tilehouse sim tick; a walking avatar advances one tile per tick. */
export const TICK_MS = 300;
/** A room with no frame for this long is stale: no body commands. */
export const STALE_MS = 5000;
/** A walker whose last position is older than this is dead-reckoned from its route. */
export const DEAD_RECKON_MS = 600;

/** `say` is heard clearly up to here, garbled up to SAY_GARBLED_TILES. */
export const SAY_CLEAR_TILES = 6;
export const SAY_GARBLED_TILES = 10;

/** Chebyshev distance bands. */
export const INTIMATE_MAX_TILES = 1;
export const PERSONAL_MAX_TILES = 2;
export const SOCIAL_MAX_TILES = 6;
export const PUBLIC_MAX_TILES = 12;

export const FACE_TOLERANCE_DEG = 45;
export const DWELL_POSTURE_MS = 20_000;
export const DWELL_ZONE_MS = 30_000;
export const GESTURE_COOLDOWN_MS = 15_000;
/** At most this many commands per window per actor. */
export const CMD_BUDGET_COUNT = 4;
export const CMD_BUDGET_WINDOW_MS = 5_000;
export const HUMAN_TYPING_EXPIRY_MS = 8_000;

/** An occupant that entered the room within this window counts as "arrived" in the change list. */
export const ARRIVAL_WINDOW_MS = 12_000;
/** PendingSpeech.expiresAt = now + 2 x ETA + this. */
export const PENDING_SPEECH_GRACE_MS = 5_000;

/** Body perception size: target and hard cap (chars / 4). */
export const BODY_TARGET_TOKENS = 350;
export const BODY_MAX_TOKENS = 600;
