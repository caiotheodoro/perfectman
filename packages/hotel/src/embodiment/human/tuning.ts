/**
 * Human-likeness: the stylization dial and every number behind it (cinematic revamp B5, docs/embodiment-human.md).
 *
 * `human_likeness` runs 0..1. 0 is the body as it was before this change (no rule in this folder runs, a test pins it);
 * 1 is the full set of behaviours at their strongest; the default 0.6 is "closer to real people, still stylized".
 * Every behaviour either mixes a quantity between its "as it was" value and its human value (`mix`) or scales the chance
 * of a visible event (`chance`), so the dial moves all of them together and none of them turns on at a different place.
 *
 * Every number lives in `HT`, and every leaf of `HT` has a line in `HT_SOURCES` that says where it comes from:
 *  - `prior`: a literature value or a judgement call, NOT measured on this hotel. Calibrate it.
 *  - `corpus`: read off the cinema-norms corpus (agent E1, `packages/shared/src/cinema-norms/cinema-norms.json`).
 *  - `runs`: measured on the baseline runs 55-63 (docs/eval/humanlike-baseline.md).
 * Tile distances are Chebyshev tiles; the hotel's tile is not a metre, so the proxemic bands are a stylized mapping of Hall's, a prior.
 */

export const HUMAN_LIKENESS_ENV = "PERFECTMAN_HUMAN_LIKENESS";
export const DEFAULT_HUMAN_LIKENESS = 0.6;

/** The scene's value wins over the environment, the environment over the default. Anything that is not a number in 0..1 is ignored (and clamped when it is a number). */
export function resolveHumanLikeness(scene?: number | null, env: Readonly<Record<string, string | undefined>> = process.env): number {
  const fromScene = typeof scene === "number" && Number.isFinite(scene) ? scene : undefined;
  if (fromScene !== undefined) return clamp01(fromScene);
  const raw = env[HUMAN_LIKENESS_ENV]?.trim();
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n)) return clamp01(n);
  }
  return DEFAULT_HUMAN_LIKENESS;
}

export const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));
export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
/** `a` at h = 0, `b` at h = 1. */
export const mix = (a: number, b: number, h: number): number => a + (b - a) * clamp01(h);
/** A probability of at most `max`, scaled by the dial and by how strongly the moment calls for it (0..1). */
export const chance = (max: number, h: number, strength = 1): number => clamp01(max * clamp01(h) * clamp01(strength));

