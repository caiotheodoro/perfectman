import type { ScriptStats } from "./metrics.js";
import type { ScriptLang } from "./text.js";

/**
 * Norms: numbers measured on real plays (THEATRE only today: no screenplay was legally ingestible), derived by `export-norms` in
 * `@perfectman/kb` and committed as `script-norms.json`. Numbers only: no line of any play is in them.
 *
 * A norm is a percentile ladder (the value at each of {@link LADDER_PCTS}). Beat-level ladders are kept per bucket of say turns
 * (4-7, 8-12, 13+), because the share of long turns in a beat of 5 is far noisier than in a beat of 11, and a run is judged next to
 * beats of its own size.
 */

export type ScriptMedium = "THEATRE" | "CINEMA";

export const LADDER_PCTS = [0, 0.5, 1, 2.5, 5, 10, 25, 50, 75, 90, 95, 97.5, 99, 99.5, 100] as const;
export type Ladder = number[];

export const BEAT_METRICS = ["medianWords", "p90Words", "over25", "over40", "short", "noveltyMean", "loopTurns", "topicTurns", "echoTurns", "majorPer10", "stall", "debtPer10"] as const;
export type BeatMetric = (typeof BEAT_METRICS)[number];
export type MetricDir = "high" | "low";
/** Which side of a metric is the failure: a run is penalised for long turns (high) and for few new things (low). */
export const METRIC_DIR: Readonly<Record<BeatMetric, MetricDir>> = {
  medianWords: "high",
  p90Words: "high",
  over25: "high",
  over40: "high",
  short: "low",
  noveltyMean: "low",
  loopTurns: "high",
  topicTurns: "high",
  echoTurns: "high",
  majorPer10: "low",
  stall: "high",
  debtPer10: "high",
};

export const BUCKETS = ["4-7", "8-12", "13+"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const bucketOf = (sayTurns: number): Bucket => (sayTurns <= 7 ? "4-7" : sayTurns <= 12 ? "8-12" : "13+");

export type BucketNorms = { beats: number; metrics: Record<BeatMetric, Ladder> };

export type TacticNorms = {
  tagged: number;
  /** Share of tagged beats by status delta (the driver's movement against the person they act on). */
  statusDelta: Record<string, number>;
  /** Of two tagged beats next to each other in a scene: the share that follow each status delta with each status delta. */
  statusNext: Record<string, Record<string, number>>;
  /** Of two tagged beats next to each other in a scene: how often the tactic verb, and the status delta, stay the same. */
  sameTacticNext: number;
  sameStatusNext: number;
  /** Mean tagged beats in a row with the same status delta, within a scene. */
  statusRunMean: number;
  /** The 15 most frequent tactic verbs of the controlled list, with their share of tagged beats. */
  tacticTop: Array<[string, number]>;
};

export type LangNorms = {
  beats: number;
  turns: number;
  turnsPerBeat: number;
  /** Turn-level: words per speech turn and the shares the brief quotes. */
  words: { ladder: Ladder; mean: number; over25: number; over40: number; short: number };
  novelty: { mean: number; /** Novelty of turns with 4+ content words, as a ladder: the guard's floor reads it. */ judged: Ladder };
  rhythm: { runMean: number; cutOff: number; trailOff: number };
  buckets: Record<Bucket, BucketNorms>;
  /** Script-likeness score of the corpus beats themselves, as a ladder: the percentile a score corresponds to. */
  score: Ladder;
  tactic?: TacticNorms;
};

export type ScriptNorms = {
  format: "perfectman-script-norms";
  version: 1;
  built?: string;
  params: {
    minSayTurns: number;
    noveltyWindow: number;
    motifWindowTurns: number;
    motifWindowMs: number;
    capWords: number[];
    shortReplyWords: number;
    /** Percentile of the beat-level ladder where a metric starts to lose points, and where it scores zero (mirrored for low-bad metrics). */
    goodPct: number;
    badPct: number;
    holdout: number;
    /** Present only when the held-out set was picked with a salt. */
    holdoutSalt?: string;
  };
  source: { beats: number; eligible: number; heldOut: number; byLanguage: Record<string, number> };
  languages: Partial<Record<ScriptLang, Partial<Record<ScriptMedium, LangNorms>>>>;
};

// ---- ladders -------------------------------------------------------------------------------------------------------------

const round = (v: number, digits = 4): number => Math.round(v * 10 ** digits) / 10 ** digits;

/** The value at each of {@link LADDER_PCTS}, by nearest rank. */
export function ladderOf(values: readonly number[]): Ladder {
  if (values.length === 0) return LADDER_PCTS.map(() => 0);
  const s = [...values].sort((a, b) => a - b);
  return LADDER_PCTS.map((p) => round(s[p >= 100 ? s.length - 1 : Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0));
}

/** The value at percentile `pct` (0..100), interpolated between ladder points. */
export function ladderValue(ladder: Ladder, pct: number): number {
  if (pct <= LADDER_PCTS[0]) return ladder[0] ?? 0;
  for (let i = 1; i < LADDER_PCTS.length; i++) {
    if (pct <= LADDER_PCTS[i]!) {
      const p0 = LADDER_PCTS[i - 1]!;
      const p1 = LADDER_PCTS[i]!;
      const v0 = ladder[i - 1] ?? 0;
      const v1 = ladder[i] ?? v0;
      return v0 + ((v1 - v0) * (pct - p0)) / (p1 - p0);
    }
  }
  return ladder[ladder.length - 1] ?? 0;
}

/** The percentile (0..100) a value sits at in a ladder: the share of the reference at or below it, interpolated, ties taking the upper end. */
export function percentileIn(ladder: Ladder, value: number): number {
  if (ladder.length === 0) return 0;
  if (value < (ladder[0] ?? 0)) return 0;
  let at = 0;
  for (let i = 0; i < ladder.length; i++) if ((ladder[i] ?? 0) <= value) at = i;
  if (at >= ladder.length - 1) return 100;
  const v0 = ladder[at] ?? 0;
  const v1 = ladder[at + 1] ?? v0;
  const p0 = LADDER_PCTS[at]!;
  const p1 = LADDER_PCTS[at + 1]!;
  return v1 === v0 ? p0 : p0 + ((p1 - p0) * (value - v0)) / (v1 - v0);
}

/** The beat-level metrics of a list of turns. */
export function beatMetrics(s: ScriptStats): Record<BeatMetric, number> {
  return {
    medianWords: s.length.median,
    p90Words: s.length.p90,
    over25: s.length.over25,
    over40: s.length.over40,
    short: s.length.short,
    noveltyMean: s.novelty.mean,
    loopTurns: s.loopTurns,
    topicTurns: s.topicTurns,
    echoTurns: s.echoTurns,
    majorPer10: s.progress.majorPer10,
    stall: s.progress.stall,
    debtPer10: s.sayTurns === 0 ? 0 : (s.debt.unanswered / s.sayTurns) * 10,
  };
}

/** The norms block for a language and medium; a medium with no norms (CINEMA today) reads THEATRE and says so. */
export function normsFor(norms: ScriptNorms, lang: ScriptLang, medium: ScriptMedium = "THEATRE"): { block: LangNorms; medium: ScriptMedium; fallback: boolean } | undefined {
  const l = norms.languages[lang];
  const own = l?.[medium];
  if (own) return { block: own, medium, fallback: false };
  const theatre = l?.THEATRE;
  return theatre ? { block: theatre, medium: "THEATRE", fallback: true } : undefined;
}
