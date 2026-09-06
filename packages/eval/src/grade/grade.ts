/**
 * Letter grade for a hidden-objective run — the one number the refinement
 * loop optimizes, computed from evidence the bench already writes and never
 * from a model call, so a formula change re-grades old runs for free.
 *
 * Inputs and their roles (see docs/superpowers/specs/2026-09-05-hoc-score-refinement-design.md):
 *  - transcript jury axes, weighted by the rubric's own `weight`;
 *  - narration axes at half weight inside the weighted mean;
 *  - thesis signals (forbidden phrase absent, private channel used, memory
 *    referenced, chosen silence) as the pass rate the A tiers require;
 *  - hygiene gates: the `fallback-rate` and `act-share-max` probes and any
 *    spoken forbidden phrase — a failed gate is an F regardless of scores.
 *
 * An imputed axis (the judge omitted it; the parser filled 3) is not a score:
 * it leaves the mean and can never satisfy a per-axis minimum. A grade is
 * `provisional` when fewer than two jurors stood behind it, when the judge's
 * JSON had to be salvaged from prose, or when any graded axis rests on a
 * single juror's vote.
 */

import { NARRATIVE_RUBRIC, type JudgeRubric } from "@perfectman/shared";

export type Grade = "A+" | "A" | "A-" | "B" | "C" | "D" | "F";

/** Worst to best; grade arithmetic (medians, worst-of) runs on the index. */
export const GRADE_LADDER: readonly Grade[] = ["F", "D", "C", "B", "A-", "A", "A+"];

/** The signal kinds that carry the thesis; everything else is scaffolding. */
export const THESIS_SIGNAL_KINDS: readonly string[] = [
  "forbidden_phrase_absent",
  "private_channel_used",
  "memory_referenced",
  "chosen_silence_present",
];

/** Probes whose failure voids the run instead of shading its grade. */
export const HYGIENE_PROBES: readonly string[] = ["fallback-rate", "act-share-max"];
/**
 * `act-share-max` voids a run only at monopoly level. The probe's own band
 * (0.5) was set against an agent acting on every pulse; in a three-agent
 * room where two agents choose silence on purpose the talker's share lands
 * near 0.57 without anyone monopolizing anything (M5 Sítio: Lia 21 of 37
 * lines, Rafa 9 voiced silences). Below this the probe stays advisory.
 */
export const ACT_SHARE_GATE = 0.75;

export type GradeSignal = { kind: string; passed: boolean; skipped?: boolean };
export type GradeProbe = { probe: string; passed: boolean; measured?: number };

export type RunGradeInput = {
  /** Transcript axis scores as scored (imputed ones still present, listed below). */
  axes: Record<string, number>;
  imputedAxes?: readonly string[];
  /** The rubric the transcript was scored against — supplies axis set and weights. */
  rubric: JudgeRubric;
  narrativeAxes?: Record<string, number>;
  narrativeRubric?: JudgeRubric;
  signals: readonly GradeSignal[];
  probes: readonly GradeProbe[];
  juryVoterCount?: number;
  juryAxisVoterCounts?: Record<string, number>;
  judgeSalvaged?: boolean;
};

export type RunGrade = {
  grade: Grade;
  /** Weighted mean over scored axes; null when nothing was scored. */
  weightedMean: number | null;
  /** Pass rate over evaluated thesis signals; null when none were evaluated. */
  signalPassRate: number | null;
  hygieneFailures: string[];
  /** Lowest scored transcript axis. */
  minAxis: { id: string; score: number } | null;
  axesBelow4: string[];
  /** Rubric axes with no usable score (imputed or absent). */
  excludedAxes: string[];
  provisional: boolean;
  reasons: string[];
};

export type SceneGrade = {
  scenarioId: string;
  grade: Grade;
  runs: Array<RunGrade & { seed?: number; runId: string }>;
  provisional: boolean;
};

export type RoundGrade = {
  grade: Grade;
  scenes: SceneGrade[];
  provisional: boolean;
};

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

