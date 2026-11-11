/**
 * The cinematic score's norms from E1's cinema corpus (`CINEMA_NORMS` in @perfectman/shared; docs/plans/cinema-norms.md), where E1 measured the thing.
 *
 *  - RHYTHM (`turnsPerMin`, `silenceShare`, `shortReplyShare`): the Portuguese (or the run's language) subtitle buckets, film and series pooled. Subtitles
 *    are the only source with real cue times, so silence and pace are real there. A subtitle cue is shorter than a spoken turn, so the short-reply ladder is
 *    shifted by `calibration.ptAdjusted.*` (film 0.45, series 0.38 at the median, against 0.56 and 0.51 raw). Scenes in subtitle files are cut at 12 s of
 *    silence, so a long dead stretch is invisible there: `deadAirShare` stays a prior.
 *  - STRUCTURE (`incitingPos`, `climaxPos`, `aftermathShare`, `reversals`, `interruptionShare`): English film screenplays and TV transcripts pooled
 *    (no Portuguese text with action lines exists at scale; pt-BR structure is borrowed from English and cross-checked with 36 Brazilian stage texts).
 *    Position ladders are the `strongArc` ones (E1's hand-check: arc detection plausible in 60% of scenes, 16 of 18 on strong arcs). `--genre melodrama`
 *    reads `en/series/transcript/melodrama` instead.
 *  - ACTION (`actsPerMin`, `hardActs`): English film screenplays only. TV transcripts mostly leave action lines out (their median is 0 directions a
 *    minute), which describes the format, not the scene; a genre with no screenplay bucket (melodrama) falls back to the all-genre screenplays.
 *  - NOT measured by the corpus, left as priors: escalation shape, peak weight, stakes, dead air, pause beats, subtext, reply adherence, stale replies, every
 *    body and camera metric except `actsPerMin` and `hardActs`. No camera exists in any corpus.
 *  - PRODUCT, not a statistic: `timeToClimaxS` (physical climax by 4:00). The corpus median climax is at ~0.58 of the scene; a 6 minute scene with the
 *    climax at 3.5 minutes matches it, which is why the product band is flat to 3:30. The invariant itself (arc.ts `climaxInvariant`, the cap in score.ts)
 *    reads no norm.
 *
 * A band is full marks inside `[lo, hi]` and falls to 0 at `floor` / `ceil`, which are the ladder's p5 / p95 stretched twice as far from the band as they
 * are (a ladder this narrow would otherwise drop 100 -> 0 within a few percentile points).
 */
import { CINEMA_NORMS, SCRIPT_NORMS, cinemaBucketKey, type CinemaBucket, type CinemaCurveBand, type CinemaGenre, type CinemaLadder, type CinemaLang, type CinemaNorms as CorpusNorms } from "@perfectman/shared";
import { FALLBACK_NORMS, METRIC_IDS, type Band, type BandSource, type CinemaNorms, type MetricId, type SizeStratum } from "./norms.js";

export type NormRole = "rhythm" | "structure" | "action";
export type NormMapEntry = {
  metric: MetricId;
  status: BandSource;
  /** `measured` metrics: the corpus feature (a key of `ladders`, `strongArc.ladders` or `bySize`). */
  feature?: string;
  role?: NormRole;
  from?: "ladders" | "strongArc" | "bySize";
  /** Percentiles bounding full marks. */
  band?: readonly [keyof CinemaLadder, keyof CinemaLadder];
  /** The metric's value is clamped to this range when the band is built. */
  range?: readonly [number, number | null];
  why: string;
};

const m = (e: Omit<NormMapEntry, "status">): NormMapEntry => ({ status: "cinema-norms", ...e });
const p = (metric: MetricId, why: string): NormMapEntry => ({ metric, status: "prior", why });

