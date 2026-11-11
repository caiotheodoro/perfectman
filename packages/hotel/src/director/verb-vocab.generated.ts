/* eslint-disable */
/**
 * GENERATED, DO NOT EDIT.
 * Source: packages/hotel/schema/verb-vocab.json (the hotel's published verb table, see schema/SOURCE.md).
 * Regenerate: pnpm --filter @perfectman/hotel gen:director
 */
export const VERB_VOCAB_VERSION = 1 as const;

export const VERB_VOCAB_REV = 4 as const;

/** sha256 of the bytes of schema/verb-vocab.json: what `hello_ack.sidecar.verb_vocab` carries (NEG-7, VV-3). */
export const VERB_VOCAB_SHA256 = "d5e0def05670680e0b6fa775e9d1f7f6f233cfdde3de6c5b8f16e6d09c338d82" as const;

export const VERB_IDS = [
  "glare",
  "insult",
  "shove",
  "slap",
  "punch",
  "kill",
  "die",
  "recoil",
  "freeze_gasp",
  "hug",
  "kiss",
  "turn_back",
  "cry",
  "storm_off",
  "tableau",
  "restrain",
  "faint",
  "tend_fallen",
  "point",
  "grab",
  "push_away",
  "slump",
  "kneel",
  "flee",
  "plead"
] as const;

export const VOCAB_ENUMS = {
  "verbs": [
    "glare",
    "insult",
    "shove",
    "slap",
    "punch",
    "kill",
    "die",
    "recoil",
    "freeze_gasp",
    "hug",
    "kiss",
    "turn_back",
    "cry",
    "storm_off",
    "tableau",
    "restrain",
    "faint",
    "tend_fallen",
    "point",
    "grab",
    "push_away",
    "slump",
    "kneel",
    "flee",
    "plead"
  ],
  "ladder": [
    "glare",
    "insult",
    "shove",
    "slap",
    "punch",
    "kill"
  ],
  "physical": [
    "shove",
    "slap",
    "punch",
    "kill"
  ],
  "origins": [
    "model",
    "director",
    "scenario"
  ],
  "outcomes": [
    "landed",
    "dodged",
    "blocked",
    "declined",
    "timeout",
    "aborted"
  ],
  "chip_answers": [
    "take",
    "dodge",
    "push_back",
    "timeout"
  ],
  "blocked_reasons": [
    "kill_switch",
    "calm_room",
    "consent_off",
    "ladder",
    "budget",
    "cooldown",
    "too_far",
    "dead_target",
    "no_scenario_gate",
    "rate_limit"
  ],
  "gate_order": [
    "kill_switch",
    "calm_room",
    "rate_limit",
    "dead_target",
    "no_scenario_gate",
    "consent_off",
    "too_far",
    "ladder",
    "budget",
    "cooldown"
  ],
  "abort_reasons": [
    "target_moved",
    "target_gone",
    "actor_gone",
    "actor_dead",
    "scene_cut",
    "run_end",
    "kill_switch",
    "calm_room",
    "paused",
    "opt_out"
  ],
  "act_error_codes": [
    "bad_message",
    "unknown_verb",
    "target_required",
    "target_forbidden",
    "bad_target",
    "act_busy",
    "actor_dead",
    "action_not_here",
    "target_gone",
    "slow_down",
    "stale_lease",
    "unknown_actor",
    "no_such_run",
    "run_ended"
  ],
  "new_act_error_codes": [
    "unknown_verb",
    "target_required",
    "target_forbidden",
    "bad_target",
    "act_busy",
    "actor_dead"
  ],
  "impact_classes": [
    "L",
    "M",
    "H",
    "F"
  ],
  "memory_events": [
    "aggressor",
    "victim",
    "witnessed",
    "affectionate",
    "receiver",
    "death",
    "none"
  ],
  "memory_tones": [
    "hostile",
    "hurt",
    "shocked",
    "warm",
    "tender",
    "grief",
    "dismissive",
    "neutral"
  ],
  "motions": [
    "lunge",
    "hit_stop",
    "tint_flash",
    "knockback",
    "shake",
    "recoil",
    "fall"
  ],
  "new_sfx": [
    "slap",
    "thud",
    "gasp",
    "sob",
    "whoosh_short"
  ],
  "families": [
    "conflict_noncontact",
    "conflict_contact",
    "climax",
    "affection",
    "solo",
    "director"
  ],
  "consent_profiles": [
    "violent_chip",
    "violent_chip_noncontact",
    "affection_chip",
    "affection_chip_dodge"
  ],
  "overlay_until": [
    "<ms integer>",
    "scene_cut",
    "cleared"
  ],
  "down_states": [
    "fainted",
    "dying",
    "body",
    "down"
  ],
  "reaction_labels": [
    "die",
    "freeze_gasp",
    "head_snap",
    "hug_back",
    "kiss_back",
    "look_back",
    "stagger",
    "struggle",
    "surprised",
    "watch"
  ]
} as const;

export const VOCAB_CONSTANTS = {
  "chip_ttl_ms": 4000,
  "chip_windup_ms": 150,
  "chip_cooldown_ms": 60000,
  "target_deadline_ms": 1500,
  "witness_deadline_ms": 3000,
  "earshot_tiles": 6,
  "physical_spacing_ms": 20000,
  "kills_per_scene": 1,
  "same_verb_target_cooldown_ms": 60000,
  "ladder_open_rung": 2,
  "zero_witness_cap_rung": 3,
  "deescalate_to_rung": 2,
  "no_reward_ms": 5000,
  "tableau_hold_ms": 2500,
  "tableau_radius_tiles": 6,
  "human_down_ms_default": 5000,
  "scene_min_age_ms": 20000,
  "harm_max_default": 3,
  "harm_window_s_default": 300,
  "pause_s_default": 600,
  "act_id_pattern": "^[A-Za-z0-9_.:-]{1,32}$",
  "text_max_chars": 200,
  "hit_stop_ms": {
    "L": 50,
    "M": 100,
    "H": 150,
    "F": 175
  },
  "class_bounds": {
    "L_below": 0.34,
    "M_to_inclusive": 0.67
  },
  "witness_stagger": {
    "base_ms": 600,
    "per_tile_ms": 150,
    "jitter_ms": 200,
    "cap_ms": 2800
  }
} as const;
