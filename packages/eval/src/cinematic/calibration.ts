/**
 * Calibration scaffolding for the cinematic score: import the owner's human grades (agent E3's grading page), compare them with the engagement judge and
 * with the deterministic score, and freeze thresholds only when the evidence supports it.
 *
 * NOTHING HERE IS CALIBRATED YET. No human grade exists in the repo and none is made up: the tests use obviously synthetic fixtures, and the committed
 * `docs/eval/cinematic-thresholds.json` says `status: "uncalibrated"` with null thresholds until `--freeze` is run on real grades.
 *
 * Human grade format (E3: one JSON per clip, six axes 1-5 including entertainment). The importer is tolerant, because the page is built in parallel:
 *   { "clipId": "run62-a", "grader": "owner", "run": 62, "fromS": 0, "toS": 240,
 *     "scores": { "tension": 4, "surprise": 3, "payoff": 4, "distinctiveness": 3, "rewatchability": 3, "entertainment": 4 },   // or { "score": 4, "note": "..." } per axis
 *     "grade": "B", "notes": "..." }
 * A file may hold one grade, an array, `{ "grades": [...] }`, or be .jsonl. Axis names are mapped through {@link AXIS_ALIASES} (entertainment, fun and
 * entertaining are one axis); an axis the judge does not score is kept in `otherAxes` and not compared. `run` (a number or a path) says which run the clip
 * was cut from, `fromS`/`toS` which part of it (the judge then reads only that window).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { weightedKappa } from "../judge/calibration.js";
import { ENGAGEMENT_AXES, type EngagementAxis } from "./engagement.js";
import { round3 } from "./types.js";

export const KAPPA_BAR = 0.6;
/** Fewest clips the plan's calibration needs: the owner grades 12. */
export const MIN_CLIPS = 12;
/** Fewest clips on each side of a threshold before it is frozen. */
export const MIN_PER_SIDE = 3;

export const AXIS_ALIASES: Readonly<Record<string, EngagementAxis>> = {
  tension: "tension",
  surprise: "surprise",
  payoff: "payoff",
  resolution: "payoff",
  distinctiveness: "distinctiveness",
  character_distinctiveness: "distinctiveness",
  characters: "distinctiveness",
  character: "distinctiveness",
  rewatchability: "rewatchability",
  rewatch: "rewatchability",
  rewatch_value: "rewatchability",
  entertaining: "entertaining",
  entertainment: "entertaining",
  entertainment_value: "entertaining",
  fun: "entertaining",
};

export type HumanGrade = {
  clipId: string;
  grader: string;
  run?: string;
  fromS?: number;
  toS?: number;
  /** The judged axes, 1-5. */
  scores: Partial<Record<EngagementAxis, number>>;
  /** Axes the grade has that the judge does not score. */
  otherAxes: Record<string, number>;
  /** Overall letter grade, when the page records one. */
  letter?: string;
  /** The grader's own call on whether a physical climax happened (E3's `climax`), and when. */
  climax?: { reached: "yes" | "no" | "unsure"; timeS?: number };
  notes?: string;
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);

const norm = (k: string): string => k.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** A score cell: a number 1-5, `{score}`, or null (not graded). */
function cell(v: unknown, where: string): number | null {
  const x = isObj(v) ? v["score"] : v;
  if (x === null || x === undefined) return null;
  if (typeof x !== "number" || !Number.isInteger(x) || x < 1 || x > 5) throw new Error(`${where}: a score must be an integer 1-5 or null, got ${JSON.stringify(x)}`);
  return x;
}

