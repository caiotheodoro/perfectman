/**
 * behavior — the engine's behavior tests.
 *
 * Usage:
 *   node dist/cli/behavior.js --out out/behavior.json
 *   node dist/cli/behavior.js --scenarios v1_casual_chat --drama
 *
 * Every run uses the persona-aware mock provider, so the suite is offline and
 * deterministic. It checks what the social engine did (events committed,
 * private channels opened, emotion moving) through expected signals and
 * runtime probes. It does not score generated text and does not call a model.
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
import { ScenarioRunner, type ScenarioRunArtifact } from "../run/scenario-runner.js";
import { runDramaBench, type DramaBenchReport } from "../bench/drama-bench.js";
import { aggregateSignalsByKind, type SignalOutcome, type SignalsByKindEntry } from "../run/signal-checker.js";
import { BENCH_SLICES, resolveBenchSlice } from "../bench-slices.js";

export type BehaviorReport = {
  version: "behavior-report-v1";
  generatedAt: string;
  seeds: number[];
  pulseLimit?: number;
  scenariosRun: number;
  scenariosFailed: number;
  signalPassRate: number;
  /** `liveOnly` signals skipped because every run is mock; never in a pass rate. */
  signalsSkipped: number;
  probePassRate: number;
  probeAverages: Record<string, { mean: number; passedPct: number }>;
  byCategory: Record<string, { runs: number; signalPassRate: number }>;
  signalsByKind: Record<string, SignalsByKindEntry>;
  /** The act-contract scenarios on the fake grid hotel; gated on its own. */
  drama?: DramaBenchReport;
  perScenario: Array<{
    id: string;
    name: string;
    category: string;
    signalPassRate: number;
    probePasses: number;
    probeTotal: number;
    seed?: number;
    failed?: string;
  }>;
};

/** `hoc_fatia__v2` → 2; an un-suffixed id is variant 0. */
function variantIndex(scenarioId: string): number {
  const m = /__v(\d+)$/.exec(scenarioId);
  return m ? Number(m[1]) : 0;
}

function selectScenarios(opts: { scenarios?: string[]; slice?: string; category?: string }): RoleplayScenario[] {
  if (opts.slice !== undefined && opts.scenarios && opts.scenarios.length > 0) {
    throw new Error("Pass either --slice or --scenarios, not both");
  }
  if (opts.slice !== undefined && opts.category) {
    throw new Error("Pass either --slice or --category, not both");
  }
  if (opts.scenarios && opts.scenarios.length > 0) {
    const selected = opts.scenarios.map(id => getScenario(id)).filter((s): s is RoleplayScenario => Boolean(s));
    if (selected.length === 0) throw new Error(`No scenarios matched: ${opts.scenarios.join(", ")}`);
    return selected;
  }
  if (opts.slice !== undefined) {
    const ids = resolveBenchSlice(opts.slice);
    if (!ids) throw new Error(`Unknown slice "${opts.slice}" (available: ${Object.keys(BENCH_SLICES).join(", ")})`);
    if (ids.length === 0) throw new Error(`Slice "${opts.slice}" resolved to no scenarios`);
    const unknownIds = ids.filter(id => !getScenario(id));
    if (unknownIds.length > 0) throw new Error(`Slice "${opts.slice}" has unknown scenario ids: ${unknownIds.join(", ")}`);
    return ids.map(id => getScenario(id)).filter((x): x is RoleplayScenario => Boolean(x));
  }
  if (opts.category) return scenariosByCategory(opts.category as never);
  return [...SCENARIO_REGISTRY];
}

