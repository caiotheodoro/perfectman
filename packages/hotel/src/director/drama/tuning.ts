import type { ActionEmotions, ActVerb, RelationalState, SocialEmotions } from "@perfectman/shared";
import { VOCAB_CONSTANTS } from "../verb-vocab.generated.js";
import type { HostilityKind } from "./hostility.js";

/**
 * Everything the drama director tunes, as data (verb-bible 4.3 and 4.5 say the numbers are seeds `[I]` to be tuned, so
 * they live here and nowhere else). The contract's own numbers (20 s spacing, one kill per scene, 60 s cooldown, the
 * 20 s scene floor) are not tunable: they come from `VOCAB_CONSTANTS`, the vendored verb table.
 */

/** `act.<tendency>`, `social.<emotion>` or `rel.<field>`: where a driver reads its value in [0, 1]. */
export type DriverSource =
  | `act.${keyof ActionEmotions}`
  | `social.${keyof SocialEmotions}`
  | `rel.${keyof Pick<RelationalState, "resentment" | "threat" | "envy" | "suspicion">}`
  /** The ledger's grievance from what was said (`ProvocationLedger`, errata P7): 0 when nobody provoked the actor. */
  | "rel.provocation";

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
  /**
   * The grievance the cast's own talk builds (errata P7). The engine's relational rules do not read what was said, so a model that only talks never gives the
   * motive gate (LAD-6) a grievance: `ProvocationLedger` reads each line (`classifyHostility`), per ordered pair of `may_target` bot actors, and the director reads
   * the level as `rel.provocation`. One counted line adds `gain[kind]` (a line counts once, by its strongest kind); a line the target did not hear clearly but was
   * said in its room (behind its back) adds `behindBack` of it; the level falls linearly to 0 over `windowMs` from the last counted line and never passes `cap`;
   * a second counted line inside `minGapMs` of the first is the same outburst and adds nothing. From `grievanceAt` the level is a grievance for the rungs up to
   * `maxRung` (never a slap or above: those keep needing a real resentment). The verbs it drives are in `drivers` with the weights that keep a single line short
   * of the shove (`gain.insult` x the shove's weight is below the lowest shove threshold, 0.5).
   */
  provocation: {
    gain: Readonly<Record<HostilityKind, number>>;
    cap: number;
    windowMs: number;
    minGapMs: number;
    behindBack: number;
    grievanceAt: number;
    maxRung: number;
    /**
     * Words that only report someone else's ("ela te chamou de burro", errata P8) are not the speaker's insult and never a grievance against the messenger. When the
     * alleged speaker is named and is a `may_target` pair of the person the line is said to, that person's grievance against the alleged speaker grows by this much.
     */
    reportedGain: number;
    /**
     * What the scene spine may open (errata P8, `ProvocationLedger.unlock`). The spine's turn and decision steps call it when the pair has been heard heating up: the
     * evidence is the hostile lines of the last `windowMs` (counted lines of the pair, in either direction, at least one of them an insult, a threat, blackmail or an
     * accusation by the person the aggressor holds it against); `shoveEvents` of them open the shove at the turn, `slapEvents` of them (or a shove already thrown by the
     * pair) open the slap at the decision. An unlock lasts `holdMs` (renewed while the evidence stands), writes `provocation` as the pair's grievance and makes the
     * volition of the unlocked rungs and below `volition` (the one dialogue-driven reading the slap has) and opens their grievance: the climb itself is the director's
     * (one rung per beat, `origination.climb`, the witness rule, the spacing and the cooldown). Never the punch or the kill, never a human.
     */
    unlock: { windowMs: number; holdMs: number; shoveEvents: number; slapEvents: number; provocation: number; volition: number; climbExtendMs: number };
  };
  /**
   * A floor under every ladder verb's volition that rises with the scene's age, on only for a scene that carries a climax deadline (`RunDrama.pressure`: a beat sheet, or a
   * `drama.pressure_floor` of the author's), never in free play. From `startFrac` of the deadline it grows linearly to `max` at the deadline, so a cast whose model only talks
   * (volition 0.36 against a theta of 0.52, run 63) is still pushed up the ladder in time for the climax. It reaches only the pairs with heat (a live grievance from what was said,
   * an open unlock, or a resentment of `heat`) and only the rungs up to `maxRung`; from `grievanceAt` the floor also stands in for the grievance LAD-6 asks the rungs from
   * `grievance.minRung`. The ladder is still one rung per beat, 25 s apart, with the witness rule and the spacing: the floor moves the motive gate, no other. It is the director's own beats' floor: a model's proposal is judged on the feelings (a model that glares at every consult would otherwise put every cast member in a glare every 60 s, three acts a minute and more).
   */
  pressure: { floor: { startFrac: number; max: number; heat: number; maxRung: number; grievanceAt: number } };
  /**
   * LAD-10: at most `maxActors` actors, or `castFraction` of the cast if that is fewer (never fewer than one), hold a rung of `minRung` or more at once. `answer` (errata P9): an
   * actor the scene spine opened a pair for may answer a blow of `minRung` or more that person threw at it, beyond the cap: a fight of two is not a spread to a third. A third person is
   * still capped. Off restores the cap as it was (one actor per scene in a cast of 3 to 5). `ageMs` (run 63): a rung of `minRung` or more
   * started longer ago than this no longer counts toward the cap, so a shove in the first minute does not shut out the slap of the climax for the rest of the scene; 0 keeps it all scene.
   */
  contagion: { minRung: number; maxActors: number; castFraction: number; answer: boolean; ageMs: number };
  /** Which tendencies drive which verb. A verb with no driver is never started by emotion alone: `kill` is authored (LAD-5). */
  drivers: Readonly<Partial<Record<ActVerb, readonly Driver[]>>>;
  /**
   * Beats the director may originate when the model is passive, and how often one actor may be offered a beat. 75 s (errata P4-02): the first seed, 6 s,
   * started a resentful actor 8.6 times a minute against the act-rate probe's 3 per scene-minute. With 75 s all five presets pass every drama probe
   * with a consult every 4, 6, 8, 10 and 12 s, and the ladder still peaks in a 4-minute scene (the model climbs it; the director only fills the quiet).
   */
  origination: {
    verbs: readonly ActVerb[];
    minGapMs: number;
    /**
     * Whether the director is also asked to originate when the model proposed something and none of it went through (run 63: the model proposed a glare on every consult, the
     * ladder refused 13 of them on the motive, and the 12 originations the director was asked for found nothing; the ones it was not asked for are the other cases). The same
     * gates and the same pace apply, and a proposal that was approved still keeps the director out. false restores the old rule: asked only when the model proposed nothing.
     */
    askAfterRefusal: boolean;
    /** Off-ladder verbs have no rung, so no theta: a beat of one needs a volition of at least this. */
    offLadderTheta: number;
    /**
     * A climb in progress (issue #262). The slow gap above spaces out an actor's beats, but a ladder started by the director has to be seen: a
     * model that only talks shows the whole scene in about two minutes, and at 75 s a beat that is glare, insult, shove and slap takes four minutes. So once an
     * actor's last beat was a rung of the ladder, its next rung toward the same person (never above `maxRung`: the director fills the quiet up to the
     * slap, the punch and the kill are the model's or the author's) may follow after `gapMs` instead. It is the same beat through the same gates, only sooner;
     * with nowhere left to climb the slow gap is back. `gapMs` stays above the contract's 20 s between blows.
     *
     * The distance (issue #262, the live run of `tapa-na-cara`): a model consulted once every ~20 s, and a target that walks off on its own between two consults,
     * left the actor a walk that ended where the target no longer was, so a shove that was due never started. Once the director has said the only thing missing is the
     * distance (`approach`), the body follows the target for up to `followWindowMs`: every `followEveryMs`, off its own timer and not the model's, it walks the actor
     * beside the target again if the target moved, and once the two are beside each other asks the director again (a plain `decide` with no proposal, the same call a
     * passive turn makes, so every gate holds). The window ends on the blow (any act the actor starts), a scene cut, the actor's death or lock, or the timeout; it is
     * never extended by the follow itself, only a later `approach` of a model turn may open a new one.
     */
    climb: { gapMs: number; maxRung: number; followWindowMs: number; followEveryMs: number };
  };
  /**
   * The same actor starting the same verb again, at anyone, sooner than this after it last started it is passed on (`pace`), whoever asked: the
   * model proposing it again, or the director's own beat. The hotel's cooldown (60 s, per target) covers the verbs with a `gates.cooldown`; these are
   * the ones it leaves open, which a model that is shown a body on the floor on every consult would otherwise repeat on every consult. An authored beat
   * is exempt (the script is the author's pace). A verb that is not listed has no window.
   */
  repeatMs: Readonly<Partial<Record<ActVerb, number>>>;
  /**
   * Acts at a human in the room (the scene's `may_target_humans`, which drops the consent chip). The director's own beats (no model proposal, no author) go no higher than
   * `directorMaxRung` at a human: a glare or an insult, never a blow, and the scene spine never unlocks one (`ProvocationLedger.allow`). A blow at a human is the model's
   * or the author's, through every gate (`max_rung`, `may_target`, the rate limit), and the hotel keeps it cosmetic.
   */
  humanTargets: { directorMaxRung: number };
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
   * A contact verb whose gate says `too_far` (GATE-7) is not final for an authored beat (habbo#41): the pair is walked together (`walkCloser`) and the
   * ask repeated every `walkRetryMs`, for at most `walkWindowMs` from the first `too_far`; the walk is ordered again every `walkRepathMs` while they are
   * still apart (the target may have moved). Still apart at the window's end, or the scene cut meanwhile: the beat is dropped. 30 s is the walk across a
   * party room (a tile a second at the hotel's pace, 20 s for the planner's own `RETRY_MS`) plus the busy window's slack; a beat is not worth holding a
   * scene longer than that. Every other veto drops at once.
   */
  beats: {
    busyRetryMs: number;
    busyWindowMs: number;
    pastToleranceMs: number;
    cutAttempts: number;
    cutVerifyMs: number;
    cutRetryPadMs: number;
    walkWindowMs: number;
    walkRetryMs: number;
    walkRepathMs: number;
  };
};

