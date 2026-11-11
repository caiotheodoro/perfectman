import type { CinemaBucket, CinemaCurveBand, CinemaLadder, CinemaNorms } from "@perfectman/shared";
import { CURVE_BINS, LEN_BINS, percentile } from "./features.js";
import type { SceneFeatures, SourceStats } from "./types.js";

export const LADDER_PS = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95] as const;
export const LADDER_KEYS = ["p5", "p10", "p25", "p50", "p75", "p90", "p95"] as const;
export type Ladder = CinemaLadder;
export type CurveBand = CinemaCurveBand;
export type BucketNorms = CinemaBucket;

/** Features whose size dependence matters when a run is scored against a scene of its own length. */
const BY_SIZE_KEYS = ["reversals", "eventsPer10", "hardActs", "tClimax", "tInciting", "aftermathShare", "silenceShare", "dirPerMin", "peak", "shortShare", "durSec", "turnsPerMin", "interruptShare", "pauseMarkersPer100"];

/** A scene whose peak is clearly above its opening: the hand-check found the climax placement reliable here and shaky below. */
export const STRONG_PEAK = 0.3;
export const STRONG_RISE = 0.15;

export const SIZE_STRATA = [
  { key: "t8_19", lo: 8, hi: 19 },
  { key: "t20_39", lo: 20, hi: 39 },
  { key: "t40_plus", lo: 40, hi: Infinity },
] as const;

type Metric = { key: string; def: string; get: (f: SceneFeatures) => number | null; count?: boolean; arcOnly?: boolean };

const num = (x: number | null | undefined): number | null => (x === null || x === undefined || !Number.isFinite(x) ? null : x);

/** Every feature with its plain-words definition (written into the norms file). */
export const METRICS: Metric[] = [
  { key: "turns", def: "spoken turns in the scene", get: (f) => f.turns, count: true },
  { key: "durSec", def: "scene length in seconds: real cue times for subtitles, a share of the film's running time for screenplays, a reading-rate estimate otherwise", get: (f) => f.durSec },
  { key: "turnsPerMin", def: "spoken turns per minute of scene", get: (f) => f.turnsPerMin },
  { key: "wordsP50", def: "median words per spoken turn in the scene", get: (f) => f.wordsP50 },
  { key: "wordsP90", def: "90th percentile of words per spoken turn in the scene", get: (f) => f.wordsP90 },
  { key: "shortShare", def: "share of turns of 5 words or fewer", get: (f) => f.shortShare },
  { key: "microShare", def: "share of turns of 2 words or fewer", get: (f) => f.microShare },
  { key: "longShare", def: "share of turns over 25 words", get: (f) => f.longShare },
  { key: "interruptShare", def: "share of turns that end cut off by a dash", get: (f) => f.interruptShare },
  { key: "ellipsisShare", def: "share of turns that trail off in an ellipsis", get: (f) => f.ellipsisShare },
  { key: "silentTurnShare", def: "share of turns that are only dots or a dash (a written silence)", get: (f) => f.silentTurnShare },
  { key: "pauseMarkersPer100", def: "written pause markers (pause/beat/silence in a direction, or a silent turn) per 100 turns", get: (f) => f.pauseMarkersPer100 },
  { key: "overlapShare", def: "timed: share of turns that start before the previous one ends", get: (f) => f.overlapShare },
  { key: "rapidShare", def: "timed: share of turns that follow the previous one within 0.25 s (back-to-back, including a dash-split cue)", get: (f) => f.rapidShare },
  { key: "silenceShare", def: "timed: share of the scene's span in which nobody is talking", get: (f) => f.silenceShare },
  { key: "gapsOver2sPerMin", def: "timed: pauses longer than 2 s per minute", get: (f) => f.gapsOver2sPerMin },
  { key: "medianGapSec", def: "timed: median gap between turns, seconds", get: (f) => f.medianGapSec },
  { key: "longestGapFrac", def: "timed: longest gap as a share of the scene span", get: (f) => f.longestGapFrac },
  { key: "wordsPerSec", def: "timed: words spoken per second of actual speech", get: (f) => f.wordsPerSec },
  { key: "dirPerTurn", def: "stage directions / action lines per spoken turn", get: (f) => num(f.dirPerTurn) },
  { key: "dirPerMin", def: "stage directions / action lines per minute", get: (f) => num(f.dirPerMin) },
  { key: "actsPerMin", def: "directions that carry a body act (hard or soft) per minute", get: (f) => num(f.actsPerMin) },
  { key: "hardActs", def: "directions with a hard physical act (strike, shove, grab, kill, collapse, kiss, embrace) in the scene", get: (f) => num(f.hardActs), count: true },
  { key: "dialogueShare", def: "spoken words as a share of spoken plus direction words", get: (f) => num(f.dialogueShare) },
  { key: "directionGapP50", def: "median number of spoken turns between two directions", get: (f) => num(f.directionGapP50) },
  { key: "peak", def: "highest smoothed conflict intensity (0-1 proxy from hostile words, shouting, cut-off lines, hard acts)", get: (f) => f.peak },
  { key: "peakRise", def: "peak intensity minus the opening level", get: (f) => f.peakRise },
  { key: "tInciting", def: "when intensity first reaches 40% of its rise to the peak, as a fraction of scene time (scenes with an arc only)", get: (f) => f.tInciting, arcOnly: true },
  { key: "tClimax", def: "when intensity peaks, as a fraction of scene time (scenes with an arc only)", get: (f) => f.tClimax, arcOnly: true },
  { key: "aftermathShare", def: "scene time after intensity last stays above 70% of its rise (scenes with an arc only)", get: (f) => f.aftermathShare, arcOnly: true },
  { key: "reversals", def: "turning points of the smoothed intensity with a swing of 0.12 or more (a rise then a fall is one)", get: (f) => f.reversals, count: true },
  { key: "reveals", def: "turns that reveal something hidden (lexicon)", get: (f) => f.reveals, count: true },
  { key: "accusations", def: "turns that accuse (lexicon)", get: (f) => f.accusations, count: true },
  { key: "commitments", def: "turns that promise, refuse, decide (lexicon)", get: (f) => f.commitments, count: true },
  { key: "eventsPer10", def: "reveals + accusations + commitments + hard acts + reversals per 10 turns", get: (f) => f.eventsPer10 },
  { key: "longestQuietFrac", def: "longest run of turns with no reveal, accusation, commitment or hard act, as a share of turns", get: (f) => f.longestQuietFrac },
];

