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
import { ruleJudge, llmJudge, type LlmJudgeConfig } from "../judge/judge.js";
import { calibrateJudge } from "../judge/calibration.js";
import { GOLDEN_LABELS } from "../judge/golden-labels.js";
import { getScenario } from "@perfectman/shared";

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function judgeConfig(): LlmJudgeConfig {
  const provider = process.env.PERFECTMAN_LLM_PROVIDER ?? "local";
  const isDeepseek = provider === "deepseek";
  const tempRaw = process.env.PERFECTMAN_JUDGE_TEMPERATURE;
  // Calibration is an agreement measurement — determinism by default.
  const temperature = tempRaw !== undefined && Number.isFinite(Number(tempRaw)) ? Number(tempRaw) : 0;
  return {
    baseUrl:
      process.env.PERFECTMAN_LLM_BASE_URL ??
      (isDeepseek ? "https://api.deepseek.com/v1" : "http://localhost:11434/v1"),
    model: process.env.PERFECTMAN_JUDGE_MODEL ?? process.env.PERFECTMAN_LLM_MODEL ?? (isDeepseek ? "deepseek-chat" : "qwen3:8b"),
    apiKey: process.env.PERFECTMAN_LLM_API_KEY,
    temperature,
    timeoutMs: 90000,
  };
}

export async function main(): Promise<void> {
  const judgeMode = (argValue("--judge") as "rule" | "llm") ?? "rule";
  const out = argValue("--out");

  const judgeScores = new Map<string, import("../judge/judge.js").AxisScores>();
  const perScenario: Array<{ id: string; pulses: number; axes: Record<string, number> }> = [];

  for (const label of GOLDEN_LABELS) {
    const scenario = getScenario(label.scenarioId);
    if (!scenario) {
      console.error(`golden scenario not in registry: ${label.scenarioId}`);
      process.exit(2);
    }
    // Full length by construction: ScenarioRunner honors the scenario's own
    // pulse count unless a pulseLimit override is passed — none is here.
    const artifact = await ScenarioRunner.run(scenario, { llmMode: "mock" });
    const scores =
      judgeMode === "llm"
        ? await llmJudge(scenario, artifact.events, judgeConfig())
        : ruleJudge(
            scenario,
            artifact.events,
            artifact.probeResults,
            artifact.passedSignals / Math.max(1, artifact.totalSignals),
          );
    judgeScores.set(label.scenarioId, scores);
    perScenario.push({
      id: scenario.id,
      pulses: artifact.pulseResults,
      axes: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, v])),
    });
    console.log(`scored ${scenario.id} (${artifact.pulseResults} pulses)`);
  }

  const report = {
    version: "calibration-report-v1" as const,
    mode: judgeMode === "llm" ? ("local" as const) : ("mock" as const),
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
  console.log(`\n=== Calibration (${report.mode}, full-length transcripts) ===`);
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
