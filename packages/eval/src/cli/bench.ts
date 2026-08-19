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
import { ruleJudge, llmJudge, llmJudgePerTurn, type AxisScores } from "../judge/judge.js";
import { calibrateJudge } from "../judge/calibration.js";
import { GOLDEN_LABELS } from "../judge/golden-labels.js";
import type { ScenarioRunArtifact } from "../run/scenario-runner.js";

/** LLM judge endpoint — DeepSeek by default when PERFECTMAN_LLM_PROVIDER=deepseek. */
export function judgeConfig(): import("../judge/judge.js").LlmJudgeConfig {
  const provider = process.env.PERFECTMAN_LLM_PROVIDER ?? "local";
  const isDeepseek = provider === "deepseek";
  const tempRaw = Number(process.env.PERFECTMAN_JUDGE_TEMPERATURE);
  return {
    baseUrl:
      process.env.PERFECTMAN_LLM_BASE_URL ??
      (isDeepseek ? "https://api.deepseek.com/v1" : "http://localhost:11434/v1"),
    model:
      process.env.PERFECTMAN_JUDGE_MODEL ??
      process.env.PERFECTMAN_LLM_MODEL ??
      (isDeepseek ? "deepseek-chat" : "qwen3:8b"),
    apiKey: process.env.PERFECTMAN_LLM_API_KEY,
    // Heuristic LLM-as-judge: temperature UP by default (varied, creative
    // reads expose cohesion/voice failures a strict low-temp judge misses).
    // Set PERFECTMAN_JUDGE_TEMPERATURE=0 for deterministic calibration runs.
    temperature: Number.isFinite(tempRaw) ? tempRaw : 1.0,
    timeoutMs: 90000,
  };
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
    failed?: string;
  }>;
};

export async function runBench(opts: {
  mode?: "mock" | "local";
  scenarios?: string[];
  category?: string;
  limit?: number;
  out?: string;
  judge?: "rule" | "llm";
  perTurn?: boolean;
}): Promise<BenchReport> {
  const mode = opts.mode ?? "mock";
  const judgeMode = opts.judge ?? "rule";
  const perTurn = opts.perTurn ?? false;

  let selected: RoleplayScenario[];
  if (opts.scenarios && opts.scenarios.length > 0) {
    selected = opts.scenarios
      .map(id => getScenario(id))
      .filter((s): s is RoleplayScenario => Boolean(s));
    if (selected.length === 0) {
      throw new Error(`No scenarios matched: ${opts.scenarios.join(", ")}`);
    }
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
    calibration: calibrateJudge(new Map(), []),
    perScenario: [],
  };

  const judgeScores = new Map<string, AxisScores>();
  const probeAgg: Record<string, { sum: number; count: number; passed: number }> = {};
  const axisAgg: Record<string, { sum: number; count: number }> = {};
  let signalsPassed = 0;
  let signalsTotal = 0;
  let probesPassed = 0;
  let probesTotal = 0;
  const catAgg: Record<string, { runs: number; signalsPassed: number; signalsTotal: number }> = {};

  for (const scenario of limited) {
    try {
      const artifact: ScenarioRunArtifact = await ScenarioRunner.run(scenario, { llmMode: mode });
      report.scenariosRun++;

      const axisScores =
        judgeMode === "llm"
          ? perTurn
            ? await llmJudgePerTurn(scenario, artifact.events, judgeConfig())
            : await llmJudge(scenario, artifact.events, judgeConfig())
          : ruleJudge(scenario, artifact.events, artifact.probeResults, artifact.passedSignals / Math.max(1, artifact.totalSignals));

      judgeScores.set(scenario.id, axisScores);
      for (const [axis, v] of Object.entries(axisScores)) {
        axisAgg[axis] ??= { sum: 0, count: 0 };
        axisAgg[axis]!.sum += v;
        axisAgg[axis]!.count++;
      }

      signalsPassed += artifact.passedSignals;
      signalsTotal += artifact.totalSignals;
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
        failed: err instanceof Error ? err.message : String(err),
      });
    }
  }

  report.signalPassRate = signalsTotal > 0 ? signalsPassed / signalsTotal : 0;
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
    category: argValue("--category"),
    limit: argValue("--limit") ? Number(argValue("--limit")) : undefined,
    out: argValue("--out"),
    judge: (argValue("--judge") as "rule" | "llm") ?? "rule",
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