const ladder = (xs: number[]): Ladder | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const r = (x: number): number => Math.round(x * 1e4) / 1e4;
  const out: Record<string, number> = { n: s.length };
  LADDER_PS.forEach((p, i) => (out[LADDER_KEYS[i]!] = r(percentile(s, p))));
  return out as Ladder;
};

const band = (rows: number[][]): CurveBand | null => {
  if (rows.length === 0) return null;
  const col = (b: number): number[] => rows.map((r) => r[b]!).sort((x, y) => x - y);
  const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
  const mk = (fn: (c: number[]) => number): number[] => Array.from({ length: CURVE_BINS }, (_, b) => r4(fn(col(b))));
  return { n: rows.length, mean: mk((c) => c.reduce((a, v) => a + v, 0) / c.length), p25: mk((c) => percentile(c, 0.25)), p50: mk((c) => percentile(c, 0.5)), p75: mk((c) => percentile(c, 0.75)) };
};

const BIN_EDGES = [0, ...LEN_BINS, 80];
function histLadder(shares: number[]): Ladder {
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  const out: Record<string, number> = { n: Math.round(total) };
  LADDER_PS.forEach((p, i) => {
    let acc = 0;
    for (let b = 0; b < shares.length; b++) {
      const next = acc + shares[b]! / total;
      if (next >= p) { const lo = BIN_EDGES[b]!, hi = BIN_EDGES[b + 1]!; out[LADDER_KEYS[i]!] = Math.round((lo + ((p - acc) / Math.max(1e-9, shares[b]! / total)) * (hi - lo)) * 100) / 100; break; }
      acc = next;
    }
  });
  return out as Ladder;
}

export const MIN_TURNS = 8;

