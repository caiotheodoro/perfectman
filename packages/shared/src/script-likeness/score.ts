import { MIN_SAY_TURNS, computeScriptStats } from "./metrics.js";
import type { ScriptStats } from "./metrics.js";
import { METRIC_DIR, bucketOf, ladderValue, normsFor, percentileIn, beatMetrics } from "./norms.js";
import type { BeatMetric, Bucket, Ladder, ScriptMedium, ScriptNorms } from "./norms.js";
import type { ScriptLang } from "./text.js";
import { detectLang } from "./text.js";
import { isSay } from "./turns.js";
import type { ScriptTurn } from "./turns.js";

/**
 * One 0-100 script-likeness score, with its parts visible.
 *
 * Each metric is read against the corpus beats of the same size: 100 while it is inside the real range (up to the `goodPct` percentile),
 * falling to 0 at the `badPct` percentile and beyond (mirrored for metrics where too little is the failure). Five sub-scores combine their
 * metrics, and the score combines the sub-scores by weight, never above the weakest hard sub-score plus {@link CAP_MARGIN}: a scene cannot be
 * carried by four good parts past one that fails. A run longer than a beat is judged in windows of {@link CHUNK_SAY_TURNS} speech turns.
 */

export type SubName = "length" | "novelty" | "motif" | "progress" | "debt";

/**
 * What each sub-score reads, with weights. A `hard` metric is one a real script almost never fails (turns of 30 words, a phrase three turns
 * share, lines that only repeat the room): failing it caps the score. The others (few short replies, a topic word kept for three turns, no
 * promise or accusation, a question left owing) are things a real beat does now and then and only pull the mean down.
 */
const SUBS: Readonly<Record<SubName, { weight: number; hard: boolean; metrics: ReadonlyArray<readonly [BeatMetric, number, boolean]> }>> = {
  length: { weight: 0.3, hard: true, metrics: [["medianWords", 0.3, true], ["over25", 0.3, true], ["over40", 0.1, true], ["p90Words", 0.1, true], ["short", 0.2, false]] },
  novelty: { weight: 0.2, hard: true, metrics: [["noveltyMean", 1, true]] },
  motif: { weight: 0.2, hard: true, metrics: [["loopTurns", 0.5, true], ["echoTurns", 0.25, true], ["topicTurns", 0.25, false]] },
  progress: { weight: 0.2, hard: false, metrics: [["majorPer10", 0.5, false], ["stall", 0.5, false]] },
  debt: { weight: 0.1, hard: false, metrics: [["debtPer10", 1, false]] },
};
export const SUB_NAMES = Object.keys(SUBS) as SubName[];

/** The score never exceeds the lowest hard sub-score by more than this; inside a sub-score the same rule is applied, to its hard metrics, with {@link METRIC_CAP_MARGIN}. */
export const CAP_MARGIN = 25;
export const METRIC_CAP_MARGIN = 30;
/** Speech turns in a scoring window; a remainder shorter than the minimum joins the window before it. */
export const CHUNK_SAY_TURNS = 10;

export type MetricReading = {
  metric: BeatMetric;
  value: number;
  /** 0-100. */
  score: number;
  /** Where the value sits among real beats of this size (0-100). For a metric where too much is the failure, 95 means worse than 95% of real beats. */
  percentile: number;
  good: number;
  bad: number;
};

export type SubScore = { score: number; metrics: MetricReading[] };

export type WindowScore = {
  score: number;
  /** Percentile of the corpus beats' own scores this score corresponds to. */
  percentile: number;
  sub: Partial<Record<SubName, SubScore>>;
  bucket: Bucket;
  sayTurns: number;
  lowN: boolean;
};

const clamp100 = (v: number): number => Math.max(0, Math.min(100, v));

/** One metric against its ladder: 100 inside the real range, 0 past the bad end, linear between. */
export function metricScore(value: number, ladder: Ladder, dir: "high" | "low", goodPct: number, badPct: number): { score: number; good: number; bad: number } {
  if (dir === "high") {
    const good = ladderValue(ladder, goodPct);
    const bad = ladderValue(ladder, badPct);
    if (value <= good) return { score: 100, good, bad };
    if (bad <= good) return { score: 0, good, bad };
    return { score: clamp100(((bad - value) / (bad - good)) * 100), good, bad };
  }
  const good = ladderValue(ladder, 100 - goodPct);
  const bad = ladderValue(ladder, 100 - badPct);
  if (value >= good) return { score: 100, good, bad };
  if (bad >= good) return { score: 0, good, bad };
  return { score: clamp100(((value - bad) / (good - bad)) * 100), good, bad };
}