export async function runBehavior(opts: {
  scenarios?: string[];
  slice?: string;
  category?: string;
  limit?: number;
  /** Keep only the first N seed variants of every selected scenario. */
  variants?: number;
  out?: string;
  seeds?: number[];
  pulseLimit?: number;
  /** `true` always runs the drama scenarios, `false` never; absent runs them on a full run only. */
  drama?: boolean;
} = {}): Promise<BehaviorReport> {
  const seeds = opts.seeds && opts.seeds.length > 0 ? opts.seeds : [];
  const expanded = expandVariants(selectScenarios(opts), 7);
  const capped = opts.variants && opts.variants > 0
    ? expanded.filter((s) => variantIndex(s.id) < opts.variants!)
    : expanded;
  const limited = opts.limit && opts.limit > 0 ? capped.slice(0, opts.limit) : capped;

  const report: BehaviorReport = {
    version: "behavior-report-v1",
    generatedAt: new Date().toISOString(),
    seeds,
    ...(opts.pulseLimit !== undefined ? { pulseLimit: opts.pulseLimit } : {}),
    scenariosRun: 0,
    scenariosFailed: 0,
    signalPassRate: 0,
    signalsSkipped: 0,
    probePassRate: 0,
    probeAverages: {},
    byCategory: {},
    signalsByKind: {},
    perScenario: [],
  };

  const probeAgg: Record<string, { sum: number; count: number; passed: number }> = {};
  const catAgg: Record<string, { runs: number; signalsPassed: number; signalsTotal: number }> = {};
  const signalKindResults: SignalOutcome[] = [];
  let signalsPassed = 0;
  let signalsTotal = 0;
  let probesPassed = 0;
  let probesTotal = 0;
  const runSeeds: Array<number | undefined> = seeds.length > 0 ? seeds : [undefined];

  for (const scenario of limited) for (const seed of runSeeds) {
    try {
      const artifact: ScenarioRunArtifact = await ScenarioRunner.run(scenario, {
        llmMode: "mock",
        ...(seed !== undefined ? { seed } : {}),
        ...(opts.pulseLimit !== undefined ? { pulseLimit: opts.pulseLimit } : {}),
      });
      report.scenariosRun++;
      report.signalsSkipped += artifact.skippedSignals ?? 0;
      signalsPassed += artifact.passedSignals;
      signalsTotal += artifact.totalSignals;
      signalKindResults.push(...artifact.signalResults);
      const probePasses = artifact.probeResults.filter(p => p.passed).length;
      probesPassed += probePasses;
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
        probePasses,
        probeTotal: artifact.probeResults.length,
        ...(seed !== undefined ? { seed } : {}),
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
        ...(seed !== undefined ? { seed } : {}),
        failed: err instanceof Error ? err.message : String(err),
      });
    }
  }

  report.signalPassRate = signalsTotal > 0 ? signalsPassed / signalsTotal : 0;
  report.signalsByKind = aggregateSignalsByKind(signalKindResults);
  report.probePassRate = probesTotal > 0 ? probesPassed / probesTotal : 0;
  report.probeAverages = Object.fromEntries(
    Object.entries(probeAgg).map(([id, a]) => [id, { mean: a.sum / a.count, passedPct: a.passed / a.count }]),
  );
  report.byCategory = Object.fromEntries(
    Object.entries(catAgg).map(([cat, a]) => [cat, {
      runs: a.runs,
      signalPassRate: a.signalsTotal > 0 ? a.signalsPassed / a.signalsTotal : 0,
    }]),
  );

  const narrowed = (opts.scenarios?.length ?? 0) > 0 || opts.slice !== undefined || opts.category !== undefined || (opts.limit ?? 0) > 0;
  if (opts.drama === true || (opts.drama !== false && !narrowed)) report.drama = await runDramaBench();

  if (opts.out) {
    const outPath = resolve(opts.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  }
  return report;
}

function printReport(report: BehaviorReport): void {
  console.log("\n=== Perfectman behavior tests ===");
  console.log(`scenarios: ${report.scenariosRun} run, ${report.scenariosFailed} failed`);
  console.log(`signal pass rate: ${(report.signalPassRate * 100).toFixed(1)}%${report.signalsSkipped > 0 ? ` (${report.signalsSkipped} liveOnly signal(s) skipped)` : ""}`);
  console.log(`probe pass rate: ${(report.probePassRate * 100).toFixed(1)}%`);
  if (report.drama) {
    const d = report.drama;
    console.log(`drama scenarios: ${d.scenariosRun} run, ${d.scenariosFailed} failed, ${d.checksRun - d.checksFailed}/${d.checksRun} checks`);
    for (const e of d.perScenario.filter((x) => !x.passed)) {
      console.log(`  FAIL ${e.id}${e.failed ? `: ${e.failed}` : ""}${e.probesFailed.length ? ` probes ${e.probesFailed.join(", ")}` : ""}`);
      for (const c of e.checks.filter((x) => !x.ok)) console.log(`    - ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
    }
  }
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
  const report = await runBehavior({
    scenarios: args.includes("--scenarios") ? (argValue("--scenarios") ?? "").split(",").filter(Boolean) : undefined,
    slice: args.includes("--slice") ? (argValue("--slice") ?? "") : undefined,
    category: argValue("--category"),
    limit: argValue("--limit") ? Number(argValue("--limit")) : undefined,
    variants: argValue("--variants") ? Number(argValue("--variants")) : undefined,
    out: argValue("--out"),
    seeds: argValue("--seeds") ? (argValue("--seeds") ?? "").split(",").map(Number).filter(n => Number.isFinite(n)) : undefined,
    pulseLimit: argValue("--pulse-limit") ? Number(argValue("--pulse-limit")) : undefined,
    ...(args.includes("--no-drama") ? { drama: false } : args.includes("--drama") ? { drama: true } : {}),
  });
  printReport(report);
}

if (process.argv[1]?.endsWith("behavior.js") || process.argv[1]?.endsWith("behavior.ts")) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