/** Aggregate one bucket's scenes. Scenes under 8 turns count in `n` and the turn-length bins but not in the ladders. */
const SRC_METRICS = ["turnsPerMin", "sceneMinP50", "scenesPer10Min", "dialogueShare", "hardActsPer10Min", "dirPerMin", "talkShare", "gaps2PerMin", "gaps5PerMin", "gaps12PerMin"] as const;
export const SOURCE_DEFS: Record<string, string> = {
  turnsPerMin: "spoken turns per minute over the whole source",
  sceneMinP50: "median scene length in minutes (real for subtitles; see calibration for the others)",
  scenesPer10Min: "scenes per 10 minutes (subtitle scenes are cut at 12 s of silence)",
  dialogueShare: "spoken words / (spoken + direction words), whole source",
  hardActsPer10Min: "hard physical acts in directions per 10 minutes",
  dirPerMin: "directions per minute",
  talkShare: "subtitle files: share of the span with someone talking",
  gaps2PerMin: "subtitle files: gaps over 2 s per minute (all gaps, not cut by scene)",
  gaps5PerMin: "subtitle files: gaps over 5 s per minute",
  gaps12PerMin: "subtitle files: gaps over 12 s per minute (these are the scene cuts)",
};

export function aggregateBucket(rows: readonly SceneFeatures[], caveats: string[] = [], srcRows: readonly SourceStats[] = []): BucketNorms {
  const big = rows.filter((r) => r.turns >= MIN_TURNS);
  const sources = new Set(rows.map((r) => r.src)).size;
  const ladders: Record<string, Ladder> = {};
  for (const m of METRICS) {
    const pool = big.filter((r) => !m.arcOnly || r.tClimax !== null);
    const vals = pool.map(m.get).filter((x): x is number => x !== null);
    const l = ladder(vals);
    if (l) ladders[m.key] = l;
  }
  const bySize: BucketNorms["bySize"] = {};
  for (const st of SIZE_STRATA) {
    const part = big.filter((r) => r.turns >= st.lo && r.turns <= st.hi);
    if (part.length < 20) continue;
    const o: Record<string, Ladder> = {};
    for (const m of METRICS) {
      if (!BY_SIZE_KEYS.includes(m.key)) continue;
      const pool = part.filter((r) => !m.arcOnly || r.tClimax !== null);
      const l = ladder(pool.map(m.get).filter((x): x is number => x !== null));
      if (l) o[m.key] = l;
    }
    bySize[st.key] = o;
  }
  const arcRows = big.filter((r) => r.tClimax !== null);
  const shapeRows = arcRows.map((r) => {
    const lo = Math.min(...r.curve), hi = Math.max(...r.curve);
    return r.curve.map((v) => (hi - lo > 1e-9 ? (v - lo) / (hi - lo) : 0));
  });
  const absRows = big.filter((r) => r.curve.length === CURVE_BINS).map((r) => r.curve);
  const abs = band(absRows), shape = band(shapeRows);
  const strong = big.filter((r) => r.tClimax !== null && r.peak >= STRONG_PEAK && r.peakRise >= STRONG_RISE);
  const strongLadders: Record<string, Ladder> = {};
  for (const k of ["tInciting", "tClimax", "aftermathShare", "reversals", "peak", "eventsPer10"]) {
    const m = METRICS.find((x) => x.key === k)!;
    const l = ladder(strong.map(m.get).filter((x): x is number => x !== null));
    if (l) strongLadders[k] = l;
  }
  const hist = new Array<number>(LEN_BINS.length + 1).fill(0);
  let turns = 0;
  for (const r of rows) { r.lenHist.forEach((c, i) => (hist[i]! += c)); turns += r.turns; }
  const flips = big.filter((r) => r.roleFlip !== null);
  const nScenes = rows.length;
  const confidence: BucketNorms["confidence"] = big.length >= 300 && sources >= 25 ? "high" : big.length >= 100 && sources >= 8 ? "medium" : "low";
  const cav = [...caveats];
  if (confidence === "low") cav.push(`small n: ${big.length} scenes of 8+ turns from ${sources} sources; read the ladders as a rough guide`);
  if (sources < 8) cav.push(`only ${sources} sources: author or show style dominates`);
  return {
    n: { scenes: nScenes, sources, turns },
    confidence,
    caveats: cav,
    ladders,
    bySize,
    curves: abs && shape ? { abs, shape } : null,
    turnLengthShares: hist.map((c) => Math.round((c / Math.max(1, turns)) * 1e5) / 1e5),
    turnWordsLadder: histLadder(hist),
    perSource: Object.fromEntries(SRC_METRICS.flatMap((k) => { const l = ladder(srcRows.map((s) => s[k]).filter((x): x is number => typeof x === "number" && Number.isFinite(x))); return l && l.n >= 8 ? [[k, l]] : []; })),
    strongArc: strong.length >= 30 ? { n: strong.length, share: Math.round((strong.length / Math.max(1, big.length)) * 1e4) / 1e4, ladders: strongLadders } : null,
    arcShare: big.length ? Math.round((arcRows.length / big.length) * 1e4) / 1e4 : 0,
    roleFlipShare: flips.length >= 20 ? { n: flips.length, share: Math.round((flips.filter((r) => r.roleFlip).length / flips.length) * 1e4) / 1e4 } : null,
  };
}

