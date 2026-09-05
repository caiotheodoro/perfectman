/**
 * Repetition-guard sweep — thresholds x retry budgets over a fixed
 * scenario slice, fully offline (persona-aware mock generation + rule
 * judge). Produces the per-cell evidence (guard-block rate,
 * content-repetition probe, rule-judge narrative_cohesion, LLM call
 * totals) that the shipped 0.7/one-retry defaults were missing.
 *
 * The content-repetition yardstick is always measured at the probe's
 * fixed threshold (`probeThreshold` in the report), never at the cell's
 * runtime threshold: `runAllProbes` has no knob, and if the yardstick
 * moved with the cell it could not separate "model repeated less" from
 * "guard classified it as a non-repeat".
 *
 * Usage:
 *   pnpm --filter @perfectman/eval sweep:repetition --out out/repetition-sweep.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ScenarioRunner } from "../run/scenario-runner.js";
import { ruleJudge } from "../judge/judge.js";
import { getScenario } from "@perfectman/shared";
import { REPETITION_GUARD_MARKER, REPETITION_SIMILARITY_THRESHOLD } from "@perfectman/server";

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const THRESHOLDS = [0.5, 0.7, 0.9];
const RETRY_COUNTS = [0, 1, 2];
const SCENARIOS = ["motive_gossip", "v1_biased_memory", "stagnation_resentment_loop"];

type Cell = {
  threshold: number;
  maxRetries: number;
  runs: number;
  guardBlocks: number;
  llmCalls: number;
  providerCalls: number;
  contentRepetitionMean: number;
  narrativeCohesionMean: number;
};

/**
 * Guard blocks are their own event type now, so this is a plain count rather
 * than a motive-string match. The marker match is kept as a fallback so runs
 * recorded before the split still measure correctly.
 */
function countGuardBlocks(events: { type: string; payload: Record<string, unknown> }[]): number {
  return events.filter(
    e =>
      e.type === "repetition_blocked" ||
      (e.type === "no_op_recorded" &&
        typeof e.payload["privateMotiveSummary"] === "string" &&
        (e.payload["privateMotiveSummary"] as string).includes(REPETITION_GUARD_MARKER)),
  ).length;
}

export async function main(): Promise<void> {
  const scenarios = SCENARIOS.map(id => {
    const scenario = getScenario(id);
    if (!scenario) throw new Error(`Unknown scenario "${id}" in sweep SCENARIOS`);
    return scenario;
  });

  const grid: Cell[] = [];
  for (const threshold of THRESHOLDS) {
    for (const maxRetries of RETRY_COUNTS) {
      const cell: Cell = {
        threshold,
        maxRetries,
        runs: 0,
        guardBlocks: 0,
        llmCalls: 0,
        providerCalls: 0,
        contentRepetitionMean: 0,
        narrativeCohesionMean: 0,
      };
      let cohesionSum = 0;
      let cohesionCount = 0;
      let repetitionSum = 0;

      for (const scenario of scenarios) {
        const artifact = await ScenarioRunner.run(scenario, {
          llmMode: "mock",
          repetition: { threshold, maxRetries },
        });
        cell.runs++;
        cell.guardBlocks += countGuardBlocks(artifact.events);
        for (const calls of artifact.llmCalls.values()) cell.llmCalls += calls;
        cell.providerCalls += artifact.providerCalls ?? 0;

        const repetitionProbe = artifact.probeResults.find(p => p.probe === "content-repetition");
        if (repetitionProbe) repetitionSum += repetitionProbe.measured;

        const scores = ruleJudge(
          scenario,
          artifact.events,
          artifact.probeResults,
          artifact.passedSignals / Math.max(1, artifact.totalSignals),
        );
        if (typeof scores["narrative_cohesion"] === "number") {
          cohesionSum += scores["narrative_cohesion"]!;
          cohesionCount++;
        }
      }

      cell.contentRepetitionMean =
        Math.round((repetitionSum / Math.max(1, cell.runs)) * 1000) / 1000;
      cell.narrativeCohesionMean =
        Math.round((cohesionSum / Math.max(1, cohesionCount)) * 1000) / 1000;
      grid.push(cell);
      console.log(
        `threshold=${threshold} retries=${maxRetries} | guardBlocks=${cell.guardBlocks} ` +
          `turnCalls=${cell.llmCalls} wireCalls=${cell.providerCalls} ` +
          `contentRepetition=${cell.contentRepetitionMean} ` +
          `narrativeCohesion=${cell.narrativeCohesionMean}`,
      );
    }
  }

  const report = {
    version: "repetition-sweep-v1" as const,
    mode: "mock" as const,
    probeThreshold: REPETITION_SIMILARITY_THRESHOLD,
    scenarios: SCENARIOS,
    limitations:
      "Threshold cells are indistinguishable by construction: mock repeats sit at ≈1.0 Jaccard, so any threshold ≥0.5 catches them all and only providerCalls/guardBlocks vary across that axis. This sweep cannot surface the catchphrase false-positive concern (issue #35) — that needs a probe whose transcripts contain near-miss content.",
    grid,
  };
  const outIndex = args.indexOf("--out");
  if (outIndex >= 0) {
    const out = args[outIndex + 1];
    if (!out || out.startsWith("--")) {
      throw new Error("--out requires a file path");
    }
    const outPath = resolve(out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");
  }
}

if (
  process.argv[1]?.endsWith("sweep-repetition.js") ||
  process.argv[1]?.endsWith("sweep-repetition.ts")
) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