const d = (source: DriverSource, weight = 1): Driver => ({ source, weight });

export const DEFAULT_DRAMA_TUNING: DramaTuning = {
  theta: { 1: 0.35, 2: 0.45, 3: 0.6, 4: 0.7, 5: 0.8, 6: 0.9 },
  patienceBoost: 0.15,
  momentumGain: 0.1,
  grievance: { minRung: 2, resentment: 0.5, windowMs: 300_000 },
  provocation: {
    gain: { insult: 0.5, threat: 0.5, blackmail: 0.5, accusation: 0.45, challenge: 0.3, mockery: 0.3 },
    cap: 0.9,
    windowMs: 120_000,
    minGapMs: 8000,
    behindBack: 0.5,
    grievanceAt: 0.3,
    maxRung: 3,
    reportedGain: 0.15,
    unlock: { windowMs: 90_000, holdMs: 120_000, shoveEvents: 2, slapEvents: 3, provocation: 0.85, volition: 0.95, climbExtendMs: 60_000 },
  },
  pressure: { floor: { startFrac: 0.1, max: 0.8, heat: 0.1, maxRung: 4, grievanceAt: 0.45 } },
  contagion: { minRung: 3, maxActors: 2, castFraction: 1 / 3, answer: true, ageMs: 90_000 },
  drivers: {
    glare: [d("act.jealousInspection"), d("act.resentfulColdness"), d("social.jealousy"), d("social.envy"), d("rel.envy"), d("rel.provocation")],
    insult: [d("act.impulsiveProvocation"), d("act.contemptuousDismissal"), d("social.contempt"), d("rel.provocation")],
    // `defensiveness` is the one tendency that licenses a first strike from fear, and its ceiling is `shove` (4.3). A provocation reaches it at 0.9 of itself (see `provocation`).
    shove: [d("act.impulsiveProvocation"), d("act.dominanceAssertion"), d("act.defensiveness"), d("rel.provocation", 0.9)],
    slap: [d("act.dominanceAssertion"), d("social.humiliation")],
    punch: [d("act.dominanceAssertion")],
    turn_back: [d("act.resentfulColdness"), d("act.contemptuousDismissal"), d("act.shameWithdrawal")],
  },
  repeatMs: { turn_back: 60_000, storm_off: 120_000, cry: 90_000, faint: 300_000, recoil: 20_000, freeze_gasp: 30_000, tend_fallen: 60_000, restrain: 30_000, tableau: 60_000 },
  origination: { verbs: ["glare", "insult", "shove", "slap", "punch", "turn_back"], minGapMs: 75_000, askAfterRefusal: true, offLadderTheta: 0.6, climb: { gapMs: 25_000, maxRung: 4, followWindowMs: 30_000, followEveryMs: 3000 } },
  humanTargets: { directorMaxRung: 2 },
  sceneAdvancePendingMs: 3000,
  resumeAssumes: { physicalBeatJustStarted: true, killUsed: true },
  keepDoneMs: 60_000,
  beats: { busyRetryMs: 1000, busyWindowMs: 15_000, pastToleranceMs: 1000, cutAttempts: 6, cutVerifyMs: 3500, cutRetryPadMs: 50, walkWindowMs: 30_000, walkRetryMs: 1000, walkRepathMs: 8000 },
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
  // The verbs of the cinematic revamp (wire-spec: point, grab, push_away, slump, kneel, flee, plead). Provisional rows until the hotel's table carries them: none is on the ladder and none
  // needs the scenario's block; the two that touch someone (grab, push_away) are contact verbs, held to a chip at a human like the blows (their table row, when it lands, replaces these:
  // `drama-vocab.test.ts` checks every verb the table has against this one).
  point: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: null, still: false },
  grab: { calmBlocks: true, consent: "violent_chip", budget: null, cooldown: true, scenario: "free_ok", maxDist: 1, still: true },
  push_away: { calmBlocks: true, consent: "violent_chip", budget: null, cooldown: true, scenario: "free_ok", maxDist: 1, still: true },
  slump: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: null, still: false },
  kneel: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: null, still: false },
  flee: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: null, still: false },
  plead: { calmBlocks: false, consent: null, budget: null, cooldown: false, scenario: "free_ok", maxDist: 3, still: false },
};

/** SAFE-4: the verbs that count toward the harm window when aimed at a human (`insult` included, though it touches no one). */
export const HARM_VERBS: ReadonlySet<ActVerb> = new Set<ActVerb>(["shove", "slap", "punch", "kill", "insult", "grab", "push_away"]);

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
