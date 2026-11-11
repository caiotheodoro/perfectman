import type { Band, MetricId } from "./norms.js";
import { bandScore } from "./norms.js";

export const GROUP_NAMES = ["arc", "dialogue", "embodiment", "camera", "engagement"] as const;
export type GroupName = (typeof GROUP_NAMES)[number];

/** Weights of the five groups in the cinematic score (sum 1). Engagement is the only LLM-judged one. */
export const GROUP_WEIGHTS: Readonly<Record<GroupName, number>> = { arc: 0.3, dialogue: 0.15, embodiment: 0.2, camera: 0.1, engagement: 0.25 };

/** One measured number, scored against a band, with why. */
export type Reading = {
  metric: string;
  /** The measured value; null when the run has nothing to measure it on (the reading is then left out of the group's mean). */
  value: number | null;
  /** 0-100; null with a null value. */
  score: number | null;
  weight: number;
  /** The band it was read against, when it was read against one. */
  band?: Band;
  /** One plain sentence: what was measured and what it means. */
  note: string;
};

export type GroupScore = {
  name: GroupName;
  /** 0-100, the weight-normalised mean of the readings that exist; null when none do (the group is left out of the overall). */
  score: number | null;
  readings: Reading[];
  /** Extra facts the readings were computed from (the climax, the counts), for the report. */
  detail: Record<string, unknown>;
};

export const round1 = (v: number): number => Math.round(v * 10) / 10;
export const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** A reading from a value and a norm. A null / NaN value is "not measurable here". */
export function read(metric: MetricId, value: number | null, weight: number, band: Band, note: string): Reading {
  if (value === null || Number.isNaN(value)) return { metric, value: null, score: null, weight, band, note };
  return { metric, value: round3(value), score: round1(bandScore(value, band)), weight, band, note };
}

/** A reading the run cannot be measured on (kept in the report with its band and why, left out of the group's mean). */
export function readSkip(metric: MetricId | string, weight: number, band: Band | undefined, note: string): Reading {
  return { metric, value: null, score: null, weight, ...(band ? { band } : {}), note };
}

/** A reading for a thing the run failed to do at all (no climax, no incident): it counts in the group's mean as 0 and has no value. */
export function readFail(metric: MetricId | string, weight: number, note: string, band?: Band): Reading {
  return { metric, value: null, score: 0, weight, ...(band ? { band } : {}), note };
}

/** A reading with an explicit score (no band): used where the metric is already 0-100 (script-likeness). */
export function readScore(metric: string, value: number | null, score: number | null, weight: number, note: string): Reading {
  return { metric, value: value === null ? null : round3(value), score: score === null ? null : round1(score), weight, note };
}

/** Margin above the weakest `core` reading that a group may score (the script-likeness cap rule: four good parts cannot carry one that fails). */
export const CORE_CAP_MARGIN = 40;

/**
 * Weight-normalised mean of the readings that have a score. `core` names readings that are the point of the group: the group never scores more than
 * the weakest of them plus {@link CORE_CAP_MARGIN}, so a scene with one act cannot be carried by its faces, walks and entrances.
 */
export function groupOf(name: GroupName, readings: Reading[], detail: Record<string, unknown> = {}, core: readonly string[] = []): GroupScore {
  const scored = readings.filter((r) => r.score !== null);
  const total = scored.reduce((a, r) => a + r.weight, 0);
  let score = total === 0 ? null : scored.reduce((a, r) => a + r.score! * r.weight, 0) / total;
  const coreScores = scored.filter((r) => core.includes(r.metric)).map((r) => r.score!);
  let cap: number | undefined;
  if (score !== null && coreScores.length > 0) {
    cap = Math.min(...coreScores) + CORE_CAP_MARGIN;
    if (score > cap) score = cap;
    else cap = undefined;
  }
  return { name, score: score === null ? null : round1(score), readings, detail: cap === undefined ? detail : { ...detail, coreCap: round1(cap) } };
}
