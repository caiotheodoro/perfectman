/**
 * Judge calibration — the honest gate.
 *
 * Measures judge-vs-golden agreement (Cohen's kappa + Krippendorff's alpha,
 * ordinal-weighted for kappa) over a golden set of labeled scenes. A judge
 * that fails the agreement bar must not gate changes — its scores are
 * treated as noisy. Failing reports are committed, never hidden
 * (substrate foundry discipline).
 */

import type { AxisScores } from "./judge.js";

export type GoldenLabel = {
  scenarioId: string;
  axes: AxisScores;
  note?: string;
};

export type CalibrationReport = {
  nScenes: number;
  kappa: number;
  alpha: number;
  targetKappa: number;
  passed: boolean;
  perAxisKappa: Record<string, number>;
  disagreements: string[];
};

function axisValue(scores: Record<string, number>, axis: string): number | undefined {
  const v = scores[axis];
  return typeof v === "number" ? v : undefined;
}

/** Ordinal-weighted Cohen's kappa for 1-5 scales. */
export function weightedKappa(a: number[], b: number[], levels = [1, 2, 3, 4, 5]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  const n = levels.length;
  const weights = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => 1 - ((i - j) ** 2) / ((n - 1) ** 2)),
  );
  const observed = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < a.length; i++) {
    const ai = levels.indexOf(a[i]!);
    const bi = levels.indexOf(b[i]!);
    if (ai < 0 || bi < 0) return 0;
    observed[ai]![bi]!++;
  }
  const row = Array(n).fill(0);
  const col = Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      row[i]! += observed[i]![j]!;
      col[j]! += observed[i]![j]!;
    }
  }
  const total = a.length;
  let wObs = 0;
  let wExp = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      wObs += weights[i]![j]! * observed[i]![j]!;
      wExp += weights[i]![j]! * ((row[i]! * col[j]!) / total);
    }
  }
  wObs /= total;
  wExp /= total;
  if (wExp === 1) return 1;
  return (wObs - wExp) / (1 - wExp);
}

/** Krippendorff's alpha (ordinal) for two raters, equal-length sequences. */
export function krippendorffAlpha(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  const n = a.length;
  const union = [...new Set([...a, ...b])].sort((x, y) => x - y);
  const m = union.length;
  if (m === 0) return 0;
  const idx = new Map(union.map((v, i) => [v, i]));
  const codes = [...a.map(v => idx.get(v)!), ...b.map(v => idx.get(v)!)];
  const counts = Array(m).fill(0);
  for (const c of codes) counts[c]!++;
  const total = codes.length;
  const doMatrix = Array.from({ length: m }, () => Array(m).fill(0));
  for (let i = 0; i < n; i++) {
    const ia = idx.get(a[i]!);
    const ib = idx.get(b[i]!);
    if (ia !== undefined && ib !== undefined) doMatrix[ia]![ib]!++;
  }
  let doSum = 0;
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      doSum += doMatrix[i]![j]! * (i - j) ** 2;
    }
  }
  let deSum = 0;
  for (let c = 0; c < m; c++) {
    deSum += counts[c]! * (total - counts[c]!);
  }
  if (deSum === 0) return 1;
  const doVal = doSum / (n * (n - 1)) * (n - 1); // numerator over unit differences
  const deVal = (2 * deSum) / (total * (total - 1));
  const observed = doVal * 2;
  const expected = deVal * ((m * m - m) / (m * m)) * 2;
  const alpha = 1 - observed / (expected || 1);
  return alpha;
}

export function calibrateJudge(
  judgeScores: Map<string, AxisScores>,
  golden: readonly GoldenLabel[],
  targetKappa = 0.7,
): CalibrationReport {
  const disagreements: string[] = [];
  const axisIds = new Set<string>();
  for (const g of golden) for (const k of Object.keys(g.axes)) axisIds.add(k);
  const perAxisKappa: Record<string, number> = {};
  let axisPairs = 0;
  let kappaSum = 0;
  let allA: number[] = [];
  let allB: number[] = [];

  for (const axis of axisIds) {
    const a: number[] = [];
    const b: number[] = [];
    for (const g of golden) {
      const sceneScores = judgeScores.get(g.scenarioId);
      const j = sceneScores ? axisValue(sceneScores, axis) : undefined;
      const h = axisValue(g.axes, axis);
      if (typeof j === "number" && typeof h === "number") {
        a.push(j);
        b.push(h);
        if (Math.abs(j - h) >= 2) {
          disagreements.push(`${g.scenarioId} ${axis}: judge ${j} vs golden ${h}`);
        }
      }
    }
    if (a.length > 1) {
      const k = weightedKappa(a, b);
      perAxisKappa[axis] = k;
      kappaSum += k;
      axisPairs++;
      allA.push(...a);
      allB.push(...b);
    }
  }

  const kappa = axisPairs > 0 ? kappaSum / axisPairs : 0;
  const alpha = krippendorffAlpha(allA, allB);

  return {
    nScenes: golden.length,
    kappa: Math.round(kappa * 1000) / 1000,
    alpha: Math.round(alpha * 1000) / 1000,
    targetKappa,
    passed: kappa >= targetKappa,
    perAxisKappa,
    disagreements,
  };
}

/**
 * Strips the deterministic variant suffix ("motive_gossip__v2" ->
 * "motive_gossip"). Golden labels and calibration lookups are keyed by
 * base scenario ids; variant-expanded runs must fold back onto them or
 * every judge-vs-golden pair silently misses.
 */
export function baseScenarioId(scenarioId: string): string {
  const sep = scenarioId.lastIndexOf("__v");
  return sep > 0 ? scenarioId.slice(0, sep) : scenarioId;
}