const BUCKET_CAVEATS: Record<string, string[]> = {
  play: ["archaic or translated text (pre-1930); stage scenes were cut into windows of about 60 turns because the sources carry no reliable scene breaks", "duration is a reading-rate estimate, not a measured time"],
  screenplay: ["scene length is the film's running time shared out by text weight, so per-minute figures assume uniform pacing", "written conflict only: screenplays hold no actor timing, silences or overlaps beyond what is typed"],
  transcript: ["fan transcripts: dialogue is thorough, action lines are partial and uneven (none at all in the soap-opera set)", "scenes are cut by a heuristic on place/time directions; duration is a reading-rate estimate"],
  subtitle: ["no speaker names and no action lines: turns are cue lines, direction/act figures are absent", "scenes are cut at silences of 12 s or more, so very continuous scenes split and slow ones merge", "conflict intensity comes from words and punctuation alone, a weak proxy without actions"],
};

export function buildNorms(rows: Iterable<SceneFeatures>, sourceRows: readonly SourceStats[], meta: { built?: string; byGroup: CinemaNorms["source"]["byGroup"]; calibration: Record<string, number>; reliability?: Record<string, unknown>; minScenes?: number }): CinemaNorms {
  const groups = new Map<string, SceneFeatures[]>();
  let scenes = 0;
  const srcs = new Set<string>();
  const push = (k: string, r: SceneFeatures): void => { let a = groups.get(k); if (!a) groups.set(k, (a = [])); a.push(r); };
  for (const r of rows) {
    scenes += 1; srcs.add(r.src);
    const base = `${r.lang}/${r.medium}/${r.form}`;
    push(base, r);
    if (r.genre !== "other") push(`${base}/${r.genre}`, r);
    if (r.native) push(`${base}/native`, r);
  }
  const srcGroups = new Map<string, SourceStats[]>();
  for (const s of sourceRows) for (const k of [`${s.lang}/${s.medium}/${s.form}`, ...(s.genre !== "other" ? [`${s.lang}/${s.medium}/${s.form}/${s.genre}`] : []), ...(s.native ? [`${s.lang}/${s.medium}/${s.form}/native`] : [])]) { let a = srcGroups.get(k); if (!a) srcGroups.set(k, (a = [])); a.push(s); }
  const minScenes = meta.minScenes ?? 30;
  const buckets: Record<string, BucketNorms> = {};
  for (const k of [...groups.keys()].sort()) {
    const g = groups.get(k)!;
    if (g.filter((r) => r.turns >= MIN_TURNS).length < minScenes) continue;
    const form = k.split("/")[2]!;
    const caveats = [...(BUCKET_CAVEATS[form] ?? [])];
    if (g[0]!.era === "classic") caveats.push("classic era text");
    buckets[k] = aggregateBucket(g, caveats, srcGroups.get(k) ?? []);
  }
  const definitions: Record<string, string> = {};
  for (const m of METRICS) definitions[m.key] = m.def;
  for (const [k, v] of Object.entries(SOURCE_DEFS)) definitions[`perSource.${k}`] = v;
  return {
    format: "perfectman-cinema-norms", version: 1, ...(meta.built ? { built: meta.built } : {}), ladderKeys: LADDER_KEYS, curveBins: CURVE_BINS, definitions,
    source: { scenes, sources: srcs.size, byGroup: meta.byGroup, sceneTurnsMin: MIN_TURNS }, calibration: meta.calibration, buckets, reliability: meta.reliability ?? {}, notes: [],
  };
}