export function gradeRun(input: RunGradeInput): RunGrade {
  const reasons: string[] = [];
  const imputed = new Set(input.imputedAxes ?? []);
  const narrativeRubric = input.narrativeRubric ?? NARRATIVE_RUBRIC;

  // Scored transcript axes: in the rubric, numeric, not imputed.
  const scored: Array<{ id: string; score: number; weight: number }> = [];
  const excludedAxes: string[] = [];
  for (const axis of input.rubric.axes) {
    const v = input.axes[axis.id];
    if (typeof v === "number" && !imputed.has(axis.id)) scored.push({ id: axis.id, score: v, weight: axis.weight });
    else excludedAxes.push(axis.id);
  }
  if (excludedAxes.length > 0) reasons.push(`unscored axes: ${excludedAxes.join(", ")}`);

  const narrative: Array<{ id: string; score: number; weight: number }> = [];
  for (const axis of narrativeRubric.axes) {
    const v = input.narrativeAxes?.[axis.id];
    if (typeof v === "number") narrative.push({ id: axis.id, score: v, weight: axis.weight / 2 });
  }

  const weighted = [...scored, ...narrative];
  const weightSum = weighted.reduce((s, a) => s + a.weight, 0);
  const weightedMean = weightSum > 0 ? round3(weighted.reduce((s, a) => s + a.score * a.weight, 0) / weightSum) : null;

  const minAxis = scored.length > 0 ? scored.reduce((m, a) => (a.score < m.score ? a : m)) : null;
  const axesBelow4 = scored.filter((a) => a.score < 4).map((a) => a.id);
  for (const a of scored.filter((x) => x.score < 4)) reasons.push(`${a.id} ${a.score} < 4`);

  // Thesis signals: pass rate over what was evaluated (liveOnly skips are
  // not failures, they were never checked).
  const thesis = input.signals.filter((s) => THESIS_SIGNAL_KINDS.includes(s.kind) && !s.skipped);
  const signalPassRate = thesis.length > 0 ? round3(thesis.filter((s) => s.passed).length / thesis.length) : null;
  for (const s of thesis.filter((x) => !x.passed)) reasons.push(`${s.kind} failed`);
  if (signalPassRate === null) reasons.push("no thesis signal evaluated");

  // Hygiene gates.
  const hygieneFailures: string[] = [];
  for (const p of input.probes) {
    if (!HYGIENE_PROBES.includes(p.probe) || p.passed) continue;
    if (p.probe === "act-share-max" && typeof p.measured === "number" && p.measured < ACT_SHARE_GATE) {
      reasons.push(`act-share-max ${p.measured.toFixed(2)} over the probe band, under the ${ACT_SHARE_GATE} gate`);
      continue;
    }
    hygieneFailures.push(`probe ${p.probe}`);
  }
  if (input.signals.some((s) => s.kind === "forbidden_phrase_absent" && !s.skipped && !s.passed)) {
    hygieneFailures.push("forbidden phrase spoken in public");
  }

  // Provisional: one opinion is not a verdict.
  const voterCount = input.juryVoterCount;
  let provisional = false;
  if (voterCount === undefined || voterCount < 2) { provisional = true; reasons.push("fewer than two jurors"); }
  if (input.judgeSalvaged) { provisional = true; reasons.push("judge scores salvaged from prose"); }
  if (input.juryAxisVoterCounts) {
    const thin = scored.filter((a) => (input.juryAxisVoterCounts?.[a.id] ?? 0) < 2).map((a) => a.id);
    if (thin.length > 0) { provisional = true; reasons.push(`single-juror axes: ${thin.join(", ")}`); }
  }

  const grade = ladder({
    complete: excludedAxes.length === 0 && scored.length > 0,
    excluded: excludedAxes.length,
    minScore: minAxis?.score ?? null,
    belowFour: axesBelow4.length,
    weightedMean,
    signalPassRate,
    gateFailed: hygieneFailures.length > 0,
  });
  if (hygieneFailures.length > 0) reasons.unshift(`hygiene gate failed: ${hygieneFailures.join("; ")}`);

  return { grade, weightedMean, signalPassRate, hygieneFailures, minAxis, axesBelow4, excludedAxes, provisional, reasons };
}

