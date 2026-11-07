/* eslint-disable */
/**
 * GENERATED, DO NOT EDIT.
 * Source: packages/hotel/schema/cue-vocab.json (vendored from Tilehouse,
 * see schema/SOURCE.md). Regenerate: pnpm --filter @perfectman/hotel gen:director
 */
export const CUE_VOCAB_VERSION = 1 as const;

export const SFX_CANONICAL = [
  "footsteps",
  "door_open",
  "door_close",
  "kiss",
  "hug",
  "laugh",
  "crowd_murmur",
  "sting_tension",
  "sting_romance",
  "sting_comedy",
  "sting_sad",
  "transition_whoosh",
  "ui_tick"
] as const;

export const SFX_ALIASES: Readonly<Record<string, string>> = {
  "footstep": "footsteps",
  "steps": "footsteps",
  "step": "footsteps",
  "walk": "footsteps",
  "door": "door_open",
  "doors": "door_open",
  "knock": "door_open",
  "smooch": "kiss",
  "embrace": "hug",
  "laughter": "laugh",
  "giggle": "laugh",
  "murmur": "crowd_murmur",
  "crowd": "crowd_murmur",
  "chatter": "crowd_murmur",
  "ambience": "crowd_murmur",
  "tension": "sting_tension",
  "suspense": "sting_tension",
  "dramatic": "sting_tension",
  "romance": "sting_romance",
  "love": "sting_romance",
  "comedy": "sting_comedy",
  "funny": "sting_comedy",
  "slide_whistle": "sting_comedy",
  "sad": "sting_sad",
  "sadness": "sting_sad",
  "melancholy": "sting_sad",
  "whoosh": "transition_whoosh",
  "transition": "transition_whoosh",
  "cut": "transition_whoosh",
  "fade": "transition_whoosh",
  "meanwhile": "transition_whoosh",
  "swish": "transition_whoosh",
  "tick": "ui_tick",
  "click": "ui_tick"
};

export const SFX_LOOPABLE: readonly string[] = [
  "crowd_murmur",
  "footsteps"
];

export const EMOTION_CANONICAL = [
  "love",
  "joy",
  "sad",
  "angry",
  "surprised",
  "confused",
  "afraid",
  "thinking"
] as const;

export const EMOTION_ALIASES: Readonly<Record<string, string>> = {
  "heart": "love",
  "crush": "love",
  "romance": "love",
  "affection": "love",
  "kiss": "love",
  "smile": "joy",
  "happy": "joy",
  "laugh": "joy",
  "laughing": "joy",
  "amused": "joy",
  "delight": "joy",
  "excited": "joy",
  "proud": "joy",
  "glad": "joy",
  "sadness": "sad",
  "cry": "sad",
  "crying": "sad",
  "rain": "sad",
  "raincloud": "sad",
  "gloom": "sad",
  "grief": "sad",
  "lonely": "sad",
  "hurt": "sad",
  "heartbroken": "sad",
  "melancholy": "sad",
  "anger": "angry",
  "mad": "angry",
  "rage": "angry",
  "furious": "angry",
  "annoyed": "angry",
  "jealous": "angry",
  "surprise": "surprised",
  "shock": "surprised",
  "shocked": "surprised",
  "gasp": "surprised",
  "astonished": "surprised",
  "startled": "surprised",
  "confusion": "confused",
  "doubt": "confused",
  "question": "confused",
  "puzzled": "confused",
  "suspicious": "confused",
  "fear": "afraid",
  "scared": "afraid",
  "nervous": "afraid",
  "anxious": "afraid",
  "worried": "afraid",
  "worry": "afraid",
  "embarrassed": "afraid",
  "tense": "afraid",
  "neutral": "thinking",
  "calm": "thinking",
  "tired": "thinking",
  "hmm": "thinking",
  "thought": "thinking"
};

export const FACE_STATE_EMOTIONS: Readonly<Record<string, string>> = {
  "neutral": "thinking",
  "smile": "joy",
  "angry": "angry",
  "worried": "afraid",
  "tired": "thinking",
  "shock": "surprised"
};

export const FADE_RANGE = { min: 0, max: 1 } as const;

export const CUT_FX_KINDS: readonly string[] = [
  "fade",
  "door",
  "meanwhile"
];