/** The mapping from this scorer's metric ids to E1's norm ids, one entry per metric, `measured` (cinema-norms) or `prior` or `product`. */
export const NORM_MAP: readonly NormMapEntry[] = [
  // ---- arc
  m({ metric: "incitingPos", role: "structure", from: "strongArc", feature: "tInciting", band: ["p25", "p75"], range: [0, 1], why: "inciting beat as a share of the scene; strong-arc scenes, film screenplays + series transcripts" }),
  m({ metric: "reversals", role: "structure", from: "bySize", feature: "reversals", band: ["p50", "p90"], range: [1, null], why: "turning points of the intensity curve in the scene, by scene size (strong-arc ladder when the size is unknown); at least 1" }),
  p("escalationShape", "the corpus has the intensity curve (`curves.shape`) but no scalar for how steadily it rises; the run's curve fit is reported in the arc detail only"),
  p("peakIntensity", "act-ladder weights are this engine's own scale; the corpus peak is a 0-1 text proxy on a different scale"),
  { metric: "timeToClimaxS", status: "product", why: "owner requirement: a physical climax by 4:00. Corpus median climax is at 0.58 of the scene (a 6 minute scene -> 3.5 minutes), consistent with it, but the band is not derived from it" },
  m({ metric: "climaxPos", role: "structure", from: "strongArc", feature: "tClimax", band: ["p25", "p75"], range: [0, 1], why: "peak of the intensity curve as a share of the scene; strong-arc scenes" }),
  m({ metric: "aftermathShare", role: "structure", from: "strongArc", feature: "aftermathShare", band: ["p25", "p75"], range: [0, 1], why: "scene time after intensity last holds 70% of its rise; strong-arc scenes" }),
  p("stakesChange", "memory intensity and tone are the engine's own; no corpus counterpart"),
  // ---- dialogue
  m({ metric: "interruptionShare", role: "structure", from: "ladders", feature: "interruptShare", band: ["p10", "p90"], range: [0, 1], why: "turns cut off by a dash; screenplays and transcripts carry them, subtitle files do not (their ladder is all 0)" }),
  p("deadAirShare", "subtitle scenes are cut at 12 s of silence: stretches of dead air over 10 s are not in the rhythm ladders"),
  p("pauseBeatsPerMin", "'a pause with business in it' has no counterpart in any corpus; gaps over 2 s per minute are corpus-measured but do not know what filled them"),
  p("subtext", "no corpus counterpart"),
  p("replyAdherence", "no corpus counterpart"),
  p("staleReplyShare", "no corpus counterpart"),
  m({ metric: "turnsPerMin", role: "rhythm", from: "ladders", feature: "turnsPerMin", band: ["p10", "p90"], range: [0, null], why: "spoken turns per minute of scene; subtitle buckets, film + series, scaled by the same-medium English screenplay / subtitle ratio for the cue-splitting bias (no ptAdjusted entry exists for it)" }),
  m({ metric: "silenceShare", role: "rhythm", from: "ladders", feature: "silenceShare", band: ["p10", "p90"], range: [0, 1], why: "share of the scene span with nobody talking; subtitle buckets (real cue times)" }),
  m({ metric: "shortReplyShare", role: "rhythm", from: "ladders", feature: "shortShare", band: ["p10", "p90"], range: [0, 1], why: "turns of 5 words or fewer; subtitle buckets, shifted by calibration.ptAdjusted for the cue-length bias" }),
  // ---- embodiment
  m({ metric: "actsPerMin", role: "action", from: "ladders", feature: "actsPerMin", band: ["p25", "p90"], range: [0, null], why: "directions that carry a body act per minute; film screenplays only (TV transcripts mostly leave action lines out, so their median of 0 is the format, not the scene)" }),
  m({ metric: "hardActs", role: "action", from: "bySize", feature: "hardActs", band: ["p50", "p95"], range: [1, null], why: "hard physical acts (strike, shove, grab, kill, collapse, kiss, embrace) in the scene, by scene size; at least 1" }),
  p("distinctVerbs", "the engine's act vocabulary has no corpus counterpart"),
  p("ladderSpan", "the drama ladder is the engine's own"),
  p("topVerbShare", "no corpus counterpart"),
  p("distinctFaces", "no corpus counterpart"),
  p("distinctGestures", "no corpus counterpart"),
  p("reactionIntegrity", "an engine contract (owed reactions), not a corpus property"),
  p("walksPerActorMin", "no corpus counterpart"),
  p("distinctTilesPerActor", "no corpus counterpart"),
  p("proximityChanges", "no corpus counterpart"),
  p("entranceShare", "no corpus counterpart"),
  p("exits", "no corpus counterpart"),
  // ---- camera: no corpus has a camera
  p("distinctShots", "no camera in any corpus"),
  p("topShotShare", "no camera in any corpus"),
  p("shotsPerMin", "no camera in any corpus"),
  p("shortShotShare", "no camera in any corpus"),
  p("shotOnSpeaker", "no camera in any corpus"),
  p("staleDropRate", "an engine contract, not a corpus property"),
]