export const HT = {
  /** Proxemics: conversation distance in tiles by what the two feel for each other (Hall 1966, stylized). [min, ideal, max]. */
  prox: {
    intimate: [1, 1, 2],
    warm: [1, 2, 3],
    neutral: [2, 3, 4],
    cool: [3, 4, 5],
    faceoff: [1, 2, 3],
    fear: [3, 4, 6],
    /** Where the "as it was" behaviour stands, the h = 0 end of every window: the old rules approached at 4+ and settled at 2. */
    oldMin: 1,
    oldIdeal: 2,
    oldMax: 6,
    /** Never farther than this while talking: inside the 6-tile clear-hearing radius with a margin. */
    earshotMax: 5,
    /** Before a first line to someone farther than this the speaker walks up to the social band. */
    approachFirstAt: 4,
    approachFirstTo: [2, 3],
    /** How far a victim steps back after a shove, tiles. */
    stepBack: 2,
    stepBackWithinMs: 6000,
    /** A group is people within this of each other who are talking; it is arranged on a ring of this radius. */
    groupLinkTiles: 4,
    groupRingRadius: 2,
    groupMinSpacing: 2,
    groupMinSize: 3,
    groupAdjustCooldownMs: 25_000,
    /** Someone crowding the speaker steps back to this distance. */
    speakerSpace: 2,
    speakerSpaceCooldownMs: 25_000,
    /** Chance per planner look that a person who is too far or too near (by this many tiles beyond the window) actually moves: never certain, people drift. */
    moveChance: 0.85,
    unstackCooldownMs: 4000,
    /** Planner looks are model-paced (6-12 s); a window violation shorter than this is tolerated, the person was passing by. */
    settleMs: 2500,
  },

  /** Gaze and orientation. */
  gaze: {
    /** A speaker looks at the person addressed from this far (tiles); beyond, the head turn is still made but only up to this. */
    maxTiles: 9,
    /** Listener turns to the speaker after this delay, ms (a glance takes 200-500 ms in people). */
    listenerLagMs: [250, 700],
    /** Speaker turns at the start of the line. */
    speakerLagMs: [80, 350],
    /** Chance the speaker averts on a lie, a shame or being stung; held for `averseHoldMs` then returns to the addressee. */
    averseChance: 0.8,
    averseHoldMs: [900, 2200],
    /** The averted look is this many sectors off the addressee (2 = side-on, a clear look away). */
    averseSectors: 2,
    /** Eye contact is held through a confrontation when both are this heated. */
    confrontArousal: 0.6,
    /** Glance at a third party being discussed, or at a prop that matters. */
    thirdPartyChance: 0.55,
    glanceLagMs: [500, 1200],
    glanceHoldMs: [900, 1700],
    propChance: 0.6,
    /** Shame / being stung thresholds that count as "wants to look away". */
    shameLookAway: 0.5,
    /** A line is a "stung" one for its addressee when it reads as one of these (hostility lexicon). */
    stungKinds: ["insult", "threat", "blackmail", "accusation", "mockery"],
  },

  /** Turn-taking in the chat gateway. */
  turn: {
    /** Typing indicator: ms per character at h = 0 (the gateway's own number) and at h = 1. */
    perCharMs: [55, 80],
    typingMinMs: 700,
    /** The most one line's typing and thinking can add, mixed from the old cap. */
    capMs: [4000, 7000],
    /** Lognormal sigma of the jitter on the typing time at h = 1 (people are not a metronome). */
    typingSigma: 0.25,
    /** Chance the bubble drops for a moment mid-line (someone thinks of how to say it) at h = 1. */
    hesitateChance: 0.18,
    hesitatePauseMs: [350, 900],
    /** Reaction latency before the typing starts, by how the actor feels, ms [lo, hi] at h = 1 (the dial scales it from 0). Stivers 2009 gives about 200 ms for speech; chat adds reading. */
    latencyMs: {
      heated: [300, 800],
      surprised: [450, 1000],
      warm: [700, 1500],
      neutral: [900, 1900],
      sad: [1400, 2800],
      ashamed: [1800, 3600],
    },
    /** Interruption: the chance a heated line is talked over, per line, at h = 1; both must be this aroused, the line this long. */
    interruptChance: 0.4,
    interruptArousal: 0.6,
    interruptMinWords: 7,
    interruptCooldownMs: 40_000,
    /** The interrupter lands this long after the cut line, ms. */
    overlapGapMs: [350, 900],
    /** Share of the words that stay on screen when a line is cut. */
    cutKeep: [0.5, 0.78],
    cutMinWords: 3,
    /** Non-verbal backchannel: chance a listener answers a line of this many words or more, at h = 1. */
    backchannelChance: 0.5,
    backchannelMinWords: 5,
    backchannelLagMs: [500, 1300],
    backchannelCooldownMs: 8000,
  },

  /** Gesture and expression with speech. */
  gesture: {
    /** Emphasis gesture on a stressed line, chance at h = 1 times the stress (0..1). */
    emphasisChance: 0.45,
    emphasisLagMs: [250, 900],
    emphasisCooldownMs: 6000,
    /** A heated line may carry the exclamation sign; at most this often per actor. */
    signCooldownMs: 45_000,
    signStyleExclaim: 13,
    /** The face that follows an emotion, how long it stays before it decays to neutral, ms. */
    faceHoldMs: { smile: 5000, angry: 6500, sad: 8000, surprised: 1800, sleepy: 5000 },
    /** Reaction to what was just said: laugh on amusement, sigh, head-shake. Chance at h = 1. */
    laughChance: 0.5,
    reactChance: 0.45,
    reactLagMs: [350, 900],
    /** Head-shake / tilt: a turn this many sectors off, back after this many ms. */
    headTurnSectors: 1,
    headTurnBackMs: [600, 1000],
    /** Witnesses of a reveal: surprise held this long, then a glance at the accused. */
    witnessSurpriseMs: 1500,
    witnessChance: 0.8,
    witnessLagMs: [250, 700],
    witnessGlanceLagMs: [700, 1500],
  },

  /** Idle life. */
  idle: {
    /** Stand/sit shift with nobody talking to the actor: every this long (+- jitter), at h = 1; infinite at h = 0. */
    weightShiftEveryMs: 55_000,
    weightShiftJitter: 0.4,
    /** Pacing when anxious: a leg of this many tiles every so often, at most `paceLegsPerMin` legs a minute. */
    paceAnxiety: 0.5,
    paceArousal: 0.6,
    paceLegTiles: [2, 3],
    paceEveryMs: [9000, 15_000],
    paceLegsPerMin: 3,
    /** Sit when tired or beaten (the planner's own threshold is 0.25 energy). */
    tiredEnergy: 0.35,
    defeatedValence: -0.45,
    /** Walk to the window, the rail or the door when avoiding someone. */
    avoidShame: 0.5,
    avoidDistance: 0.6,
    avoidCooldownMs: 60_000,
    /** Leave the room for a while after a humiliation and come back. */
    stepOutHumiliation: 0.7,
    stepOutForMs: [25_000, 45_000],
    stepOutCooldownMs: 240_000,
  },

  /** Budget: the human layer asks for at most this many commands per actor per 5 s, leaving the planner's own and the acts' share of the 8 the hotel allows. */
  budget: { perWindow: 3, windowMs: 5000, hotelCount: 8 },
} as const;