export function parseHumanGrade(raw: unknown, where = "grade"): HumanGrade {
  if (!isObj(raw)) throw new Error(`${where}: expected an object`);
  const clipId = raw["clipId"] ?? raw["clip_id"] ?? raw["clip"] ?? raw["id"];
  if (typeof clipId !== "string" || clipId === "") throw new Error(`${where}: no clipId`);
  const scoresRaw = raw["scores"] ?? raw["axes"];
  if (!isObj(scoresRaw)) throw new Error(`${where} (${clipId}): no "scores" object`);
  const scores: Partial<Record<EngagementAxis, number>> = {};
  const otherAxes: Record<string, number> = {};
  for (const [k, v] of Object.entries(scoresRaw)) {
    const s = cell(v, `${where} (${clipId}).${k}`);
    if (s === null) continue;
    const axis = AXIS_ALIASES[norm(k)];
    if (axis) scores[axis] = s;
    else otherAxes[k] = s;
  }
  const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  const run = raw["run"] ?? raw["run_id"] ?? raw["runDir"];
  // E3's export writes the cut as `window_s: [from, to]` (null for the whole run); the judge reads only that window.
  const win = Array.isArray(raw["window_s"]) && raw["window_s"].length === 2 && raw["window_s"].every((x) => typeof x === "number" && Number.isFinite(x)) ? (raw["window_s"] as [number, number]) : undefined;
  const climaxRaw = raw["climax"];
  const reached = isObj(climaxRaw) ? climaxRaw["reached"] : undefined;
  const climax: HumanGrade["climax"] | undefined =
    isObj(climaxRaw) && (reached === "yes" || reached === "no" || reached === "unsure")
      ? { reached, ...(num(climaxRaw["time_s"]) !== undefined ? { timeS: num(climaxRaw["time_s"])! } : {}) }
      : undefined;
  return {
    clipId,
    grader: typeof raw["grader"] === "string" ? raw["grader"] : typeof raw["labeler"] === "string" ? raw["labeler"] : "human",
    ...(typeof run === "string" || typeof run === "number" ? { run: String(run) } : {}),
    ...(num(raw["fromS"] ?? raw["from_s"] ?? raw["clipStartS"] ?? win?.[0]) !== undefined ? { fromS: num(raw["fromS"] ?? raw["from_s"] ?? raw["clipStartS"] ?? win?.[0])! } : {}),
    ...(num(raw["toS"] ?? raw["to_s"] ?? win?.[1]) !== undefined ? { toS: num(raw["toS"] ?? raw["to_s"] ?? win?.[1])! } : {}),
    ...(climax ? { climax } : {}),
    scores,
    otherAxes,
    ...(typeof raw["grade"] === "string" ? { letter: raw["grade"].toUpperCase() } : typeof raw["letter"] === "string" ? { letter: raw["letter"].toUpperCase() } : {}),
    ...(typeof raw["notes"] === "string" ? { notes: raw["notes"] } : {}),
  };
}