export const NORM_MAP_BY_METRIC: Readonly<Record<MetricId, NormMapEntry>> = Object.fromEntries(NORM_MAP.map((e) => [e.metric, e])) as Record<MetricId, NormMapEntry>;

// ---------------------------------------------------------------------------------------------------------------------
// ladders: pooling, shifting, bands
// ---------------------------------------------------------------------------------------------------------------------

const POINTS = ["p5", "p10", "p25", "p50", "p75", "p90", "p95"] as const;

/** Pointwise mean of the percentile points (a quantile average) of several ladders; n adds up. */
export function poolLadders(ls: readonly CinemaLadder[]): CinemaLadder {
  const out = { n: ls.reduce((a, l) => a + l.n, 0) } as CinemaLadder;
  for (const k of POINTS) out[k] = ls.reduce((a, l) => a + l[k], 0) / ls.length;
  return out;
}

/** Every percentile moved by `delta`, clamped to [lo, hi] (a ladder of shares must stay inside 0..1). */
export function shiftLadder(l: CinemaLadder, delta: number, lo = 0, hi: number | null = null): CinemaLadder {
  const out = { n: l.n } as CinemaLadder;
  for (const k of POINTS) out[k] = Math.min(hi ?? Infinity, Math.max(lo, l[k] + delta));
  return out;
}

/** Every percentile multiplied by `k`. */
export function scaleLadder(l: CinemaLadder, k: number): CinemaLadder {
  const out = { n: l.n } as CinemaLadder;
  for (const key of POINTS) out[key] = l[key] * k;
  return out;
}

/** A band over `[lo, hi]` percentiles of a ladder, stretched to zero marks at twice the distance to p5 / p95, kept inside `range`. */
export function bandOfLadder(l: CinemaLadder, lo: keyof CinemaLadder, hi: keyof CinemaLadder, range: readonly [number, number | null] = [0, null]): Band {
  const clampHi = (v: number): number => (range[1] === null ? v : Math.min(range[1], v));
  const L = Math.max(range[0], l[lo] as number);
  const H = Math.max(L, clampHi(l[hi] as number));
  const floor = Math.max(range[0], L - 2 * Math.max(0, L - l.p5));
  const ceil = clampHi(H + 2 * Math.max(0, l.p95 - H));
  return { lo: L, hi: H, floor, ceil, source: "cinema-norms" };
}

// ---------------------------------------------------------------------------------------------------------------------
// bucket choice
// ---------------------------------------------------------------------------------------------------------------------

export type CorpusNormsOptions = {
  /** The run's language: the rhythm buckets. Structure and action are English either way. */
  lang: "pt" | "en";
  /** Narrows the structure buckets to one genre (`melodrama` reads the soap-opera transcripts only). */
  genre?: CinemaGenre;
  /** Another build of the corpus norms (tests); default `CINEMA_NORMS`. */
  corpus?: CorpusNorms;
};

type Picked = { key: string; bucket: CinemaBucket };

function pick(corpus: CorpusNorms, keys: readonly string[]): Picked[] {
  return keys.flatMap((key) => (corpus.buckets[key] ? [{ key, bucket: corpus.buckets[key]! }] : []));
}

/** Subtitle buckets for rhythm: film and series of the run's language (a genre bucket when one exists, else the all-genre one). */
export function rhythmBuckets(corpus: CorpusNorms, lang: CinemaLang, genre?: CinemaGenre): Picked[] {
  return (["film", "series"] as const).flatMap((medium) => {
    const g = genre ? pick(corpus, [cinemaBucketKey(lang, medium, "subtitle", genre)]) : [];
    return g.length > 0 ? g : pick(corpus, [cinemaBucketKey(lang, medium, "subtitle")]);
  });
}