export type Provenance = "prior" | "corpus" | "runs";

export type SourceNote = { key: string; src: Provenance; note: string };

/**
 * Where each group of numbers in `HT` comes from. `key` is a path prefix of `HT` (a test checks every leaf of `HT` is covered by one).
 * `corpus` rows cite the cinema-norms numbers read on 2026-11-11 from the E1 branch; `runs` rows are filled by the baseline (docs/eval/humanlike-baseline.md).
 */
export const HT_SOURCES: readonly SourceNote[] = [
  { key: "prox.intimate", src: "prior", note: "Hall 1966: intimate <= 0.45 m, personal to 1.2 m, social to 3.6 m; one tile mapped to about one body width, stylized" },
  { key: "prox.warm", src: "prior", note: "Hall 1966 personal band; warmer pairs sit in the near phase" },
  { key: "prox.neutral", src: "prior", note: "Hall 1966 far personal / near social; the existing 3-6 social band is the hotel's own (embodiment.md 2)" },
  { key: "prox.cool", src: "prior", note: "Hall 1966 social band; cold or distrustful pairs keep a table's width" },
  { key: "prox.faceoff", src: "prior", note: "confrontation: people move into the other's personal space to threaten (Hall; Felipe & Sommer 1966 invasion studies)" },
  { key: "prox.fear", src: "prior", note: "a person who fears the other widens the gap (Hall; Kennedy et al. 2009: amygdala and personal-space regulation)" },
  { key: "prox.old", src: "prior", note: "the h = 0 end: values of the pre-B5 rules (APPROACH_AT 4, personal 2, social max 6)" },
  { key: "prox.earshotMax", src: "prior", note: "embodiment.md 5.2: say is clear to 6 tiles; 5 leaves a tile of margin" },
  { key: "prox.approach", src: "prior", note: "judgement: walk up before a first line to someone across the room, as people do" },
  { key: "prox.step", src: "prior", note: "judgement: a shoved person gives ground; two tiles reads on screen" },
  { key: "prox.group", src: "prior", note: "Kendon 1990 F-formation: a circular arrangement with a shared central space" },
  { key: "prox.speaker", src: "prior", note: "judgement: people open a gap around the one holding the floor" },
  { key: "prox.move", src: "prior", note: "judgement" },
  { key: "prox.unstack", src: "prior", note: "judgement" },
  { key: "prox.settle", src: "prior", note: "judgement" },
  { key: "gaze", src: "prior", note: "Argyle & Cook 1976, Kendon 1967: speakers look at the listener about 40% of the time and away at the start of a turn, listeners about 75%; aversion on shame/deceit is folk-psychological (DePaulo 2003 finds weak evidence for lies, so it is applied to shame and being stung, and to authored lies only)" },
  { key: "turn.perCharMs", src: "prior", note: "h = 0 is the gateway's own 55 ms; 80 ms/char is about 12 chars/s, fast typing, so a 100-char line shows 8 s of bubble before the cap" },
  { key: "turn.typing", src: "prior", note: "typing times vary roughly lognormally across people (Dhakal et al. 2018: mean 52 wpm, sd 20)" },
  { key: "turn.cap", src: "prior", note: "the old 4 s cap kept slow personas inside a 10 s p95; cinematic cast-only lines have no human waiting, so the cap rises" },
  { key: "turn.hesitate", src: "prior", note: "judgement" },
  { key: "turn.latencyMs", src: "prior", note: "Stivers et al. 2009: median gap between turns is about 200 ms in 10 languages, faster for preferred answers, slower for dispreferred; Heldner & Edlund 2010. Chat adds reading time, so these are larger. Cinema subtitle gaps (corpus, pt film drama p50 0.64 s, pt series drama p50 0.21 s) bracket the low end" },
  { key: "turn.interruptChance", src: "prior", note: "judgement, bounded by the corpus: share of turns that end cut off by a dash is p75 0.03-0.05 in screenplays (cinema-norms interruptShare), p50 0.017-0.033 in plays" },
  { key: "turn.interruptArousal", src: "prior", note: "judgement" },
  { key: "turn.interruptMinWords", src: "prior", note: "judgement" },
  { key: "turn.interruptCooldownMs", src: "prior", note: "keeps the rate near the corpus 3-5% of lines" },
  { key: "turn.overlap", src: "prior", note: "Heldner & Edlund 2010: about 40% of between-speaker intervals in conversation are overlaps; most are under 1 s" },
  { key: "turn.cut", src: "prior", note: "judgement" },
  { key: "turn.backchannel", src: "prior", note: "Yngve 1970, Heldner et al. 2013: listeners give a feedback signal every few seconds of talk; here one per heard line, bounded by a cooldown, because the wire has no nod" },
  { key: "gesture.emphasis", src: "prior", note: "McNeill 1992: gesture accompanies most animated speech; chat bubbles carry far less, so 0.45 of stressed lines" },
  { key: "gesture.sign", src: "prior", note: "judgement" },
  { key: "gesture.faceHoldMs", src: "prior", note: "facial expressions of emotion last 0.5-4 s (Ekman 2003), stretched for a stylized client" },
  { key: "gesture.laugh", src: "prior", note: "Provine 2000: laughter is mostly social punctuation after statements" },
  { key: "gesture.react", src: "prior", note: "judgement" },
  { key: "gesture.head", src: "prior", note: "judgement: the wire has no nod; a one-sector turn and back reads as a head movement" },
  { key: "gesture.witness", src: "prior", note: "judgement: freeze then look to the accused is a staple of staging" },
  { key: "idle", src: "prior", note: "judgement; the old rules sit at 150 s and stand at 170 s (embodiment.md 7.1 rule 11), these are the faster, human pace" },
  { key: "budget", src: "prior", note: "embodiment.md 7.2: planner 4 per 5 s, hotel backstop 8 per 5 s" },
];

/** Every leaf path of `HT` (`prox.intimate`, `turn.latencyMs.heated`, ...). Arrays are leaves. */
export function leafKeys(obj: unknown = HT, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return prefix ? [prefix] : [];
  return Object.entries(obj).flatMap(([k, v]) => leafKeys(v, prefix ? `${prefix}.${k}` : k));
}

/** The source note that covers a leaf: the longest `key` that is a prefix of it. */
export function sourceOf(leaf: string): SourceNote | undefined {
  return [...HT_SOURCES].filter((s) => leaf === s.key || leaf.startsWith(`${s.key}.`) || leaf.startsWith(s.key)).sort((a, b) => b.key.length - a.key.length)[0];
}
