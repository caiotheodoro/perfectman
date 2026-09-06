/**
 * bench — the roleplay benchmark CLI.
 *
 * Usage:
 *   node dist/cli/bench.js --mode mock --limit 12 --out out/bench-report.json
 *   node dist/cli/bench.js --mode local --scenarios edge_public_mock --judge llm
 *
 * mock mode is fully offline and deterministic (persona-aware mock provider
 * + rule judge). local mode drives the local uncensored model and can use
 * the LLM judge against the same endpoint.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { execSync } from "node:child_process";
import {
  SCENARIO_REGISTRY,
  expandVariants,
  scenariosByCategory,
  getScenario,
  NARRATIVE_RUBRIC,
  type RoleplayScenario,
} from "@perfectman/shared";
import { ScenarioRunner } from "../run/scenario-runner.js";
import {
  ruleJudge,
  llmJudge,
  llmJudgePerTurn,
  juryJudge,
  judgeNarration,
  type AxisScores,
  type JuryVerdict,
} from "../judge/judge.js";
import { MockJudgeProvider } from "../judge/mock-judge-provider.js";
import { calibrateJudge, baseScenarioId, calibrationVerdict } from "../judge/calibration.js";
import { formatGradeTable, gradeRound, gradeRun, gradeScene, signalKind, type RoundGrade, type SceneGrade } from "../grade/grade.js";
import { GOLDEN_LABELS } from "../judge/golden-labels.js";
import { GOLDEN_NARRATIONS } from "../judge/golden-narrations.js";
import { loadJudgeConfig, applyJudgeShorthand } from "../llm/judge-config.js";
import type { ScenarioRunArtifact } from "../run/scenario-runner.js";
import { aggregateSignalsByKind, type SignalOutcome } from "../run/signal-checker.js";
import { BENCH_SLICES, resolveBenchSlice } from "../bench-slices.js";
import { narrateScene, type Narration } from "../narrator/narrator.js";

/**
 * Compatibility view of the judge loader for programmatic callers: the
 * env-resolved endpoint config, exactly as the pre-pivot judgeConfig()
 * returned it. envOnly: no config file is consulted, so a stray walk-up
 * config/index.json can never repoint or break the compat path.
 */
export function judgeConfig(): Promise<import("../judge/judge.js").LLMJudgeConfig> {
  return loadJudgeConfig([], { envOnly: true }).then((resolved) => resolved.config);
}

/** A non-fatal failure the bench kept going past; surfaced instead of swallowed. */
export type BenchWarning = {
  scenarioId?: string;
  stage: "narration" | "narration_judge" | "golden_narration";
  message: string;
};

export type AxisStats = { mean: number; sd: number; min: number; max: number; n: number };

export type BenchReport = {
  version: "bench-report-v1";
  mode: "mock" | "local";
  generatedAt: string;
  /** `--run-id`: the evidence directory this report was written to. */
  runId?: string;
  /** `--seeds`: every scenario ran once per seed; empty when the default seed was used. */
  seeds: number[];
  pulseLimit?: number;
  warnings: BenchWarning[];
  /** Per-axis spread over all runs (scenarios × seeds) — the number that decides whether a change beat the noise. */
  judgeAxisStats: Record<string, AxisStats>;
  /** Axis means split by rubric id, since a mixed selection aggregates axes that not every rubric scores. */
  judgeAxisMeansByRubric: Record<string, Record<string, number>>;
  scenariosRun: number;
  scenariosFailed: number;
  signalPassRate: number;
  probePassRate: number;
  probeAverages: Record<string, { mean: number; passedPct: number }>;
  judgeAxisMeans: Record<string, number>;
  judgeAxisTargets: Record<string, { target: number; met: boolean }>;
  byCategory: Record<string, { runs: number; signalPassRate: number }>;
  /** Unique generation prompt versions across all scenarios (attribution). */
  promptVersions: string[];
  /** Unique prompt template versions across all scenarios — compare this across saved reports to check whether the prompt structure changed between runs. */
  promptTemplateVersions: string[];
  signalsByKind: Record<string, import("../run/signal-checker.js").SignalsByKindEntry>;
  calibration: ReturnType<typeof calibrateJudge>;
  /** Retries that fixed a guard violation on the first attempt — not free,
   *  but not a terminal `llm_failure` either (see `llm_retry_recovered`). */
  recoveredFallbacks: number;
  /** `liveOnly` signals skipped because the run was in mock mode — never in a pass rate. */
  signalsSkipped: number;
  /** Scores the Narration object (title/recap/hiddenShift), not the
   *  transcript — see NARRATIVE_RUBRIC. Only populated in single-judge
   *  openai-compatible mode (a rule/mock judge has no narrative-quality
   *  equivalent, and jury narration scoring is out of scope for now). */
  narrativeAxisMeans: Record<string, number>;
  narrativeAxisTargets: Record<string, { target: number; met: boolean }>;
  narrativeCalibration: ReturnType<typeof calibrateJudge>;
  /** Letter grades (per run, per scene, round) — only when a hidden-objective rubric ran; see grade/grade.ts. */
  grades?: RoundGrade;
  perScenario: Array<{
    id: string;
    name: string;
    category: string;
    signalPassRate: number;
    probePasses: number;
    probeTotal: number;
    axisScores: AxisScores;
    fallbackCount: number;
    recoveredFallbacks: number;
    latencyMs: number;
    promptVersions: string[];
    judgeSalvaged?: boolean;
    /** Jury mode only: how many unsalvaged jurors produced the median verdict. */
    juryVoterCount?: number;
    /** Jury mode only: jurors that errored (label → reason) — non-empty means the verdict degraded. */
    juryFailed?: Record<string, string>;
    /** Jury mode only: votes behind each axis's median (an axis with 1 is a single opinion, not a median). */
    juryAxisVoterCounts?: Record<string, number>;
    /** Axes the judge omitted; filled with 3 in `axisScores` for display, excluded from every aggregate. */
    imputedAxes?: string[];
    /** What the judge cited per axis (single judge) or per juror label (jury). */
    judgeEvidence?: Record<string, string> | Record<string, Record<string, string>>;
    seed?: number;
    narration?: Narration;
    narrativeAxisScores?: AxisScores;
    narrativeSalvaged?: boolean;
    failed?: string;
  }>;
};

