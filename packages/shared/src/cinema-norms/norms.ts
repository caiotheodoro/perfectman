/**
 * Cinema norms: reference distributions of how scenes in real plays, screenplays, TV transcripts and subtitle files are shaped over time
 * (turn length, silence, interruption, direction rate, reversals, escalation curve, when the inciting beat and the climax fall).
 * Numbers only. Built by `cinema-norms` in @perfectman/kb from a local, gitignored corpus; nothing of any work is in the file.
 *
 * How to read it: pick a bucket with {@link pickCinemaBucket}, read a feature's ladder with {@link cinemaLadder}, place a run's value on it with
 * {@link ladderRank}. Every bucket carries `n`, a `confidence` and `caveats`: read them before trusting a ladder. Features that do not exist for a
 * source type (no action lines in subtitles, no silence in screenplays) are absent from that bucket's `ladders`, never zero.
 */

export type CinemaLang = "pt" | "en";
export type CinemaMedium = "stage" | "film" | "series";
export type CinemaForm = "play" | "screenplay" | "transcript" | "subtitle";
export type CinemaGenre = "drama" | "melodrama" | "thriller" | "comedy";

/** Percentile ladder: n scenes (or sources) behind it and the 5th..95th percentiles. */
export type CinemaLadder = { n: number; p5: number; p10: number; p25: number; p50: number; p75: number; p90: number; p95: number };
/** A curve over 10 equal slices of normalised scene time: mean and quartiles per slice. */
export type CinemaCurveBand = { n: number; mean: number[]; p25: number[]; p50: number[]; p75: number[] };

export type CinemaBucket = {
  n: { scenes: number; sources: number; turns: number };
  confidence: "high" | "medium" | "low";
  caveats: string[];
  /** Per-scene features over scenes of 8 or more spoken turns. See `definitions`. */
  ladders: Record<string, CinemaLadder>;
  /** Count-like features split by scene size: `t8_19`, `t20_39`, `t40_plus` spoken turns. */
  bySize: Record<string, Record<string, CinemaLadder>>;
  /** `abs`: conflict intensity (0-1 proxy). `shape`: each scene rescaled to 0-1 first (its own low to its own peak). */
  curves: { abs: CinemaCurveBand; shape: CinemaCurveBand } | null;
  /** Share of spoken turns in each length bin: 1, 2, 3, 4, 5, 6-7, 8-10, 11-15, 16-25, 26-40, 41+ words. */
  turnLengthShares: number[];
  turnWordsLadder: CinemaLadder;
  /** One value per whole source (play, film, episode, subtitle file). */
  perSource: Record<string, CinemaLadder>;
  /** Scenes with a clear arc (peak 0.3+ and a rise of 0.15+ over the opening): where `tInciting`, `tClimax` and `aftermathShare` are most trustworthy. Null under 30 such scenes. */
  strongArc: { n: number; share: number; ladders: Record<string, CinemaLadder> } | null;
  /** Scenes with a readable arc, as a share of scenes with 8+ turns. `tInciting`, `tClimax` and `aftermathShare` are over those scenes only. */
  arcShare: number;
  roleFlipShare: { n: number; share: number } | null;
};

export type CinemaNorms = {
  format: "perfectman-cinema-norms";
  version: 1;
  built?: string;
  ladderKeys: readonly string[];
  curveBins: number;
  definitions: Record<string, string>;
  source: { scenes: number; sources: number; byGroup: Record<string, { sources: number; scenes: number }>; sceneTurnsMin: number };
  /** Model checks: how well the reading-rate estimate and the running-time share-out agree with real cue times. */
  calibration: Record<string, number>;
  /** Key `${lang}/${medium}/${form}`, `${lang}/${medium}/${form}/${genre}` or `${lang}/${medium}/${form}/native` (works written in the language, e.g. Brazilian productions' subtitles, not translations). */
  buckets: Record<string, CinemaBucket>;
  /** Hand-check and validation results (counts only). */
  reliability: Record<string, unknown>;
  notes: string[];
};

export const cinemaBucketKey = (lang: CinemaLang, medium: CinemaMedium, form: CinemaForm, genre?: CinemaGenre): string => `${lang}/${medium}/${form}${genre ? `/${genre}` : ""}`;

export const CINEMA_SIZE_STRATA = ["t8_19", "t20_39", "t40_plus"] as const;
/** The size stratum key for a scene of `turns` spoken turns, or null under 8. */
export const cinemaSizeStratum = (turns: number): (typeof CINEMA_SIZE_STRATA)[number] | null => (turns < 8 ? null : turns < 20 ? "t8_19" : turns < 40 ? "t20_39" : "t40_plus");

export type PickQuery = {
  lang: CinemaLang;
  genre?: CinemaGenre;
  /** Forms in order of preference. Default: real cue times first (subtitle), then screenplay, transcript, play. */
  forms?: readonly CinemaForm[];
  mediums?: readonly CinemaMedium[];
  /** Skip buckets below this confidence (default "low": take anything). */
  minConfidence?: CinemaBucket["confidence"];
};

const RANK = { low: 0, medium: 1, high: 2 } as const;

/**
 * The best bucket for a query: for each form in order, each medium in order, the genre bucket first and then the all-genre one, skipping buckets that
 * fail `minConfidence`. Returns the key and bucket, or null. Falls back to the other language only when `fallbackLang` is set.
 */