/** Screenplay and transcript buckets for structure and action. With a genre: the genre buckets that exist (melodrama: soap transcripts only). */
export function structureBuckets(corpus: CorpusNorms, genre?: CinemaGenre): Picked[] {
  const base = [cinemaBucketKey("en", "film", "screenplay"), cinemaBucketKey("en", "series", "transcript")];
  if (!genre) return pick(corpus, base);
  const g = pick(corpus, base.map((k) => `${k}/${genre}`));
  return g.length > 0 ? g : pick(corpus, base);
}

/** Film screenplays for action lines: the genre bucket when there is one, else the all-genre one. */
export function actionBuckets(corpus: CorpusNorms, genre?: CinemaGenre): Picked[] {
  const base = cinemaBucketKey("en", "film", "screenplay");
  const g = genre ? pick(corpus, [`${base}/${genre}`]) : [];
  return g.length > 0 ? g : pick(corpus, [base]);
}

const pooledOf = (buckets: readonly Picked[], from: "ladders" | "strongArc", feature: string): CinemaLadder | null => {
  const ls = buckets.flatMap((b) => {
    const l = from === "strongArc" ? b.bucket.strongArc?.ladders[feature] : b.bucket.ladders[feature];
    return l ? [l] : [];
  });
  return ls.length > 0 ? poolLadders(ls) : null;
};

const pooledSized = (buckets: readonly Picked[], stratum: SizeStratum, feature: string): CinemaLadder | null => {
  const ls = buckets.flatMap((b) => {
    const l = b.bucket.bySize[stratum]?.[feature];
    return l ? [l] : [];
  });
  return ls.length > 0 ? poolLadders(ls) : null;
};

/** `calibration.ptAdjusted.<film|series>.shortShare` minus the bucket's raw median, per medium; 0 for any other language or when E1 did not record it. */
function cueBiasDelta(corpus: CorpusNorms, lang: CinemaLang, b: Picked): number {
  if (lang !== "pt") return 0;
  const medium = b.key.split("/")[1];
  const adjusted = corpus.calibration[`ptAdjusted.${medium}.shortShare`];
  const raw = b.bucket.ladders["shortShare"]?.p50;
  return adjusted === undefined || raw === undefined ? 0 : adjusted - raw;
}

/**
 * Subtitle cues are not spoken turns: a long speech is split over several cues, so turns per minute read off a subtitle file is higher than a screenplay's
 * (English films: 16.4 in subtitles, 9.9 in screenplays; series 17.8 and 11.3). E1's `calibration.ptAdjusted` has no turns-per-minute entry, so the
 * correction is the same-language, same-medium ratio of the screenplay (transcript) median to the subtitle median, applied to the run's language. It is a
 * scale on the whole ladder. Not corrected: `silenceShare` (a property of cue times, which are real).
 */
function turnsScale(corpus: CorpusNorms, b: Picked): number {
  const medium = b.key.split("/")[1]!;
  const text = corpus.buckets[`en/${medium}/${medium === "film" ? "screenplay" : "transcript"}`]?.ladders["turnsPerMin"]?.p50;
  const subs = corpus.buckets[`en/${medium}/subtitle`]?.ladders["turnsPerMin"]?.p50;
  return text === undefined || subs === undefined || subs <= 0 ? 1 : text / subs;
}

// ---------------------------------------------------------------------------------------------------------------------
// the norms
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Norms with every metric E1 measured read from the corpus (status `cinema-norms`) and the rest as they were (priors, and the product band). A metric
 * whose bucket or feature is missing from the corpus file keeps its prior, so a smaller corpus build still works.
 */