/** Grades from a file or a directory of `.json` / `.jsonl` files. */
export function loadHumanGrades(path: string): HumanGrade[] {
  if (!existsSync(path)) throw new Error(`no such file or directory: ${path}`);
  const files = statSync(path).isDirectory()
    ? readdirSync(path)
        // `index.json` is the importer's own listing of what it wrote and skipped (scripts/grading/import-grades.mjs), not a grade.
        .filter((f) => (f.endsWith(".json") || f.endsWith(".jsonl")) && f !== "index.json")
        .sort()
        .map((f) => join(path, f))
    : [path];
  if (files.length === 0) throw new Error(`no grade files (*.json, *.jsonl) in ${path}`);
  const out: HumanGrade[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const values: unknown[] = [];
    if (file.endsWith(".jsonl")) {
      text.split("\n").forEach((l, i) => {
        if (l.trim() === "") return;
        try {
          values.push(JSON.parse(l));
        } catch {
          throw new Error(`${file}:${i + 1}: not valid JSON`);
        }
      });
    } else {
      let v: unknown;
      try {
        v = JSON.parse(text);
      } catch {
        throw new Error(`${file}: not valid JSON`);
      }
      if (Array.isArray(v)) values.push(...v);
      else if (isObj(v) && Array.isArray(v["grades"])) values.push(...(v["grades"] as unknown[]));
      else if (isObj(v) && Array.isArray(v["clips"])) values.push(...(v["clips"] as unknown[]));
      else values.push(v);
    }
    values.forEach((v, i) => out.push(parseHumanGrade(v, `${file}${values.length > 1 ? `[${i}]` : ""}`)));
  }
  const seen = new Set<string>();
  for (const g of out) {
    const key = `${g.clipId}|${g.grader}`;
    if (seen.has(key)) throw new Error(`duplicate grade for clip "${g.clipId}" by "${g.grader}"`);
    seen.add(key);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Agreement
// ---------------------------------------------------------------------------------------------------------------------

/** Unweighted Cohen's kappa over categories 1-5. 1 when both sides are the same constant (the degenerate case is flagged by the caller). */
export function cohenKappa(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  const n = a.length;
  const levels = [1, 2, 3, 4, 5];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = levels.reduce((s, l) => s + (a.filter((x) => x === l).length / n) * (b.filter((x) => x === l).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

const variance0 = (xs: number[]): boolean => new Set(xs).size <= 1;

export type EngagementAxisAgreement = {
  n: number;
  weightedKappa: number | null;
  cohenKappa: number | null;
  exact: number | null;
  withinOne: number | null;
  /** Mean of (judge - human): positive = the judge is more generous. */
  bias: number | null;
  /** One side gave the same score to every clip: the kappa says nothing. */
  degenerate: boolean;
};

export type EngagementAgreement = {
  clips: number;
  perAxis: Record<EngagementAxis, EngagementAxisAgreement>;
  /** Mean of the axis weighted kappas that exist and are not degenerate. */
  meanKappa: number | null;
  /** Both bars met: `entertaining` at or above {@link KAPPA_BAR}, and the mean over axes at or above it; not degenerate; at least {@link MIN_CLIPS} clips. */
  pass: boolean;
  reasons: string[];
  unmatched: { human: string[]; judge: string[] };
};

export type JudgedClip = Partial<Record<EngagementAxis, number>>;

export function engagementAgreement(humans: readonly HumanGrade[], judged: ReadonlyMap<string, JudgedClip>, opts: { minClips?: number } = {}): EngagementAgreement {
  const minClips = opts.minClips ?? MIN_CLIPS;
  const byId = new Map<string, HumanGrade[]>();
  for (const h of humans) byId.set(h.clipId, [...(byId.get(h.clipId) ?? []), h]);
  const shared = [...byId.keys()].filter((id) => judged.has(id));
  const perAxis = {} as Record<EngagementAxis, EngagementAxisAgreement>;
  for (const axis of ENGAGEMENT_AXES) {
    const h: number[] = [];
    const j: number[] = [];
    for (const id of shared) {
      const js = judged.get(id)![axis];
      if (js === undefined) continue;
      // several graders on one clip: each pair counts
      for (const g of byId.get(id)!) {
        const hs = g.scores[axis];
        if (hs !== undefined) {
          h.push(hs);
          j.push(js);
        }
      }
    }
    const n = h.length;
    const degenerate = n >= 2 && (variance0(h) || variance0(j));
    perAxis[axis] = {
      n,
      weightedKappa: n >= 2 ? round3(weightedKappa(h, j)) : null,
      cohenKappa: n >= 2 ? round3(cohenKappa(h, j)) : null,
      exact: n === 0 ? null : round3(h.filter((x, i) => x === j[i]).length / n),
      withinOne: n === 0 ? null : round3(h.filter((x, i) => Math.abs(x - j[i]!) <= 1).length / n),
      bias: n === 0 ? null : round3(j.reduce((s, x, i) => s + (x - h[i]!), 0) / n),
      degenerate,
    };
  }
  const usable = ENGAGEMENT_AXES.map((a) => perAxis[a]).filter((a) => a.weightedKappa !== null && !a.degenerate);
  const meanKappa = usable.length === 0 ? null : round3(usable.reduce((s, a) => s + a.weightedKappa!, 0) / usable.length);
  const reasons: string[] = [];
  const ent = perAxis.entertaining;
  if (shared.length < minClips) reasons.push(`${shared.length} clips graded by both, need ${minClips}`);
  if (ent.n < 2) reasons.push("no paired scores on entertaining");
  else if (ent.degenerate) reasons.push("entertaining: one side gave every clip the same score, kappa is meaningless");
  else if (ent.weightedKappa! < KAPPA_BAR) reasons.push(`entertaining kappa ${ent.weightedKappa} < ${KAPPA_BAR}`);
  if (meanKappa === null) reasons.push("no axis has a usable kappa");
  else if (meanKappa < KAPPA_BAR) reasons.push(`mean kappa ${meanKappa} < ${KAPPA_BAR}`);
  return {
    clips: shared.length,
    perAxis,
    meanKappa,
    pass: reasons.length === 0,
    reasons,
    unmatched: { human: [...byId.keys()].filter((id) => !judged.has(id)), judge: [...judged.keys()].filter((id) => !byId.has(id)) },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Rank agreement of the cinematic score with the human grades
// ---------------------------------------------------------------------------------------------------------------------

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]![1]] = r;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation; null under 3 pairs or when one side is constant. */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length || variance0(a) || variance0(b)) return null;
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = ra.reduce((s, v) => s + v, 0) / ra.length;
  const mb = rb.reduce((s, v) => s + v, 0) / rb.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i]! - ma) * (rb[i]! - mb);
    da += (ra[i]! - ma) ** 2;
    db += (rb[i]! - mb) ** 2;
  }
  return round3(num / Math.sqrt(da * db));
}

// ---------------------------------------------------------------------------------------------------------------------
// Frozen thresholds
// ---------------------------------------------------------------------------------------------------------------------

export type Threshold = { cut: number; youden: number; positives: number; negatives: number };

/** The cut on `score` that best separates `positive` clips from the rest (Youden's J; ties go to the lower cut), or null when a side is too small. */
export function bestCut(points: ReadonlyArray<{ score: number; positive: boolean }>, minPerSide = MIN_PER_SIDE): Threshold | null {
  const pos = points.filter((p) => p.positive).length;
  const neg = points.length - pos;
  if (pos < minPerSide || neg < minPerSide) return null;
  const cuts = [...new Set(points.map((p) => p.score))].sort((a, b) => a - b);
  let best: Threshold | null = null;
  for (const cut of cuts) {
    const tp = points.filter((p) => p.positive && p.score >= cut).length;
    const fp = points.filter((p) => !p.positive && p.score >= cut).length;
    const j = tp / pos - fp / neg;
    if (best === null || j > best.youden + 1e-12) best = { cut, youden: round3(j), positives: pos, negatives: neg };
  }
  return best;
}