/** `hoc_fatia__v2` → 2; an un-suffixed id is variant 0. */
function variantIndex(scenarioId: string): number {
  const m = /__v(\d+)$/.exec(scenarioId);
  return m ? Number(m[1]) : 0;
}

/** Per-juror evidence, keyed by label; empty when no juror cited anything. */
function juryEvidence(verdict: JuryVerdict): Record<string, Record<string, string>> | undefined {
  const out: Record<string, Record<string, string>> = {};
  for (const [label, juror] of Object.entries(verdict.perJudge)) {
    if (juror.evidence && Object.keys(juror.evidence).length > 0) out[label] = juror.evidence;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function runBench(opts: {
  mode?: "mock" | "local";
  scenarios?: string[];
  slice?: string;
  category?: string;
  limit?: number;
  /** `--variants N`: keep only the first N seed variants of every selected scenario (a per-scenario cap, unlike `--limit`). */
  variants?: number;
  out?: string;
  /** `--judge rule|llm` shorthand; absent → the resolved config's providerType. */
  judge?: "rule" | "llm";
  perTurn?: boolean;
  /** CLI args for --judge-config resolution (defaults to the module args). */
  args?: string[];
  /** `--seeds 42,43,44`: run every selected scenario once per seed. */
  seeds?: number[];
  /** `--pulse-limit N`: cap every run at N pulses (never above the scenario's own count). */
  pulseLimit?: number;
  /** `--run-id <id>`: write bench-report.json, run-meta.json and per-run transcripts under `<evidenceRoot>/<id>/`. */
  runId?: string;
  /** `--force`: allow `--run-id` to overwrite an existing evidence directory. */
  force?: boolean;
  /** Where `--run-id` directories go (default `docs/eval/evidence`). */
  evidenceRoot?: string;
}): Promise<BenchReport> {
  const seeds = opts.seeds && opts.seeds.length > 0 ? opts.seeds : [];
  const evidenceDir = opts.runId ? resolve(opts.evidenceRoot ?? "docs/eval/evidence", opts.runId) : undefined;
  if (evidenceDir && existsSync(evidenceDir) && !opts.force) {
    throw new Error(`Evidence directory already exists: ${evidenceDir} — pass --force to overwrite it`);
  }
  const mode = opts.mode ?? "mock";
  const perTurn = opts.perTurn ?? false;

  // A judge sampling creatively cannot be a trustworthy calibration gate —
  // the same transcript/narration can score wildly differently run to run
  // for reasons that have nothing to do with quality. calibrate.ts already
  // pins this for the transcript judge for exactly this reason; bench.ts's
  // judge calls (transcript and narration) must default the same way. This
  // is separate from AGENT generation temperature (each persona's own
  // sampling config), which stays creative/varied as intended.
  const resolvedJudge = await loadJudgeConfig(opts.args ?? args, { defaultTemperature: 0 });
  const judgeMode = applyJudgeShorthand(resolvedJudge, opts.judge);
  const mockJudge = new MockJudgeProvider();
  const useJury = judgeMode === "openai-compatible" && (resolvedJudge.jury?.length ?? 0) > 0;
  if (perTurn && useJury) {
    throw new Error(
      "--per-turn cannot be combined with a configured jury — drop the jury or route each juror through llmJudgePerTurn",
    );
  }

  let selected: RoleplayScenario[];
  if (opts.slice !== undefined && opts.scenarios && opts.scenarios.length > 0) {
    throw new Error("Pass either --slice or --scenarios, not both");
  }
  if (opts.slice !== undefined && opts.category) {
    throw new Error("Pass either --slice or --category, not both");
  }
  if (opts.scenarios && opts.scenarios.length > 0) {
    selected = opts.scenarios
      .map(id => getScenario(id))
      .filter((s): s is RoleplayScenario => Boolean(s));
    if (selected.length === 0) {
      throw new Error(`No scenarios matched: ${opts.scenarios.join(", ")}`);
    }
  } else if (opts.slice !== undefined) {
    const ids = resolveBenchSlice(opts.slice);
    if (!ids) {
      throw new Error(`Unknown slice "${opts.slice}" (available: ${Object.keys(BENCH_SLICES).join(", ")})`);
    }
    if (ids.length === 0) {
      throw new Error(`Slice "${opts.slice}" resolved to no scenarios`);
    }
    const unknownIds = ids.filter(id => !getScenario(id));
    if (unknownIds.length > 0) {
      throw new Error(`Slice "${opts.slice}" has unknown scenario ids: ${unknownIds.join(", ")}`);
    }
    selected = ids.map(id => getScenario(id)).filter((x): x is RoleplayScenario => Boolean(x));
  } else if (opts.category) {
    selected = scenariosByCategory(opts.category as never);
  } else {
    selected = [...SCENARIO_REGISTRY];
  }

  const expanded = expandVariants(selected, 7);
  // `--limit` truncates the expanded list, so "one run per scene" across a
  // slice needs a per-scenario cap: `--variants 1` keeps v0 of every scene.
  const capped = opts.variants && opts.variants > 0
    ? expanded.filter((s) => variantIndex(s.id) < opts.variants!)
    : expanded;
  const limited = opts.limit && opts.limit > 0 ? capped.slice(0, opts.limit) : capped;

  const report: BenchReport = {
    version: "bench-report-v1",
    mode,
    generatedAt: new Date().toISOString(),
    ...(opts.runId ? { runId: opts.runId } : {}),
    seeds,
    ...(opts.pulseLimit !== undefined ? { pulseLimit: opts.pulseLimit } : {}),
    warnings: [],
    judgeAxisStats: {},
    judgeAxisMeansByRubric: {},
    scenariosRun: 0,
    scenariosFailed: 0,
    signalPassRate: 0,
    probePassRate: 0,
    probeAverages: {},
    judgeAxisMeans: {},
    judgeAxisTargets: {},
    byCategory: {},
    promptVersions: [],
    promptTemplateVersions: [],
    signalsByKind: {},
    calibration: calibrateJudge(new Map(), []),
    recoveredFallbacks: 0,
    signalsSkipped: 0,
    narrativeAxisMeans: {},
    narrativeAxisTargets: {},
    narrativeCalibration: calibrateJudge(new Map(), []),
    perScenario: [],
  };

  // Narrative scoring needs a real semantic judge — there is no rule/mock
  // equivalent (see NARRATIVE_RUBRIC's doc comment) — and jury narration
  // scoring is out of scope for now, so it runs only in single-judge
  // openai-compatible mode.
  // Under a jury the narration is scored by the primary judge config rather
  // than dropped — narrative axes are part of the experiment's decision rule.
  const scoreNarratives = judgeMode === "openai-compatible";

  const judgeScores = new Map<string, AxisScores>();
  const narrativeAxisAgg: Record<string, { sum: number; count: number }> = {};
  const probeAgg: Record<string, { sum: number; count: number; passed: number }> = {};
  const axisAgg: Record<string, { sum: number; count: number }> = {};
  const signalKindResults: SignalOutcome[] = [];
  let signalsPassed = 0;
  let signalsTotal = 0;
  let probesPassed = 0;
  let probesTotal = 0;
  const catAgg: Record<string, { runs: number; signalsPassed: number; signalsTotal: number }> = {};
  const allPromptVersions = new Set<string>();
  const allTemplateVersions = new Set<string>();

  const axisValues: Record<string, number[]> = {};
  const rubricAxisAgg: Record<string, Record<string, { sum: number; count: number }>> = {};
  const evidenceRecords: Array<{ file: string; record: unknown }> = [];
  const runSeeds: Array<number | undefined> = seeds.length > 0 ? seeds : [undefined];
  const gradeInputs = new Map<string, SceneGrade["runs"]>();

  for (const scenario of limited) for (const seed of runSeeds) {
    try {
      const artifact: ScenarioRunArtifact = await ScenarioRunner.run(scenario, {
        llmMode: mode,
        ...(seed !== undefined ? { seed } : {}),
        ...(opts.pulseLimit !== undefined ? { pulseLimit: opts.pulseLimit } : {}),
      });
      report.scenariosRun++;
      report.recoveredFallbacks += artifact.recoveredFallbacks ?? 0;
      report.signalsSkipped += artifact.skippedSignals ?? 0;
      artifact.promptVersions.forEach((v) => allPromptVersions.add(v));
      artifact.templateVersions.forEach((v) => allTemplateVersions.add(v));

      let juryVerdict: JuryVerdict | undefined;
      let judgeResult: { axes: AxisScores; salvaged: boolean; imputedAxes?: string[]; evidence?: Record<string, string> };
      if (useJury) {
        // A jury is a median over independently-sourced judges — a juror
        // that errored is dropped and recorded, never silently diluted.
        // voterCount/failed ride into the report so a degraded verdict is
        // traceable (a 3-juror jury with 2 errors is a single-judge read).
        juryVerdict = await juryJudge(scenario, artifact.events, resolvedJudge.jury!);
        // Axes no juror scored are absent from the verdict, not imputed.
        judgeResult = { axes: juryVerdict.axes, salvaged: false, imputedAxes: [] };
      } else if (judgeMode === "openai-compatible") {
        judgeResult = perTurn
          ? await llmJudgePerTurn(scenario, artifact.events, resolvedJudge.config)
          : await llmJudge(scenario, artifact.events, resolvedJudge.config);
      } else if (judgeMode === "mock") {
        judgeResult = mockJudge.judge(scenario);
      } else {
        judgeResult = {
          axes: ruleJudge(scenario, artifact.events, artifact.probeResults, artifact.passedSignals / Math.max(1, artifact.totalSignals)),
          salvaged: false,
        };
      }
      const axisScores = judgeResult.axes;
      const imputedAxes = judgeResult.imputedAxes ?? [];
      // An imputed axis is the parser's neutral 3, not a judgment: it stays
      // in `axisScores` for display but never reaches a mean, a spread, or
      // the calibration map — a fabricated midpoint would compress kappa
      // and lift a failing axis to "met".
      const scoredAxes: AxisScores = Object.fromEntries(
        Object.entries(axisScores).filter(([axis]) => !imputedAxes.includes(axis)),
      );

      // A salvaged score is a fabricated/imputed read, not a clean parse —
      // feeding it into calibration would silently compress the kappa the
      // golden-label gate depends on.
      if (!judgeResult.salvaged) {
        judgeScores.set(baseScenarioId(scenario.id), scoredAxes);
      }
      for (const [axis, v] of Object.entries(scoredAxes)) {
        axisAgg[axis] ??= { sum: 0, count: 0 };
        axisAgg[axis]!.sum += v;
        axisAgg[axis]!.count++;
        (axisValues[axis] ??= []).push(v);
        const byRubric = (rubricAxisAgg[scenario.rubric.id] ??= {});
        byRubric[axis] ??= { sum: 0, count: 0 };
        byRubric[axis]!.sum += v;
        byRubric[axis]!.count++;
      }

      signalsPassed += artifact.passedSignals;
      signalsTotal += artifact.totalSignals;
      signalKindResults.push(...artifact.signalResults);
      probesPassed += artifact.probeResults.filter(p => p.passed).length;
      probesTotal += artifact.probeResults.length;
      for (const p of artifact.probeResults) {
        probeAgg[p.probe] ??= { sum: 0, count: 0, passed: 0 };
        probeAgg[p.probe]!.sum += p.measured;
        probeAgg[p.probe]!.count++;
        if (p.passed) probeAgg[p.probe]!.passed++;
      }
      catAgg[scenario.category] ??= { runs: 0, signalsPassed: 0, signalsTotal: 0 };
      catAgg[scenario.category]!.runs++;
      catAgg[scenario.category]!.signalsPassed += artifact.passedSignals;
      catAgg[scenario.category]!.signalsTotal += artifact.totalSignals;

      let narration: Narration | undefined;
      let narrativeAxisScores: AxisScores | undefined;
      let narrativeSalvaged: boolean | undefined;
      if (scoreNarratives) {
        // A narration failure (transport error, unparseable judge response)
        // must not sink the scenario's transcript scoring — narrative
        // quality is an additional signal, not a new single point of failure.
        try {
          narration = await narrateScene(scenario, artifact.events);
          const narrativeResult = await judgeNarration(scenario, artifact.events, narration, resolvedJudge.config);
          narrativeAxisScores = narrativeResult.axes;
          narrativeSalvaged = narrativeResult.salvaged;
          if (!narrativeResult.salvaged) {
            for (const [axis, v] of Object.entries(narrativeResult.axes)) {
              narrativeAxisAgg[axis] ??= { sum: 0, count: 0 };
              narrativeAxisAgg[axis]!.sum += v;
              narrativeAxisAgg[axis]!.count++;
            }
          }
        } catch (err) {
          // Recorded as absent (no narrativeAxisScores) and as a warning —
          // never thrown, so one narration failure does not fail the
          // scenario, and never silent, so a shrinking narrative sample
          // cannot pass unnoticed.
          const message = err instanceof Error ? err.message : String(err);
          report.warnings.push({ scenarioId: scenario.id, stage: narration ? "narration_judge" : "narration", message });
          console.error(`[bench] ${scenario.id}: ${narration ? "narration judge" : "narration"} failed — ${message}`);
        }
      }

      if (scenario.rubric.id === "hidden-objective-v1") {
        const graded = gradeRun({
          axes: axisScores,
          imputedAxes,
          rubric: scenario.rubric,
          narrativeAxes: narrativeAxisScores,
          signals: artifact.signalResults.map((s) => ({ kind: signalKind(s.signal), passed: s.passed, skipped: s.skipped })),
          probes: artifact.probeResults.map((p) => ({ probe: p.probe, passed: p.passed })),
          juryVoterCount: juryVerdict?.voterCount,
          juryAxisVoterCounts: juryVerdict?.axisVoterCounts,
          judgeSalvaged: judgeResult.salvaged,
        });
        const baseId = baseScenarioId(scenario.id);
        const runs = gradeInputs.get(baseId) ?? [];
        runs.push({ ...graded, ...(seed !== undefined ? { seed } : {}), runId: scenario.id });
        gradeInputs.set(baseId, runs);
      }
      const judgeEvidence = juryVerdict
        ? juryEvidence(juryVerdict)
        : judgeResult.evidence && Object.keys(judgeResult.evidence).length > 0
          ? judgeResult.evidence
          : undefined;
      report.perScenario.push({
        id: scenario.id,
        name: scenario.name,
        category: scenario.category,
        signalPassRate: artifact.totalSignals > 0 ? artifact.passedSignals / artifact.totalSignals : 1,
        probePasses: artifact.probeResults.filter(p => p.passed).length,
        probeTotal: artifact.probeResults.length,
        axisScores,
        fallbackCount: artifact.fallbackCount,
        recoveredFallbacks: artifact.recoveredFallbacks ?? 0,
        ...(seed !== undefined ? { seed } : {}),
        latencyMs: artifact.latencyMs,
        promptVersions: artifact.promptVersions,
        judgeSalvaged: judgeResult.salvaged,
        juryVoterCount: juryVerdict?.voterCount,
        juryFailed: juryVerdict?.failed,
        ...(juryVerdict ? { juryAxisVoterCounts: juryVerdict.axisVoterCounts } : {}),
        ...(imputedAxes.length > 0 ? { imputedAxes } : {}),
        ...(judgeEvidence ? { judgeEvidence } : {}),
        narration,
        narrativeAxisScores,
        narrativeSalvaged,
      });
      if (evidenceDir) {
        evidenceRecords.push({
          file: `${scenario.id}${seed !== undefined ? `__s${seed}` : ""}.json`,
          record: {
            id: scenario.id,
            seed,
            events: artifact.events,
            axisScores,
            imputedAxes,
            judgeEvidence,
            juryAxisVoterCounts: juryVerdict?.axisVoterCounts,
            narration,
            narrativeAxisScores,
            signalResults: artifact.signalResults,
            probeResults: artifact.probeResults,
            llmCalls: Object.fromEntries(artifact.llmCalls),
            fallbackCount: artifact.fallbackCount,
            fallbackNoOps: artifact.fallbackNoOps,
            recoveredFallbacks: artifact.recoveredFallbacks,
            llmFailures: artifact.llmFailures ?? [],
          },
        });
      }
    } catch (err) {
      report.scenariosFailed++;
      report.perScenario.push({
        id: scenario.id,
        name: scenario.name,
        category: scenario.category,
        signalPassRate: 0,
        probePasses: 0,
        probeTotal: 0,
        axisScores: {},
        fallbackCount: 0,
        recoveredFallbacks: 0,
        ...(seed !== undefined ? { seed } : {}),
        latencyMs: 0,
        promptVersions: [],
        failed: err instanceof Error ? err.message : String(err),
      });
    }
  }

  report.signalPassRate = signalsTotal > 0 ? signalsPassed / signalsTotal : 0;
  report.signalsByKind = aggregateSignalsByKind(signalKindResults);
  report.probePassRate = probesTotal > 0 ? probesPassed / probesTotal : 0;
  report.probeAverages = Object.fromEntries(
    Object.entries(probeAgg).map(([id, a]) => [id, {
      mean: a.sum / a.count,
      passedPct: a.passed / a.count,
    }]),
  );
  report.judgeAxisMeans = Object.fromEntries(
    Object.entries(axisAgg).map(([id, a]) => [id, Math.round((a.sum / a.count) * 1000) / 1000]),
  );
  // Targets are the union over every selected rubric — a mixed selection
  // (roleplay + hidden-objective) must show mask_integrity's bar, not just
  // whatever the first scenario happened to score. Conflicting mins keep the
  // stricter one.
  const targetMin: Record<string, number> = {};
  for (const scenario of limited) {
    for (const t of scenario.rubric.targets) {
      targetMin[t.axisId] = Math.max(targetMin[t.axisId] ?? 0, t.min);
    }
  }
  if (gradeInputs.size > 0) {
    report.grades = gradeRound([...gradeInputs.entries()].map(([id, runs]) => gradeScene(id, runs)));
  }
  report.judgeAxisTargets = Object.fromEntries(
    Object.entries(targetMin).map(([axisId, min]) => [axisId, {
      target: min,
      met: (report.judgeAxisMeans[axisId] ?? 0) >= min,
    }]),
  );
  report.judgeAxisMeansByRubric = Object.fromEntries(
    Object.entries(rubricAxisAgg).map(([rubricId, axes]) => [
      rubricId,
      Object.fromEntries(Object.entries(axes).map(([id, a]) => [id, Math.round((a.sum / a.count) * 1000) / 1000])),
    ]),
  );
  report.judgeAxisStats = Object.fromEntries(
    Object.entries(axisValues).map(([axis, values]) => {
      const n = values.length;
      const mean = values.reduce((s, v) => s + v, 0) / n;
      const sd = n > 1 ? Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
      const r = (x: number) => Math.round(x * 1000) / 1000;
      return [axis, { mean: r(mean), sd: r(sd), min: Math.min(...values), max: Math.max(...values), n }];
    }),
  );
  report.byCategory = Object.fromEntries(
    Object.entries(catAgg).map(([cat, a]) => [cat, {
      runs: a.runs,
      signalPassRate: a.signalsTotal > 0 ? a.signalsPassed / a.signalsTotal : 0,
    }]),
  );
  report.calibration = calibrateJudge(judgeScores, GOLDEN_LABELS, 0.7);
  report.promptVersions = [...allPromptVersions];
  report.promptTemplateVersions = [...allTemplateVersions];

  if (scoreNarratives) {
    report.narrativeAxisMeans = Object.fromEntries(
      Object.entries(narrativeAxisAgg).map(([id, a]) => [id, Math.round((a.sum / a.count) * 1000) / 1000]),
    );
    report.narrativeAxisTargets = Object.fromEntries(
      NARRATIVE_RUBRIC.targets.map(t => [t.axisId, {
        target: t.min,
        met: (report.narrativeAxisMeans[t.axisId] ?? 0) >= t.min,
      }]),
    );

    // Calibration scores the FIXED golden narration text directly (not a
    // live run's narration) — same reasoning as GOLDEN_LABELS: this checks
    // whether the judge agrees with a human, independent of whatever the
    // pipeline happens to produce this round.
    const narrativeJudgeScores = new Map<string, AxisScores>();
    for (const golden of GOLDEN_NARRATIONS) {
      try {
        const result = await judgeNarration(golden.scenario, golden.events, golden.narration, resolvedJudge.config);
        if (!result.salvaged) narrativeJudgeScores.set(golden.id, result.axes);
      } catch (err) {
        // A single golden-narration judging failure must not sink the whole
        // calibration report — it contributes no data point for that id, and
        // says so, because a calibration over fewer pairs than the golden
        // set holds is a different (weaker) measurement.
        const message = err instanceof Error ? err.message : String(err);
        report.warnings.push({ scenarioId: golden.id, stage: "golden_narration", message });
        console.error(`[bench] golden narration ${golden.id}: judge failed — ${message}`);
      }
    }
    report.narrativeCalibration = calibrateJudge(
      narrativeJudgeScores,
      GOLDEN_NARRATIONS.map(g => ({ scenarioId: g.id, axes: g.axes, note: g.note })),
      0.7,
    );
  }

  if (opts.out) {
    const outPath = resolve(opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  }
  if (evidenceDir) {
    writeEvidenceRun(evidenceDir, report, resolvedJudge, evidenceRecords, mode);
  }
  return report;
}

/**
 * `--run-id`: a committed, reproducible evidence directory. `run-meta.json`
 * records what produced the numbers — git sha, generator and judge routes,
 * seeds, pulse cap, prompt/template versions — and the NAMES of the
 * PERFECTMAN_* environment variables in force, never their values.
 */
function writeEvidenceRun(
  dir: string,
  report: BenchReport,
  judge: Awaited<ReturnType<typeof loadJudgeConfig>>,
  records: ReadonlyArray<{ file: string; record: unknown }>,
  mode: "mock" | "local",
): void {
  mkdirSync(join(dir, "scenarios"), { recursive: true });
  let gitSha: string | null = null;
  try {
    gitSha = execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    gitSha = null;
  }
  const meta = {
    runId: report.runId,
    generatedAt: report.generatedAt,
    gitSha,
    mode,
    generator: {
      provider: process.env.PERFECTMAN_LLM_PROVIDER ?? null,
      model: process.env.PERFECTMAN_LLM_MODEL ?? null,
      baseUrl: process.env.PERFECTMAN_LLM_BASE_URL ?? null,
    },
    judge: {
      providerType: judge.providerType,
      model: judge.config.model,
      baseUrl: judge.config.baseUrl,
      temperature: judge.config.temperature ?? null,
      jury: (judge.jury ?? []).map(j => ({ label: j.label ?? null, model: j.model, baseUrl: j.baseUrl, maxTokens: j.maxTokens ?? null })),
    },
    seeds: report.seeds,
    pulseLimit: report.pulseLimit ?? null,
    promptVersions: report.promptVersions,
    promptTemplateVersions: report.promptTemplateVersions,
    envVarNames: Object.keys(process.env).filter(k => k.startsWith("PERFECTMAN_")).sort(),
  };
  writeFileSync(join(dir, "run-meta.json"), JSON.stringify(meta, null, 2), "utf8");
  writeFileSync(join(dir, "bench-report.json"), JSON.stringify(report, null, 2), "utf8");
  for (const { file, record } of records) {
    writeFileSync(join(dir, "scenarios", file), JSON.stringify(record, null, 2), "utf8");
  }
}

function printReport(report: BenchReport): void {
  console.log(`\n=== Perfectman Roleplay Bench (${report.mode}) ===`);
  console.log(`scenarios: ${report.scenariosRun} run, ${report.scenariosFailed} failed`);
  console.log(`recovered fallbacks (retry fixed a guard violation): ${report.recoveredFallbacks}`);
  console.log(`signal pass rate: ${(report.signalPassRate * 100).toFixed(1)}%${report.signalsSkipped > 0 ? ` (${report.signalsSkipped} liveOnly signal(s) skipped in mock mode)` : ""}`);
  console.log(`probe pass rate: ${(report.probePassRate * 100).toFixed(1)}%`);
  const byKind = Object.entries(report.signalsByKind).sort((a, b) => a[1].passRate - b[1].passRate);
  if (byKind.length > 0) {
    console.log("\nsignal pass rate by kind (worst first):");
    for (const [kind, a] of byKind) {
      console.log(`  ${kind.padEnd(26)} ${(a.passRate * 100).toFixed(0)}% (${a.passed}/${a.total})`);
      for (const ex of a.failExamples.slice(0, 2)) console.log(`    - ${ex}`);
    }
  }
  console.log("\nprobe averages (mean | passed%):");
  for (const [id, a] of Object.entries(report.probeAverages)) {
    console.log(`  ${id.padEnd(26)} ${a.mean.toFixed(3)} | ${(a.passedPct * 100).toFixed(0)}%`);
  }
  console.log(`\njudge axis means (target)${report.seeds.length > 0 ? ` — seeds ${report.seeds.join(",")}, mean ± sd [min..max] n` : ""}:`);
  for (const [axis, mean] of Object.entries(report.judgeAxisMeans)) {
    const t = report.judgeAxisTargets[axis];
    const mark = t ? (t.met ? "OK" : "LOW") : "";
    const s = report.judgeAxisStats[axis];
    const spread = s && s.n > 1 ? ` ± ${s.sd.toFixed(2)} [${s.min}..${s.max}] n=${s.n}` : "";
    console.log(`  ${axis.padEnd(26)} ${mean.toFixed(2)}${spread} ${t ? `(>=${t.target}) ${mark}` : ""}`);
  }
  if (report.warnings.length > 0) {
    console.log(`\nwarnings (${report.warnings.length}) — recorded, not swallowed:`);
    for (const w of report.warnings.slice(0, 8)) console.log(`  ${w.stage}${w.scenarioId ? ` ${w.scenarioId}` : ""}: ${w.message}`);
  }
  console.log("\ncalibration (judge vs golden labels):");
  const cal = report.calibration;
  console.log(`  kappa ${cal.kappa} (target ${cal.targetKappa}) ${calibrationVerdict(cal)} | alpha ${cal.alpha} | matched ${cal.nScenes}/${cal.nGolden} scenes, ${cal.nAxisPairs} axes`);
  if (cal.disagreements.length > 0) {
    console.log("  disagreements:");
    for (const d of cal.disagreements.slice(0, 5)) console.log(`    - ${d}`);
  }
  if (Object.keys(report.narrativeAxisMeans).length > 0) {
    console.log("\nnarrative axis means (target) — scores the narration prose, not the transcript:");
    for (const [axis, mean] of Object.entries(report.narrativeAxisMeans)) {
      const t = report.narrativeAxisTargets[axis];
      const mark = t ? (t.met ? "OK" : "LOW") : "";
      console.log(`  ${axis.padEnd(26)} ${mean.toFixed(2)} ${t ? `(>=${t.target}) ${mark}` : ""}`);
    }
    console.log("\nnarrative calibration (judge vs golden narrations):");
    const ncal = report.narrativeCalibration;
    console.log(`  kappa ${ncal.kappa} (target ${ncal.targetKappa}) ${calibrationVerdict(ncal)} | alpha ${ncal.alpha} | matched ${ncal.nScenes}/${ncal.nGolden} scenes, ${ncal.nAxisPairs} axes`);
    if (ncal.disagreements.length > 0) {
      console.log("  disagreements:");
      for (const d of ncal.disagreements.slice(0, 5)) console.log(`    - ${d}`);
    }
  }
  console.log("\nby category (signal pass rate):");
  for (const [cat, a] of Object.entries(report.byCategory)) {
    console.log(`  ${cat.padEnd(24)} ${(a.signalPassRate * 100).toFixed(0)}% (${a.runs} runs)`);
  }
  const failedJuries = report.perScenario.filter((s) => s.juryFailed && Object.keys(s.juryFailed).length > 0);
  if (failedJuries.length > 0) {
    console.log("\njury warnings — failed jurors were dropped from the median (perScenario.juryFailed has the reasons):");
    for (const s of failedJuries) {
      console.log(`  ${s.id}: ${Object.entries(s.juryFailed!).map(([l, r]) => `${l} (${r})`).join(", ")}`);
    }
  }
}

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(): Promise<void> {
  const report = await runBench({
    mode: (argValue("--mode") as "mock" | "local") ?? "mock",
    scenarios: args.includes("--scenarios") ? (argValue("--scenarios") ?? "").split(",").filter(Boolean) : undefined,
    slice: args.includes("--slice") ? (argValue("--slice") ?? "") : undefined,
    category: argValue("--category"),
    limit: argValue("--limit") ? Number(argValue("--limit")) : undefined,
    variants: argValue("--variants") ? Number(argValue("--variants")) : undefined,
    out: argValue("--out"),
    // The shorthand overrides the file's providerType only when the flag is
    // actually passed — absent, the file (and the rule default) decides.
    judge: args.includes("--judge") ? (argValue("--judge") as "rule" | "llm") : undefined,
    perTurn: args.includes("--per-turn"),
    seeds: argValue("--seeds") ? (argValue("--seeds") ?? "").split(",").map(Number).filter(n => Number.isFinite(n)) : undefined,
    pulseLimit: argValue("--pulse-limit") ? Number(argValue("--pulse-limit")) : undefined,
    runId: argValue("--run-id"),
    force: args.includes("--force"),
  });
  printReport(report);
  if (report.grades) console.log(`\nletter grades (hidden-objective runs):\n${formatGradeTable(report.grades)}`);
  if (report.runId) console.log(`\nevidence written under docs/eval/evidence/${report.runId}/`);
}

if (process.argv[1]?.endsWith("bench.js") || process.argv[1]?.endsWith("bench.ts")) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
