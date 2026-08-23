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

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  SCENARIO_REGISTRY,
  expandVariants,
  scenariosByCategory,
  getScenario,
  type RoleplayScenario,
} from "@perfectman/shared";
import { ScenarioRunner } from "../run/scenario-runner.js";
import { ruleJudge, llmJudge, llmJudgePerTurn, juryJudge, type AxisScores, type JuryVerdict } from "../judge/judge.js";
import { MockJudgeProvider } from "../judge/mock-judge-provider.js";
import { calibrateJudge, baseScenarioId } from "../judge/calibration.js";
import { GOLDEN_LABELS } from "../judge/golden-labels.js";
import { loadJudgeConfig, applyJudgeShorthand } from "../llm/judge-config.js";
import type { ScenarioRunArtifact } from "../run/scenario-runner.js";
import { aggregateSignalsByKind, type SignalOutcome } from "../run/signal-checker.js";
import { BENCH_SLICES, resolveBenchSlice } from "../bench-slices.js";

/**
 * Compatibility view of the judge loader for programmatic callers: the
 * env-resolved endpoint config, exactly as the pre-pivot judgeConfig()
 * returned it. envOnly: no config file is consulted, so a stray walk-up
 * config/index.json can never repoint or break the compat path.
 */
export function judgeConfig(): Promise<import("../judge/judge.js").LLMJudgeConfig> {
  return loadJudgeConfig([], { envOnly: true }).then((resolved) => resolved.config);
}

export type BenchReport = {
  version: "bench-report-v1";
  mode: "mock" | "local";
  generatedAt: string;
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
  perScenario: Array<{
    id: string;
    name: string;
    category: string;
    signalPassRate: number;
    probePasses: number;
    probeTotal: number;
    axisScores: AxisScores;
    fallbackCount: number;
    latencyMs: number;
    promptVersions: string[];
    judgeSalvaged?: boolean;
    /** Jury mode only: how many unsalvaged jurors produced the median verdict. */
    juryVoterCount?: number;
    /** Jury mode only: jurors that errored (label → reason) — non-empty means the verdict degraded. */
    juryFailed?: Record<string, string>;
    failed?: string;
  }>;
};

export async function runBench(opts: {
  mode?: "mock" | "local";
  scenarios?: string[];
  slice?: string;
  category?: string;
  limit?: number;
  out?: string;
  /** `--judge rule|llm` shorthand; absent → the resolved config's providerType. */
  judge?: "rule" | "llm";
  perTurn?: boolean;
  /** CLI args for --judge-config resolution (defaults to the module args). */
  args?: string[];
}): Promise<BenchReport> {
  const mode = opts.mode ?? "mock";
  const perTurn = opts.perTurn ?? false;

  const resolvedJudge = await loadJudgeConfig(opts.args ?? args);
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
  const limited = opts.limit && opts.limit > 0 ? expanded.slice(0, opts.limit) : expanded;

  const report: BenchReport = {
    version: "bench-report-v1",
    mode,
    generatedAt: new Date().toISOString(),
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
    perScenario: [],
  };

  const judgeScores = new Map<string, AxisScores>();
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

  for (const scenario of limited) {
    try {
      const artifact: ScenarioRunArtifact = await ScenarioRunner.run(scenario, { llmMode: mode });
      report.scenariosRun++;
      artifact.promptVersions.forEach((v) => allPromptVersions.add(v));
      artifact.templateVersions.forEach((v) => allTemplateVersions.add(v));

      let juryVerdict: JuryVerdict | undefined;
      let judgeResult: { axes: AxisScores; salvaged: boolean };
      if (useJury) {
        // A jury is a median over independently-sourced judges — a juror
        // that errored is dropped and recorded, never silently diluted.
        // voterCount/failed ride into the report so a degraded verdict is
        // traceable (a 3-juror jury with 2 errors is a single-judge read).
        juryVerdict = await juryJudge(scenario, artifact.events, resolvedJudge.jury!);
        judgeResult = { axes: juryVerdict.axes, salvaged: false };
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

      // A salvaged score is a fabricated/imputed read, not a clean parse —
      // feeding it into calibration would silently compress the kappa the
      // golden-label gate depends on.
      if (!judgeResult.salvaged) {
        judgeScores.set(baseScenarioId(scenario.id), axisScores);
      }
      for (const [axis, v] of Object.entries(axisScores)) {
        axisAgg[axis] ??= { sum: 0, count: 0 };
        axisAgg[axis]!.sum += v;
        axisAgg[axis]!.count++;
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

      report.perScenario.push({
        id: scenario.id,
        name: scenario.name,
        category: scenario.category,
        signalPassRate: artifact.totalSignals > 0 ? artifact.passedSignals / artifact.totalSignals : 1,
        probePasses: artifact.probeResults.filter(p => p.passed).length,
        probeTotal: artifact.probeResults.length,
        axisScores,
        fallbackCount: artifact.fallbackCount,
        latencyMs: artifact.latencyMs,
        promptVersions: artifact.promptVersions,
        judgeSalvaged: judgeResult.salvaged,
        juryVoterCount: juryVerdict?.voterCount,
        juryFailed: juryVerdict?.failed,
      });
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
  const targets = selected[0]?.rubric.targets ?? [];
  report.judgeAxisTargets = Object.fromEntries(
    targets.map(t => [t.axisId, {
      target: t.min,
      met: (report.judgeAxisMeans[t.axisId] ?? 0) >= t.min,
    }]),
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

  if (opts.out) {
    const outPath = resolve(opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  }
  return report;
}

function printReport(report: BenchReport): void {
  console.log(`\n=== Perfectman Roleplay Bench (${report.mode}) ===`);
  console.log(`scenarios: ${report.scenariosRun} run, ${report.scenariosFailed} failed`);
  console.log(`signal pass rate: ${(report.signalPassRate * 100).toFixed(1)}%`);
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
  console.log("\njudge axis means (target):");
  for (const [axis, mean] of Object.entries(report.judgeAxisMeans)) {
    const t = report.judgeAxisTargets[axis];
    const mark = t ? (t.met ? "OK" : "LOW") : "";
    console.log(`  ${axis.padEnd(26)} ${mean.toFixed(2)} ${t ? `(>=${t.target}) ${mark}` : ""}`);
  }
  console.log("\ncalibration (judge vs golden labels):");
  const cal = report.calibration;
  console.log(`  kappa ${cal.kappa} (target ${cal.targetKappa}) ${cal.passed ? "PASS" : "FAIL"} | alpha ${cal.alpha} | n=${cal.nScenes}`);
  if (cal.disagreements.length > 0) {
    console.log("  disagreements:");
    for (const d of cal.disagreements.slice(0, 5)) console.log(`    - ${d}`);
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
    out: argValue("--out"),
    // The shorthand overrides the file's providerType only when the flag is
    // actually passed — absent, the file (and the rule default) decides.
    judge: args.includes("--judge") ? (argValue("--judge") as "rule" | "llm") : undefined,
    perTurn: args.includes("--per-turn"),
  });
  printReport(report);
}

if (process.argv[1]?.endsWith("bench.js") || process.argv[1]?.endsWith("bench.ts")) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
