import { MIN_SAY_TURNS, computeScriptStats } from "./metrics.js";
import type { ScriptStats } from "./metrics.js";
import { METRIC_DIR, METRIC_GOOD_PCT, SCENE_ARC_FROM_TURNS, SCENE_FROM_TURNS, bucketOf, ladderValue, normsFor, percentileIn, beatMetrics, sceneBucketOf } from "./norms.js";
import type { BeatMetric, Bucket, Ladder, LangNorms, SceneBucket, ScriptMedium, ScriptNorms } from "./norms.js";
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
 * carried by four good parts past one that fails.
 *
 * A run is scored whole. Under {@link SCENE_FROM_TURNS} speech turns it is read next to real beats of its size; from there on, next to real scenes
 * (consecutive beats joined), with turn length read against the plays' turn-level figures (see {@link lengthScene}), and from
 * {@link SCENE_ARC_FROM_TURNS} turns the scene must show an arc ({@link progressScene}). Windows of {@link CHUNK_SAY_TURNS} turns are scored too, for
 * diagnosis only: the score is not their mean.
 */

export type SubName = "length" | "novelty" | "motif" | "progress" | "debt" | "reactions" | "repeats";

/**
 * What each sub-score reads, with weights. A `hard` metric is one a real script almost never fails (turns of 30 words, a phrase three turns
 * share, lines that only repeat the room, a line that is only "Ah."): failing it caps the score. The others (few short replies, a topic word kept for three turns, no
 * promise or accusation, a question left owing) are things a real beat does now and then and only pull the mean down.
 */
const SUBS: Readonly<Record<SubName, { weight: number; hard: boolean; metrics: ReadonlyArray<readonly [BeatMetric, number, boolean]> }>> = {
  length: { weight: 0.3, hard: true, metrics: [["medianWords", 0.3, true], ["over25", 0.3, true], ["over40", 0.1, true], ["p90Words", 0.1, true], ["short", 0.2, false]] },
  novelty: { weight: 0.2, hard: true, metrics: [["noveltyMean", 1, true]] },
  motif: { weight: 0.2, hard: true, metrics: [["loopTurns", 0.5, true], ["echoTurns", 0.25, true], ["topicTurns", 0.25, false]] },
  progress: { weight: 0.2, hard: false, metrics: [["majorPer10", 0.5, false], ["stall", 0.5, false]] },
  debt: { weight: 0.1, hard: false, metrics: [["debtPer10", 1, false]] },
  // Gates: no weight in the mean, only the cap. A run made of "Ué." and "Hm.", or one actor making the same demand or leaning on one word turn
  // after turn, cannot be carried by the parts that read content (length, novelty and loops are read over the content turns only).
  reactions: { weight: 0, hard: true, metrics: [["reactionShare", 1, true]] },
  repeats: { weight: 0, hard: true, metrics: [["demandTurns", 0.5, true], ["ticTurns", 0.5, true]] },
};
export const SUB_NAMES = Object.keys(SUBS) as SubName[];

/** The score never exceeds the lowest hard sub-score by more than this; inside a sub-score the same rule is applied, to its hard metrics, with {@link METRIC_CAP_MARGIN}. */
export const CAP_MARGIN = 25;
export const METRIC_CAP_MARGIN = 30;
/** Speech turns in a diagnostic window (the size from which a run is read as a scene); a remainder shorter than the minimum joins the window before it. */
export const CHUNK_SAY_TURNS = SCENE_FROM_TURNS;

/** A metric a reading can name: the ladder metrics, and the two a whole run is read on without a ladder of its own. */
export type ReadMetric = BeatMetric | "p75Words" | "lateReversal";

