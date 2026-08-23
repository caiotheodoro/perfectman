/**
 * Judge calibration CLI — measures judge-vs-golden agreement the way the
 * golden labels were authored: each golden-labeled scenario played out at
 * its FULL pulse count, no variant rotation, no truncation. This removes
 * the pulseLimit=8 confound that poisoned earlier calibration runs and,
 * with it, any excuse for comparing truncated transcripts against
 * full-scene expectations.
 *
 * Usage:
 *   pnpm --filter @perfectman/eval calibrate --judge rule --out out/calibration.json
 *   pnpm --filter @perfectman/eval calibrate --judge llm   (needs model servers)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ScenarioRunner } from "../run/scenario-runner.js";
import { ruleJudge, llmJudge } from "../judge/judge.js";
import { MockJudgeProvider } from "../judge/mock-judge-provider.js";
import { calibrateJudge } from "../judge/calibration.js";
import { GOLDEN_LABELS } from "../judge/golden-labels.js";
import { loadJudgeConfig, applyJudgeShorthand } from "../llm/judge-config.js";
import { getScenario } from "@perfectman/shared";

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(): Promise<void> {
  const judgeFlag = argValue("--judge");
  if (judgeFlag !== undefined && judgeFlag !== "rule" && judgeFlag !== "llm") {
    console.error(`unknown --judge value: ${judgeFlag} (expected rule|llm)`);
    process.exit(2);
  }
  const out = argValue("--out");

  // Calibration is an agreement measurement — determinism by default
  // (temperature 0 rather than bench's heuristic 1.0).
  const resolvedJudge = await loadJudgeConfig(args, { defaultTemperature: 0 });
  const providerType = applyJudgeShorthand(resolvedJudge, judgeFlag);
  const mockJudge = new MockJudgeProvider();

  const judgeScores = new Map<string, import("../judge/judge.js").AxisScores>();
  const perScenario: Array<{ id: string; pulses: number; axes: Record<string, number>; judgeSalvaged: boolean }> = [];

  for (const label of GOLDEN_LABELS) {
    const scenario = getScenario(label.scenarioId);
    if (!scenario) {
      console.error(`golden scenario not in registry: ${label.scenarioId}`);
      process.exit(2);
    }
    // Full length by construction: ScenarioRunner honors the scenario's own
    // pulse count unless a pulseLimit override is passed — none is here.
    const artifact = await ScenarioRunner.run(scenario, { llmMode: "mock" });
    const judgeResult =
      providerType === "openai-compatible"
        ? await llmJudge(scenario, artifact.events, resolvedJudge.config)
        : providerType === "mock"
          ? mockJudge.judge(scenario)
          : {
              axes: ruleJudge(
                scenario,
                artifact.events,
                artifact.probeResults,
                artifact.passedSignals / Math.max(1, artifact.totalSignals),
              ),
              salvaged: false,
            };
    const scores = judgeResult.axes;
    // A salvaged score is a fabricated/imputed read, not a clean parse — the
    // calibration gate this CLI measures must never be fed invented scores.
    if (!judgeResult.salvaged) {
      judgeScores.set(label.scenarioId, scores);
    }
    perScenario.push({
      id: scenario.id,
      pulses: artifact.pulseResults,
      axes: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v])),
      judgeSalvaged: judgeResult.salvaged,
    });
    console.log(`scored ${scenario.id} (${artifact.pulseResults} pulses)${judgeResult.salvaged ? " [salvaged, excluded from calibration]" : ""}`);
  }

  const report = {
    version: "calibration-report-v1" as const,
    // Generation is always the mock provider here; `judge` records what
    // scored the transcripts. Golden labels were authored against the mock
    // baseline, so LLM-judged calibration reads mock transcripts too.
    mode: "mock" as const,
    // The resolved providerType, not the CLI flag: a providerType:"mock"
    // run must not be recorded as a rule judgement in the evidence.
    judge: providerType === "openai-compatible" ? "llm" : providerType === "mock" ? "mock" : "rule",
    generatedAt: new Date().toISOString(),
    transcriptLength: "full",
    calibration: calibrateJudge(judgeScores, GOLDEN_LABELS, 0.7),
    perScenario,
  };

  if (out) {
    const outPath = resolve(out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  }

  const cal = report.calibration;
  console.log(`\n=== Calibration (mock transcripts, ${report.judge} judge, full length) ===`);
  console.log(`kappa ${cal.kappa} (target ${cal.targetKappa}) ${cal.passed ? "PASS" : "FAIL"} | alpha ${cal.alpha} | n=${cal.nScenes}`);
  for (const [axis, k] of Object.entries(cal.perAxisKappa)) {
    console.log(`  ${axis.padEnd(26)} ${k.toFixed(3)}`);
  }
  if (cal.disagreements.length > 0) {
    console.log("disagreements:");
    for (const d of cal.disagreements.slice(0, 10)) console.log(`  - ${d}`);
  }
}

if (process.argv[1]?.endsWith("calibrate.js") || process.argv[1]?.endsWith("calibrate.ts")) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