export type FrozenThresholds = {
  version: "cinematic-thresholds-v1";
  status: "frozen" | "unfrozen" | "uncalibrated";
  frozenAt?: string;
  reasons: string[];
  clips: number;
  graders: string[];
  /** Score of the cinematic overall (deterministic when no judge ran) at which the human "entertaining" grade turns B-or-better (>= 4) and C-or-better (>= 3). */
  thresholds: { b: Threshold | null; c: Threshold | null } | null;
  agreement?: EngagementAgreement;
  spearman?: { deterministic: number | null; overall: number | null };
  judge?: string;
  normsOrigin?: string;
  inputsSha256?: string;
};

export type FreezeInput = {
  humans: readonly HumanGrade[];
  judged: ReadonlyMap<string, JudgedClip>;
  /** Per clip: the cinematic overall and the deterministic score. */
  scores: ReadonlyMap<string, { overall: number | null; deterministic: number | null }>;
  judge?: string;
  normsOrigin?: string;
  now?: Date;
};

/** Mean over graders of a clip's `entertaining` grade, or of its letter when that is all there is (A=5 .. E/F=1). */
function entertainmentOf(grades: readonly HumanGrade[]): number | null {
  const xs = grades.map((g) => g.scores.entertaining).filter((v): v is number => v !== undefined);
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Freezes thresholds from real grades. `status: "frozen"` only when: at least {@link MIN_CLIPS} clips graded, the judge clears the kappa bar (see
 * {@link engagementAgreement}), and each cut has {@link MIN_PER_SIDE} clips on both sides. Otherwise "unfrozen" with the reasons; thresholds are still
 * computed when there is enough to compute them, for information, and must not be used as a gate.
 */
export function freezeThresholds(input: FreezeInput): FrozenThresholds {
  const agreement = engagementAgreement(input.humans, input.judged);
  const byClip = new Map<string, HumanGrade[]>();
  for (const h of input.humans) byClip.set(h.clipId, [...(byClip.get(h.clipId) ?? []), h]);
  const pts = (field: "overall" | "deterministic", min: number) => {
    const out: Array<{ score: number; positive: boolean }> = [];
    for (const [id, gs] of byClip) {
      const s = input.scores.get(id)?.[field];
      const e = entertainmentOf(gs);
      if (s === null || s === undefined || e === null) continue;
      out.push({ score: s, positive: e >= min });
    }
    return out;
  };
  const field = [...input.scores.values()].some((s) => s.overall !== null) ? "overall" : "deterministic";
  const b = bestCut(pts(field, 4));
  const c = bestCut(pts(field, 3));
  const reasons = [...agreement.reasons];
  if (b === null) reasons.push(`fewer than ${MIN_PER_SIDE} clips on each side of "B or better" (entertaining >= 4)`);
  if (c === null) reasons.push(`fewer than ${MIN_PER_SIDE} clips on each side of "C or better" (entertaining >= 3)`);
  const frozen = reasons.length === 0;
  const ent: number[] = [];
  const detScores: number[] = [];
  const overallScores: number[] = [];
  const entForOverall: number[] = [];
  for (const [id, gs] of byClip) {
    const e = entertainmentOf(gs);
    const s = input.scores.get(id);
    if (e === null || !s) continue;
    if (s.deterministic !== null) {
      ent.push(e);
      detScores.push(s.deterministic);
    }
    if (s.overall !== null) {
      entForOverall.push(e);
      overallScores.push(s.overall);
    }
  }
  const graders = [...new Set(input.humans.map((h) => h.grader))].sort();
  return {
    version: "cinematic-thresholds-v1",
    status: frozen ? "frozen" : "unfrozen",
    ...(frozen ? { frozenAt: (input.now ?? new Date()).toISOString() } : {}),
    reasons,
    clips: byClip.size,
    graders,
    thresholds: b === null && c === null ? null : { b, c },
    agreement,
    spearman: { deterministic: spearman(detScores, ent), overall: spearman(overallScores, entForOverall) },
    ...(input.judge ? { judge: input.judge } : {}),
    ...(input.normsOrigin ? { normsOrigin: input.normsOrigin } : {}),
    inputsSha256: createHash("sha256")
      .update(JSON.stringify([...input.humans].sort((x, y) => (x.clipId + x.grader).localeCompare(y.clipId + y.grader))))
      .digest("hex"),
  };
}

/** The placeholder committed before any grade exists. */
export function uncalibratedThresholds(): FrozenThresholds {
  return { version: "cinematic-thresholds-v1", status: "uncalibrated", reasons: ["no human grades have been imported"], clips: 0, graders: [], thresholds: null };
}
