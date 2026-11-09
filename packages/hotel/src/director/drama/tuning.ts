import type { ActionEmotions, ActVerb, RelationalState, SocialEmotions } from "@perfectman/shared";
import { VOCAB_CONSTANTS } from "../verb-vocab.generated.js";

/**
 * Everything the drama director tunes, as data (verb-bible 4.3 and 4.5 say the numbers are seeds `[I]` to be tuned, so
 * they live here and nowhere else). The contract's own numbers (20 s spacing, one kill per scene, 60 s cooldown, the
 * 20 s scene floor) are not tunable: they come from `VOCAB_CONSTANTS`, the vendored verb table.
 */

/** `act.<tendency>`, `social.<emotion>` or `rel.<field>`: where a driver reads its value in [0, 1]. */
export type DriverSource =
  | `act.${keyof ActionEmotions}`
  | `social.${keyof SocialEmotions}`
  | `rel.${keyof Pick<RelationalState, "resentment" | "threat" | "envy" | "suspicion">}`;

/** One driver of a verb. The verb's volition is the max of `value * weight` over its drivers (verb-bible 4.5). */
export type Driver = { source: DriverSource; weight: number };

export type DramaTuning = {
  /** theta(rung), seed rows of verb-bible 4.5: a verb may fire when its volition is at least this. */
  theta: Readonly<Record<1 | 2 | 3 | 4 | 5 | 6, number>>;
  /** `act.strategicPatience` raises every theta by up to this (4.5, 4.3 `strategicPatience`). */
  patienceBoost: number;
  /** Rising arousal momentum lowers theta, falling raises it (4.4): `theta -= gain * clamp(momentumArousal, -1, 1)`. */
  momentumGain: number;
  /** Rungs from `minRung` up need a grievance toward the target: `rel.resentment >= resentment`, or a negative event within `windowMs` (4.5). */
  grievance: { minRung: number; resentment: number; windowMs: number };
  /** LAD-10: at most `maxActors` actors, or `castFraction` of the cast if that is fewer (never fewer than one), hold a rung of `minRung` or more at once. */
  contagion: { minRung: number; maxActors: number; castFraction: number };
  /** Which tendencies drive which verb. A verb with no driver is never started by emotion alone: `kill` is authored (LAD-5). */
  drivers: Readonly<Partial<Record<ActVerb, readonly Driver[]>>>;
  /** Beats the director may originate when the model is passive, and how often one actor may be offered a beat. */
  origination: { verbs: readonly ActVerb[]; minGapMs: number; /** Off-ladder verbs have no rung, so no theta: a beat of one needs a volition of at least this. */ offLadderTheta: number };
  /** A `scene_advance` carries no `cid` here, so a refusal is silent: ask again only after this long without a `scene_cut` (SCENE-4). */
  sceneAdvancePendingMs: number;
  /**
   * After a resume the director has no memory of the scene's counters (NEG-9 carries only the scene id, calm, pause, switch
   * and opt-in). These say what to assume: the safe reading is the worst case until the next scene cut.
   */
  resumeAssumes: { physicalBeatJustStarted: boolean; killUsed: boolean };
  /** Records of finished acts are kept this long past the longest window that reads them, then dropped. */
  keepDoneMs: number;
  /**
   * How the `BeatPlayer` treats the scenario's authored beats. An actor busy with an act of its own is asked again every `busyRetryMs` for up to
   * `busyWindowMs`, then the beat is dropped; a beat whose time passed more than `pastToleranceMs` before the player started is dropped, never played
   * late; a cut the floor or the pending window refuses is asked again `cutRetryPadMs` after it says it may be, and a cut the hotel dropped
   * silently is asked again after `cutVerifyMs` (longer than `sceneAdvancePendingMs`), at most `cutAttempts` times in all.
   */
  beats: { busyRetryMs: number; busyWindowMs: number; pastToleranceMs: number; cutAttempts: number; cutVerifyMs: number; cutRetryPadMs: number };
};

const d = (source: DriverSource, weight = 1): Driver => ({ source, weight });