/** Weighted mean, held to the lowest hard part plus `margin` (no cap when no part is hard). */
function combine(parts: ReadonlyArray<{ score: number; weight: number; hard: boolean }>, margin: number): number {
  const total = parts.reduce((a, p) => a + p.weight, 0);
  if (total === 0) return 100;
  const mean = parts.reduce((a, p) => a + p.score * p.weight, 0) / total;
  const hard = parts.filter((p) => p.hard).map((p) => p.score);
  return hard.length === 0 ? mean : Math.min(mean, Math.min(...hard) + margin);
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

export type MetricValues = Partial<Record<BeatMetric, number>>;

/** Scores metric values against the norms. Metrics left out are not scored, and a sub-score with none is left out too. */
export function scoreMetrics(values: MetricValues, ctx: { language: ScriptLang; medium?: ScriptMedium; sayTurns: number; norms: ScriptNorms }): (WindowScore & { medium: ScriptMedium; mediumFallback: boolean }) | undefined {
  const found = normsFor(ctx.norms, ctx.language, ctx.medium ?? "THEATRE");
  if (!found) return undefined;
  const bucket = bucketOf(ctx.sayTurns);
  const ladders = found.block.buckets[bucket].metrics;
  const sub: Partial<Record<SubName, SubScore>> = {};
  const parts: Array<{ score: number; weight: number; hard: boolean }> = [];
  for (const name of SUB_NAMES) {
    const readings: MetricReading[] = [];
    const weights: Array<{ score: number; weight: number; hard: boolean }> = [];
    for (const [metric, weight, hard] of SUBS[name].metrics) {
      const value = values[metric];
      if (value === undefined || Number.isNaN(value)) continue;
      const ladder = ladders[metric];
      const r = metricScore(value, ladder, METRIC_DIR[metric], ctx.norms.params.goodPct, ctx.norms.params.badPct);
      readings.push({ metric, value: Math.round(value * 1000) / 1000, score: round1(r.score), percentile: round1(percentileIn(ladder, value)), good: Math.round(r.good * 1000) / 1000, bad: Math.round(r.bad * 1000) / 1000 });
      weights.push({ score: r.score, weight, hard });
    }
    if (weights.length === 0) continue;
    const score = combine(weights, METRIC_CAP_MARGIN);
    sub[name] = { score: round1(score), metrics: readings };
    parts.push({ score, weight: SUBS[name].weight, hard: SUBS[name].hard });
  }
  const score = combine(parts, CAP_MARGIN);
  return {
    score: round1(score),
    percentile: round1(percentileIn(found.block.score, score)),
    sub,
    bucket,
    sayTurns: ctx.sayTurns,
    lowN: ctx.sayTurns < MIN_SAY_TURNS,
    medium: found.medium,
    mediumFallback: found.fallback,
  };
}

/** Scores the stats of one beat-sized stretch. */
export function scoreStats(stats: ScriptStats, norms: ScriptNorms, medium: ScriptMedium = "THEATRE"): WindowScore & { medium: ScriptMedium; mediumFallback: boolean } {
  const r = scoreMetrics(beatMetrics(stats), { language: stats.language, medium, sayTurns: stats.sayTurns, norms });
  if (!r) throw new Error(`no script norms for language "${stats.language}"`);
  return r;
}

/** Windows of about {@link CHUNK_SAY_TURNS} speech turns, acts staying with the speech around them. */
export function windowsOf(turns: readonly ScriptTurn[]): ScriptTurn[][] {
  const windows: ScriptTurn[][] = [];
  let cur: ScriptTurn[] = [];
  let say = 0;
  for (const t of turns) {
    if (isSay(t) && say === CHUNK_SAY_TURNS) {
      windows.push(cur);
      cur = [];
      say = 0;
    }
    cur.push(t);
    if (isSay(t)) say++;
  }
  if (cur.length > 0) {
    const last = windows[windows.length - 1];
    if (last && say < MIN_SAY_TURNS) last.push(...cur);
    else windows.push(cur);
  }
  return windows;
}

export type ScriptScore = {
  /** 0-100, the mean of the windows' scores. */
  score: number;
  /** Percentile of the corpus beats' own scores that this score corresponds to. */
  percentile: number;
  /** The mean of each sub-score over the windows that had it. */
  sub: Partial<Record<SubName, number>>;
  windows: WindowScore[];
  /** The lowest window's score. */
  worst: number;
  language: ScriptLang;
  medium: ScriptMedium;
  /** The norms had no block for the medium asked for and read THEATRE (CINEMA has no ingestible corpus today). */
  mediumFallback: boolean;
  sayTurns: number;
  /** Stats over the whole transcript, for the readable detail (motifs found, questions left owing). */
  stats: ScriptStats;
  lowN: boolean;
};

export type ScoreOptions = { norms: ScriptNorms; language?: ScriptLang; medium?: ScriptMedium; names?: Iterable<string> };

/** Scores a transcript (any length) against the norms. */
export function scoreTurns(turns: readonly ScriptTurn[], opts: ScoreOptions): ScriptScore {
  const say = turns.filter(isSay);
  const language = opts.language ?? detectLang(say.map((t) => t.text));
  const medium = opts.medium ?? "THEATRE";
  const names = [...(opts.names ?? [])];
  const windows = windowsOf(turns).map((w) => scoreStats(computeScriptStats(w, { language, names }), opts.norms, medium));
  const sub: Partial<Record<SubName, number>> = {};
  for (const name of SUB_NAMES) {
    const have = windows.map((w) => w.sub[name]?.score).filter((v): v is number => v !== undefined);
    if (have.length > 0) sub[name] = round1(have.reduce((a, b) => a + b, 0) / have.length);
  }
  const mean = (f: (w: WindowScore) => number): number => (windows.length === 0 ? 0 : windows.reduce((a, w) => a + f(w), 0) / windows.length);
  return {
    score: round1(mean((w) => w.score)),
    percentile: round1(mean((w) => w.percentile)),
    sub,
    windows,
    worst: windows.length === 0 ? 0 : Math.min(...windows.map((w) => w.score)),
    language,
    medium,
    mediumFallback: windows[0]?.mediumFallback ?? false,
    sayTurns: say.length,
    stats: computeScriptStats(turns, { language, names }),
    lowN: say.length < MIN_SAY_TURNS,
  };
}