export function corpusNorms(opts: CorpusNormsOptions): CinemaNorms {
  const corpus = opts.corpus ?? CINEMA_NORMS;
  const rhythm = rhythmBuckets(corpus, opts.lang, opts.genre);
  const structure = structureBuckets(corpus, opts.genre);
  const action = actionBuckets(corpus, opts.genre);
  const bands: Record<MetricId, Band> = { ...FALLBACK_NORMS };
  const normSources = Object.fromEntries(METRIC_IDS.map((id) => [id, FALLBACK_NORMS[id].source])) as Record<MetricId, BandSource>;
  const sized: NonNullable<CinemaNorms["sized"]> = {};
  const refs: NonNullable<CinemaNorms["refs"]> = {};

  for (const e of NORM_MAP) {
    if (e.status !== "cinema-norms" || !e.feature || !e.band || !e.role || !e.from) continue;
    const buckets = e.role === "rhythm" ? rhythm : e.role === "action" ? action : structure;
    if (buckets.length === 0) continue;
    const range = e.range ?? [0, null];
    const where = `${buckets.map((b) => b.key).join(" + ")} ${e.from === "strongArc" ? "strongArc." : e.from === "bySize" ? "bySize." : ""}${e.feature} ${e.band[0]}-${e.band[1]}`;
    let ladder: CinemaLadder | null;
    if (e.metric === "shortReplyShare") {
      const ls = buckets.flatMap((b) => (b.bucket.ladders[e.feature!] ? [shiftLadder(b.bucket.ladders[e.feature!]!, cueBiasDelta(corpus, opts.lang, b), 0, 1)] : []));
      ladder = ls.length > 0 ? poolLadders(ls) : null;
    } else if (e.metric === "turnsPerMin") {
      const ls = buckets.flatMap((b) => (b.bucket.ladders[e.feature!] ? [scaleLadder(b.bucket.ladders[e.feature!]!, turnsScale(corpus, b))] : []));
      ladder = ls.length > 0 ? poolLadders(ls) : null;
    } else if (e.from === "bySize") {
      // the plain band is the all-size ladder; the sized ones are per scene-size stratum
      ladder = pooledOf(buckets, "ladders", e.feature);
      // (range starts at 1: the median of a size class that is mostly flat scenes is 0, which is no norm for "a scene that has one")
      for (const s of ["t8_19", "t20_39", "t40_plus"] as const) {
        const l = pooledSized(buckets, s, e.feature);
        if (l) (sized[e.metric] ??= {})[s] = bandOfLadder(l, e.band[0], e.band[1], range);
      }
    } else ladder = pooledOf(buckets, e.from, e.feature);
    // reversals without a size: the strong-arc ladder is the typical scene that has an arc
    if (e.metric === "reversals") ladder = pooledOf(buckets, "strongArc", "reversals") ?? ladder;
    if (!ladder) continue;
    bands[e.metric] = bandOfLadder(ladder, e.band[0], e.band[1], range);
    normSources[e.metric] = "cinema-norms";
    refs[e.metric] = where;
  }

  const shapes = structure.flatMap((b) => (b.bucket.curves ? [b.bucket.curves.shape] : []));
  const avg = (get: (c: CinemaCurveBand) => number[]): number[] => (shapes.length === 0 ? [] : get(shapes[0]!).map((_, i) => shapes.reduce((a, c) => a + get(c)[i]!, 0) / shapes.length));
  const shapeCurve: CinemaCurveBand | undefined = shapes.length === 0 ? undefined : { n: shapes.reduce((a, c) => a + c.n, 0), mean: avg((c) => c.mean), p25: avg((c) => c.p25), p50: avg((c) => c.p50), p75: avg((c) => c.p75) };
  const keys = (bs: readonly Picked[]): string => bs.map((b) => b.key).join(" + ") || "none";
  const measured = METRIC_IDS.filter((id) => normSources[id] === "cinema-norms").length;
  return {
    bands,
    scriptNorms: SCRIPT_NORMS,
    origin: `cinema-norms (E1 corpus${opts.genre ? `, genre ${opts.genre}` : ""}): rhythm ${keys(rhythm)}; structure ${keys(structure)}; action ${keys(action)}`,
    normSources,
    sized,
    refs,
    ...(shapeCurve ? { shapeCurve } : {}),
    note: `${measured} of ${METRIC_IDS.length} bands measured on the corpus; the rest are priors (and the 4:00 climax, a product requirement)`,
  };
}