export const DEFAULT_DRAMA_TUNING: DramaTuning = {
  theta: { 1: 0.35, 2: 0.45, 3: 0.6, 4: 0.7, 5: 0.8, 6: 0.9 },
  patienceBoost: 0.15,
  momentumGain: 0.1,
  grievance: { minRung: 2, resentment: 0.5, windowMs: 300_000 },
  contagion: { minRung: 3, maxActors: 2, castFraction: 1 / 3 },
  drivers: {
    glare: [d("act.jealousInspection"), d("act.resentfulColdness"), d("social.jealousy"), d("social.envy"), d("rel.envy")],
    insult: [d("act.impulsiveProvocation"), d("act.contemptuousDismissal"), d("social.contempt")],
    // `defensiveness` is the one tendency that licenses a first strike from fear, and its ceiling is `shove` (4.3).
    shove: [d("act.impulsiveProvocation"), d("act.dominanceAssertion"), d("act.defensiveness")],
    slap: [d("act.dominanceAssertion"), d("social.humiliation")],
    punch: [d("act.dominanceAssertion")],
    turn_back: [d("act.resentfulColdness"), d("act.contemptuousDismissal"), d("act.shameWithdrawal")],
  },
  origination: { verbs: ["glare", "insult", "shove", "slap", "punch", "turn_back"], minGapMs: 6000, offLadderTheta: 0.6 },
  sceneAdvancePendingMs: 3000,
  resumeAssumes: { physicalBeatJustStarted: true, killUsed: true },
  keepDoneMs: 60_000,
  beats: { busyRetryMs: 1000, busyWindowMs: 15_000, pastToleranceMs: 1000, cutAttempts: 6, cutVerifyMs: 3500, cutRetryPadMs: 50 },
};

/** The gates of each verb that the director mirrors (`verbs.<id>.gates` of the verb table); a test checks them against `verb-vocab.json`. */
export type VerbGate = {
  calmBlocks: boolean;
  consent: "violent_chip" | "violent_chip_noncontact" | "affection_chip" | "affection_chip_dodge" | null;
  budget: "physical" | "kill" | null;
  cooldown: boolean;
  scenario: "free_ok" | "needs_block" | "needs_block_and_may_die" | "needs_may_die";
  maxDist: number | null;
  still: boolean;
};

export const VERB_GATES: Readonly<Record<ActVerb, VerbGate>> = {
  glare: { calmBlocks: false, consent: null, budget: null, cooldown: true, scenario: "free_ok", maxDist: 8, still: false },
  insult: { calmBlocks: false, consent: "violent_chip_noncontact", budget: null, cooldown: true, scenario: "free_ok", maxDist: 6, still: false },
  shove: { calmBlocks: true, consent: "violent_chip", budget: "physical", cooldown: true, scenario: "free_ok", maxDist: 1, still: true },
  slap: { calmBlocks: true, consent: "violent_chip", budget: "physical", cooldown: true, scenario: "needs_block", maxDist: 1, still: true },
  punch: { calmBlocks: true, consent: "violent_chip", budget: "physical", cooldown: true, scenario: "needs_block", maxDist: 1, still: true },
  kill: { calmBlocks: true, consent: "violent_chip", budget: "kill", cooldown: true, scenario: "needs_block_and_may_die", maxDist: 1, still: true },
  die: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "needs_may_die", maxDist: null, still: false },
  recoil: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: null, still: false },
  freeze_gasp: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: null, still: false },
  hug: { calmBlocks: true, consent: "affection_chip", budget: null, cooldown: true, scenario: "free_ok", maxDist: 1, still: true },
  kiss: { calmBlocks: true, consent: "affection_chip_dodge", budget: null, cooldown: true, scenario: "free_ok", maxDist: 1, still: true },
  turn_back: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: null, still: false },
  cry: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: null, still: false },
  storm_off: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: null, still: false },
  tableau: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: null, still: false },
  restrain: { calmBlocks: true, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: 1, still: true },
  faint: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: null, still: false },
  tend_fallen: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: 1, still: false },
};

/** SAFE-4: the verbs that count toward the harm window when aimed at a human (`insult` included, though it touches no one). */
export const HARM_VERBS: ReadonlySet<ActVerb> = new Set<ActVerb>(["shove", "slap", "punch", "kill", "insult"]);

/** The contract's own numbers the director reads, in one place. */
export const LIMITS = {
  physicalSpacingMs: VOCAB_CONSTANTS.physical_spacing_ms,
  killsPerScene: VOCAB_CONSTANTS.kills_per_scene,
  sameVerbCooldownMs: VOCAB_CONSTANTS.same_verb_target_cooldown_ms,
  chipCooldownMs: VOCAB_CONSTANTS.chip_cooldown_ms,
  earshotTiles: VOCAB_CONSTANTS.earshot_tiles,
  zeroWitnessCapRung: VOCAB_CONSTANTS.zero_witness_cap_rung,
  deescalateToRung: VOCAB_CONSTANTS.deescalate_to_rung,
  sceneMinAgeMs: VOCAB_CONSTANTS.scene_min_age_ms,
} as const;