export function pickCinemaBucket(norms: CinemaNorms, q: PickQuery & { fallbackLang?: CinemaLang }): { key: string; bucket: CinemaBucket } | null {
  const forms = q.forms ?? (["subtitle", "screenplay", "transcript", "play"] as const);
  const mediums = q.mediums ?? (["film", "series", "stage"] as const);
  const min = RANK[q.minConfidence ?? "low"];
  for (const lang of [q.lang, ...(q.fallbackLang && q.fallbackLang !== q.lang ? [q.fallbackLang] : [])]) {
    for (const form of forms) {
      for (const medium of mediums) {
        for (const genre of [...(q.genre ? [q.genre] : []), undefined]) {
          const key = cinemaBucketKey(lang, medium, form, genre);
          const bucket = norms.buckets[key];
          if (bucket && RANK[bucket.confidence] >= min) return { key, bucket };
        }
      }
    }
  }
  return null;
}

/** A feature's ladder in a bucket, preferring the scene-size stratum when it has one. */
export function cinemaLadder(bucket: CinemaBucket, feature: string, turns?: number): CinemaLadder | null {
  const s = turns === undefined ? null : cinemaSizeStratum(turns);
  return (s && bucket.bySize[s]?.[feature]) || bucket.ladders[feature] || null;
}

const POINTS: ReadonlyArray<[keyof CinemaLadder, number]> = [["p5", 5], ["p10", 10], ["p25", 25], ["p50", 50], ["p75", 75], ["p90", 90], ["p95", 95]];

/** Where `value` falls on the ladder, as a percentile 0..100 (linear between the points, clamped to 0 and 100 beyond p5 and p95 at their slopes). */
export function ladderRank(l: CinemaLadder, value: number): number {
  const pts = POINTS.map(([k, p]) => [l[k] as number, p] as const);
  if (value <= pts[0]![0]) return value === pts[0]![0] ? 5 : Math.max(0, 5 - (pts[0]![0] - value) / Math.max(1e-9, pts[1]![0] - pts[0]![0]) * 5);
  const last = pts[pts.length - 1]!;
  if (value >= last[0]) return value === last[0] ? 95 : Math.min(100, 95 + (value - last[0]) / Math.max(1e-9, last[0] - pts[pts.length - 2]![0]) * 5);
  for (let i = 1; i < pts.length; i++) {
    const [v1, p1] = pts[i]!, [v0, p0] = pts[i - 1]!;
    if (value <= v1) return v1 === v0 ? p1 : p0 + ((value - v0) / (v1 - v0)) * (p1 - p0);
  }
  return 50;
}

/** True when `value` sits inside the [lo, hi] percentile band of the ladder (default p10 to p90). */
export const inLadderBand = (l: CinemaLadder, value: number, lo: keyof CinemaLadder = "p10", hi: keyof CinemaLadder = "p90"): boolean => value >= (l[lo] as number) && value <= (l[hi] as number);

/** Mean absolute distance between a 10-slice curve and a band's median, in the band's units, and the share of slices inside the p25-p75 band. */
export function curveFit(curve: readonly number[], band: CinemaCurveBand): { meanAbsDist: number; inBandShare: number } {
  const n = Math.min(curve.length, band.p50.length);
  let d = 0, inb = 0;
  for (let i = 0; i < n; i++) {
    d += Math.abs(curve[i]! - band.p50[i]!);
    if (curve[i]! >= band.p25[i]! && curve[i]! <= band.p75[i]!) inb += 1;
  }
  return { meanAbsDist: n ? d / n : NaN, inBandShare: n ? inb / n : NaN };
}

/** Resample a series to `bins` equal slices (mean per slice), the shape the curves use. */
export function resampleCurve(series: readonly number[], bins = 10): number[] {
  if (series.length === 0) return new Array<number>(bins).fill(0);
  return Array.from({ length: bins }, (_, b) => {
    const lo = Math.floor((b * series.length) / bins), hi = Math.max(lo + 1, Math.floor(((b + 1) * series.length) / bins));
    const part = series.slice(lo, Math.min(series.length, hi));
    return part.reduce((a, v) => a + v, 0) / part.length;
  });
}

const isNum = (x: unknown): boolean => typeof x === "number";
/** JSON with one level of indent per object, but a ladder (an object of numbers) or a list of numbers on one line, so the file stays reviewable and small. */
function compact(v: unknown, depth: number): string {
  const pad = " ".repeat(depth);
  if (Array.isArray(v)) {
    if (v.every(isNum)) return `[${v.map((x) => JSON.stringify(x)).join(",")}]`;
    return `[\n${v.map((x) => `${pad} ${compact(x, depth + 1)}`).join(",\n")}\n${pad}]`;
  }
  if (v && typeof v === "object") {
    const e = Object.entries(v as Record<string, unknown>);
    if (e.length === 0) return "{}";
    if (e.every(([, x]) => isNum(x) || (Array.isArray(x) && x.every(isNum) && x.length <= 12 && false))) return `{${e.map(([k, x]) => `${JSON.stringify(k)}:${JSON.stringify(x)}`).join(",")}}`;
    return `{\n${e.map(([k, x]) => `${pad} ${JSON.stringify(k)}: ${compact(x, depth + 1)}`).join(",\n")}\n${pad}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** The committed JSON, one way: kb's `cinema-norms` writes it and a test pins the committed file to it. */
export const formatCinemaNormsJson = (n: CinemaNorms): string => `${compact(n, 0)}\n`;
export const formatCinemaNormsTs = (n: CinemaNorms): string =>
  [
    "/** Generated by `cinema-norms` in @perfectman/kb from the local cinema corpus; the same numbers as cinema-norms.json. Do not edit: a test pins the two equal. */",
    'import type { CinemaNorms } from "./norms.js";',
    "",
    `export const CINEMA_NORMS: CinemaNorms = ${compact(n, 0)};`,
    "",
  ].join("\n");
