/**
 * Repetition-guard sweep — thresholds x retry budgets over a fixed
 * scenario slice, fully offline (persona-aware mock generation + rule
 * judge). Produces the per-cell evidence (guard-block rate,
 * content-repetition probe, rule-judge narrative_cohesion, LLM call
 * totals) that the shipped 0.7/one-retry defaults were missing.
 *
 * Usage:
 *   pnpm --filter @perfectman/eval sweep:repetition --out out/repetition-sweep.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ScenarioRunner } from "../run/scenario-runner.js";
import { ruleJudge } from "../judge/judge.js";
import { getScenario } from "@perfectman/shared";

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
  contentRepetitionMean: number;
  narrativeCohesionMean: number;
};

function countGuardBlocks(events: { type: string; payload: Record<string, unknown> }[]): number {
  return events.filter(
    e =>
      e.type === "no_op_recorded" &&
      typeof e.payload["privateMotiveSummary"] === "string" &&
      (e.payload["privateMotiveSummary"] as string).includes("Repetition guard"),
  ).length;
}

export async function main(): Promise<void> {
  const scenarios = SCENARIOS.map(id => getScenario(id)).filter(s => s !== undefined);

  const grid: Cell[] = [];
  for (const threshold of THRESHOLDS) {
    for (const maxRetries of RETRY_COUNTS) {
      const cell: Cell = {
        threshold,
        maxRetries,
        runs: 0,
        guardBlocks: 0,
        llmCalls: 0,
        contentRepetitionMean: 0,
        narrativeCohesionMean: 0,
      };
      let cohesionSum = 0;
      let cohesionCount = 0;
      let repetitionSum = 0;

      for (const scenario of scenarios) {
        const artifact = await ScenarioRunner.run(scenario!, {
          llmMode: "mock",
          repetition: { threshold, maxRetries },
        });
        cell.runs++;
        cell.guardBlocks += countGuardBlocks(artifact.events);
        for (const calls of artifact.llmCalls.values()) cell.llmCalls += calls;

        const repetitionProbe = artifact.probeResults.find(p => p.probe === "content-repetition");
        if (repetitionProbe) repetitionSum += repetitionProbe.measured;

        const scores = ruleJudge(
          scenario!,
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
          `llmCalls=${cell.llmCalls} contentRepetition=${cell.contentRepetitionMean} ` +
          `narrativeCohesion=${cell.narrativeCohesionMean}`,
      );
    }
  }

  const report = {
    version: "repetition-sweep-v1" as const,
    mode: "mock" as const,
    generatedAt: new Date().toISOString(),
    scenarios: SCENARIOS,
    grid,
  };
  const out = argValue("--out");
  if (out) {
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