export type MetricReading = {
  metric: ReadMetric;
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
  /** Read next to real beats of the run's size, or next to real scenes (13 speech turns or more). */
  scale: "beat" | "scene";
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

export type MetricValues = Partial<Record<ReadMetric, number>>;

/** Turn length of a whole run is read against the plays' turn-level figure times these: 100 up to {@link LENGTH_GOOD_X}, 0 from {@link LENGTH_BAD_X}, linear between. */
export const LENGTH_GOOD_X = 1.5;
export const LENGTH_BAD_X = 3;
/** A scene of {@link SCENE_ARC_FROM_TURNS} turns or more must have one major event per this many content turns. */
export const ARC_TURNS_PER_MAJOR = 12;
/** The stall of a long scene scores 100 up to this percentile of real scenes, 0 at the worst one. */
export const STALL_GOOD_PCT = 90;

const lin = (value: number, good: number, bad: number): number => (value <= good ? 100 : value >= bad ? 0 : clamp100(((bad - value) / (bad - good)) * 100));

type Part = { score: number; weight: number; hard: boolean };

function reading(metric: ReadMetric, value: number, score: number, ladder: Ladder | undefined, good: number, bad: number): MetricReading {
  return { metric, value: Math.round(value * 1000) / 1000, score: round1(score), percentile: ladder ? round1(percentileIn(ladder, value)) : 0, good: Math.round(good * 1000) / 1000, bad: Math.round(bad * 1000) / 1000 };
}

/**
 * Length of a whole run, read against the plays' turn-level figures (the median, 75th and 90th percentile turn, the share over 25 and over 40 words,
 * the share of short replies) and not against the 97.5th percentile of beats: full marks up to {@link LENGTH_GOOD_X} times the figure, zero at
 * {@link LENGTH_BAD_X} times, linear between (for the short-reply share, the same factors the other way up). The median, 75th percentile and share over 25 words
 * cap the sub-score; the far tail (share over 40, 90th percentile) only pulls the mean: a few speeches are what a play has, and over a scene that tail is the noisiest figure.
 */
export function lengthScene(values: MetricValues, words: LangNorms["words"], ladders: Partial<Record<BeatMetric, Ladder>>): SubScore | undefined {
  const at = (p: number): number => ladderValue(words.ladder, p);
  const parts: Array<[ReadMetric, number, boolean, number, "high" | "low", Ladder | undefined]> = [
    ["medianWords", 0.25, true, at(50), "high", ladders.medianWords],
    ["p75Words", 0.15, true, at(75), "high", undefined],
    ["over25", 0.25, true, words.over25, "high", ladders.over25],
    ["over40", 0.1, false, words.over40, "high", ladders.over40],
    ["p90Words", 0.1, false, at(90), "high", ladders.p90Words],
    ["short", 0.2, false, words.short, "low", ladders.short],
  ];
  const readings: MetricReading[] = [];
  const weights: Part[] = [];
  for (const [metric, weight, hard, target, dir, ladder] of parts) {
    const value = values[metric];
    if (value === undefined || Number.isNaN(value)) continue;
    const good = dir === "high" ? target * LENGTH_GOOD_X : target / LENGTH_GOOD_X;
    const bad = dir === "high" ? target * LENGTH_BAD_X : target / LENGTH_BAD_X;
    const score = dir === "high" ? lin(value, good, bad) : lin(-value, -good, -bad);
    readings.push(reading(metric, value, score, ladder, good, bad));
    weights.push({ score, weight, hard });
  }
  if (weights.length === 0) return undefined;
  return { score: round1(combine(weights, METRIC_CAP_MARGIN)), metrics: readings };
}

/**
 * The arc of a scene of {@link SCENE_ARC_FROM_TURNS} speech turns or more: one major event (promise, accusation, reveal, a real act, a reversal) per
 * {@link ARC_TURNS_PER_MAJOR} content turns, no stretch without one longer than real scenes allow (the {@link STALL_GOOD_PCT}th percentile of scenes this size,
 * zero at the longest real one), and a reversal of who asks and who answers in the second half. Bare moves do not count as major events.
 */
export function progressScene(values: MetricValues, ladders: Partial<Record<BeatMetric, Ladder>>): SubScore | undefined {
  const readings: MetricReading[] = [];
  const weights: Part[] = [];
  const maj = values.majorPer10;
  if (maj !== undefined && !Number.isNaN(maj)) {
    const floor = 10 / ARC_TURNS_PER_MAJOR;
    const score = lin(-maj, -floor, 0);
    readings.push(reading("majorPer10", maj, score, ladders.majorPer10, floor, 0));
    weights.push({ score, weight: 0.4, hard: false });
  }
  const stall = values.stall;
  const stallLadder = ladders.stall;
  if (stall !== undefined && !Number.isNaN(stall) && stallLadder) {
    const good = ladderValue(stallLadder, STALL_GOOD_PCT);
    const bad = ladderValue(stallLadder, 100);
    const score = bad <= good ? (stall <= good ? 100 : 0) : lin(stall, good, bad);
    readings.push(reading("stall", stall, score, stallLadder, good, bad));
    weights.push({ score, weight: 0.3, hard: false });
  }
  const late = values.lateReversal;
  if (late !== undefined) {
    const score = late >= 1 ? 100 : 0;
    readings.push(reading("lateReversal", late, score, undefined, 1, 0));
    weights.push({ score, weight: 0.3, hard: false });
  }
  if (weights.length === 0) return undefined;
  return { score: round1(combine(weights, METRIC_CAP_MARGIN)), metrics: readings };
}

export type ScoreScale = "beat" | "scene" | "auto";

/**
 * Scores metric values against the norms. Metrics left out are not scored, and a sub-score with none is left out too. `scale` "auto" reads a run
 * of {@link SCENE_FROM_TURNS} speech turns or more next to scenes when the norms have them, a shorter one next to beats of its size.
 */
export function scoreMetrics(
  values: MetricValues,
  ctx: { language: ScriptLang; medium?: ScriptMedium; sayTurns: number; norms: ScriptNorms; scale?: ScoreScale },
): (WindowScore & { medium: ScriptMedium; mediumFallback: boolean }) | undefined {
  const found = normsFor(ctx.norms, ctx.language, ctx.medium ?? "THEATRE");
  if (!found) return undefined;
  const bucket = bucketOf(ctx.sayTurns);
  const scene = found.block.scene;
  const scale = (ctx.scale ?? "auto") === "beat" || !scene || ctx.sayTurns < SCENE_FROM_TURNS ? "beat" : "scene";
  const sceneBucket: SceneBucket = sceneBucketOf(ctx.sayTurns);
  const ladders: Partial<Record<BeatMetric, Ladder>> = scale === "scene" ? scene!.buckets[sceneBucket].metrics : found.block.buckets[bucket].metrics;
  const sub: Partial<Record<SubName, SubScore>> = {};
  const parts: Part[] = [];
  for (const name of SUB_NAMES) {
    let result: SubScore | undefined;
    if (scale === "scene" && name === "length") result = lengthScene(values, found.block.words, ladders);
    else if (scale === "scene" && name === "progress" && ctx.sayTurns >= SCENE_ARC_FROM_TURNS) result = progressScene(values, ladders);
    else {
      const readings: MetricReading[] = [];
      const weights: Part[] = [];
      for (const [metric, weight, hard] of SUBS[name].metrics) {
        const value = values[metric];
        const ladder = ladders[metric];
        if (value === undefined || Number.isNaN(value) || !ladder) continue;
        const r = metricScore(value, ladder, METRIC_DIR[metric], METRIC_GOOD_PCT[metric] ?? ctx.norms.params.goodPct, ctx.norms.params.badPct);
        readings.push(reading(metric, value, r.score, ladder, r.good, r.bad));
        weights.push({ score: r.score, weight, hard });
      }
      if (weights.length > 0) result = { score: round1(combine(weights, METRIC_CAP_MARGIN)), metrics: readings };
    }
    if (!result) continue;
    sub[name] = result;
    parts.push({ score: result.score, weight: SUBS[name].weight, hard: SUBS[name].hard });
  }
  const score = combine(parts, CAP_MARGIN);
  const scoreLadder = scale === "scene" ? scene!.score : found.block.score;
  return {
    score: round1(score),
    percentile: round1(percentileIn(scoreLadder, score)),
    sub,
    bucket,
    sayTurns: ctx.sayTurns,
    lowN: ctx.sayTurns < MIN_SAY_TURNS,
    scale,
    medium: found.medium,
    mediumFallback: found.fallback,
  };
}

/** The metric values of the stats of one run or window, the ones a score reads. */
export function runMetrics(stats: ScriptStats): MetricValues {
  return { ...beatMetrics(stats), p75Words: stats.length.p75, lateReversal: stats.progress.lateReversal ? 1 : 0 };
}

/** Scores the stats of one run or window (see {@link scoreMetrics} for the scale). */
export function scoreStats(stats: ScriptStats, norms: ScriptNorms, medium: ScriptMedium = "THEATRE", scale: ScoreScale = "auto"): WindowScore & { medium: ScriptMedium; mediumFallback: boolean } {
  const r = scoreMetrics(runMetrics(stats), { language: stats.language, medium, sayTurns: stats.sayTurns, norms, scale });
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
  /** 0-100, of the run as a whole (not the mean of its windows). */
  score: number;
  /** Percentile of the real beats' (under 13 turns) or scenes' (13 or more) own scores that this score corresponds to. */
  percentile: number;
  /** The whole run's sub-scores. */
  sub: Partial<Record<SubName, number>>;
  /** The whole run's score with every metric reading. */
  whole: WindowScore;
  /** Windows of {@link CHUNK_SAY_TURNS} speech turns, each read next to real beats of that size: diagnosis only, not part of the score. */
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

/** Scores a transcript (any length) against the norms, whole. */
export function scoreTurns(turns: readonly ScriptTurn[], opts: ScoreOptions): ScriptScore {
  const say = turns.filter(isSay);
  const language = opts.language ?? detectLang(say.map((t) => t.text));
  const medium = opts.medium ?? "THEATRE";
  const names = [...(opts.names ?? [])];
  const stats = computeScriptStats(turns, { language, names });
  const whole = scoreStats(stats, opts.norms, medium);
  const windows = windowsOf(turns).map((w) => scoreStats(computeScriptStats(w, { language, names }), opts.norms, medium, "beat"));
  const sub: Partial<Record<SubName, number>> = {};
  for (const name of SUB_NAMES) if (whole.sub[name]) sub[name] = whole.sub[name]!.score;
  return {
    score: whole.score,
    percentile: whole.percentile,
    sub,
    whole,
    windows,
    worst: windows.length === 0 ? whole.score : Math.min(...windows.map((w) => w.score)),
    language,
    medium,
    mediumFallback: whole.mediumFallback,
    sayTurns: say.length,
    stats,
    lowN: say.length < MIN_SAY_TURNS,
  };
}