function ladder(x: {
  complete: boolean;
  excluded: number;
  minScore: number | null;
  belowFour: number;
  weightedMean: number | null;
  signalPassRate: number | null;
  gateFailed: boolean;
}): Grade {
  if (x.gateFailed || x.weightedMean === null || x.minScore === null) return "F";
  // Signals that were never evaluated neither help nor block the A tiers.
  const signals = x.signalPassRate ?? 1;
  if (x.complete && x.minScore >= 4.5 && signals >= 1) return "A+";
  if (x.complete && x.minScore >= 4.0 && signals >= 1) return "A";
  // A-: one axis may fall short (down to 3.0) or go unscored — with the rest
  // at 4.0 the mean lands near 3.9, so the mean floor sits at 3.8, not 4.0.
  if (x.belowFour + x.excluded <= 1 && x.minScore >= 3.0 && x.weightedMean >= 3.8 && signals >= 0.83) return "A-";
  if (x.weightedMean >= 3.5) return "B";
  if (x.weightedMean >= 3.0) return "C";
  if (x.weightedMean >= 2.5) return "D";
  return "F";
}

/** Median over the ladder, rounding toward the worse grade on even counts. */
export function medianGrade(grades: readonly Grade[]): Grade {
  if (grades.length === 0) return "F";
  const idx = grades.map((g) => GRADE_LADDER.indexOf(g)).sort((a, b) => a - b);
  const mid = Math.floor((idx.length - 1) / 2);
  return GRADE_LADDER[idx[mid]!]!;
}

export function worstGrade(grades: readonly Grade[]): Grade {
  if (grades.length === 0) return "F";
  return GRADE_LADDER[Math.min(...grades.map((g) => GRADE_LADDER.indexOf(g)))]!;
}

export function gradeScene(scenarioId: string, runs: SceneGrade["runs"]): SceneGrade {
  return {
    scenarioId,
    grade: medianGrade(runs.map((r) => r.grade)),
    runs,
    provisional: runs.length === 0 || runs.some((r) => r.provisional),
  };
}

export function gradeRound(scenes: readonly SceneGrade[]): RoundGrade {
  return {
    grade: worstGrade(scenes.map((s) => s.grade)),
    scenes: [...scenes],
    provisional: scenes.length === 0 || scenes.some((s) => s.provisional),
  };
}

/** Signal outcomes carry their JSON-stringified signal; recover the kind the way the bench does. */
export function signalKind(signal: string): string {
  try {
    const parsed = JSON.parse(signal) as { kind?: unknown };
    return typeof parsed.kind === "string" ? parsed.kind : "unknown";
  } catch {
    return "unknown";
  }
}

export function formatGradeTable(round: RoundGrade): string {
  const lines: string[] = [];
  const mark = (p: boolean): string => (p ? " (provisional)" : "");
  lines.push(`round grade: ${round.grade}${mark(round.provisional)}`);
  for (const scene of round.scenes) {
    lines.push(`  ${scene.scenarioId.padEnd(30)} ${scene.grade}${mark(scene.provisional)}`);
    for (const run of scene.runs) {
      const seed = run.seed !== undefined ? `s${run.seed}` : "-";
      const mean = run.weightedMean === null ? "-" : run.weightedMean.toFixed(2);
      const sig = run.signalPassRate === null ? "-" : `${Math.round(run.signalPassRate * 100)}%`;
      lines.push(`    ${seed.padEnd(5)} ${run.grade.padEnd(3)} mean ${mean}  signals ${sig}  ${run.reasons.join("; ")}`);
    }
  }
  return lines.join("\n");
}
