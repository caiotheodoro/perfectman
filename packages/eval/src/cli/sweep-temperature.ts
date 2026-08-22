/**
 * Generation-temperature sweep — the 0.25 default was never compared
 * against alternatives. Grid over temperatures x the canary scenario set,
 * seed pinned, fully offline (persona-aware mock + rule judge).
 *
 * Honest scoping: the deterministic mock's only temperature sensitivity is
 * its charged-react gate (temperature >= 0.9), so sub-0.9 cells are
 * expected to be identical. The harness exists so live-model sweeps drop
 * straight in.
 *
 * Usage:
 *   pnpm --filter @perfectman/eval sweep:temperature --out out/temperature-sweep.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { PersonaPack } from "@perfectman/shared";
import { getScenario, getPersonaPackById, ALL_PERSONAS } from "@perfectman/shared";
import { ScenarioRunner } from "../run/scenario-runner.js";
import { ruleJudge } from "../judge/judge.js";
import { PersonaAwareMockProvider } from "../bench/persona-aware-mock.js";
import type { LLMProvider } from "@perfectman/server";

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const TEMPERATURES = [0.25, 0.5, 0.7, 1.0];
const SCENARIOS = ["motive_gossip", "v1_exclusion_inferred", "motive_conflict", "stagnation_resentment_loop"];

type Cell = {
  temperature: number;
  runs: number;
  guardBlocks: number;
  contentRepetitionMean: number;
  axisMeans: Record<string, number>;
};

function packsAtTemperature(temperature: number): Map<string, PersonaPack> {
  const packs = new Map<string, PersonaPack>();
  for (const persona of ALL_PERSONAS) {
    const pack = getPersonaPackById(persona.id);
    if (pack) {
      packs.set(persona.id, { ...pack, sampling: { ...pack.sampling, temperature } });
    }
  }
  return packs;
}

function countGuardBlocks(events: readonly { type: string; payload: Record<string, unknown> }[]): number {
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

  for (const temperature of TEMPERATURES) {
    const packs = packsAtTemperature(temperature);
    const cell: Cell = {
      temperature,
      runs: 0,
      guardBlocks: 0,
      contentRepetitionMean: 0,
      axisMeans: {},
    };
    const axisSums: Record<string, { sum: number; count: number }> = {};
    let repetitionSum = 0;

    for (const scenario of scenarios) {
      const artifact = await ScenarioRunner.run(scenario!, {
        llmMode: "mock",
        providerFactory: (llmConfig, agentId): LLMProvider => {
          // Agents without a compiled pack degrade to the generic pack,
          // matching the default factory's behavior.
          const pack =
            packs.get(agentId) ??
            getPersonaPackById("generic") ??
            packs.values().next().value!;
          return new PersonaAwareMockProvider(pack, scenario!.seed);
        },
      });

      cell.runs++;
      cell.guardBlocks += countGuardBlocks(artifact.events);
      const repetitionProbe = artifact.probeResults.find(p => p.probe === "content-repetition");
      if (repetitionProbe) repetitionSum += repetitionProbe.measured;

      const scores = ruleJudge(
        scenario!,
        artifact.events,
        artifact.probeResults,
        artifact.passedSignals / Math.max(1, artifact.totalSignals),
      );
      for (const [axis, value] of Object.entries(scores)) {
        axisSums[axis] ??= { sum: 0, count: 0 };
        axisSums[axis]!.sum += value;
        axisSums[axis]!.count++;
      }
    }

    cell.contentRepetitionMean =
      Math.round((repetitionSum / Math.max(1, cell.runs)) * 1000) / 1000;
    for (const [axis, a] of Object.entries(axisSums)) {
      cell.axisMeans[axis] = Math.round((a.sum / a.count) * 1000) / 1000;
    }
    grid.push(cell);
    console.log(
      `temperature=${temperature} | guardBlocks=${cell.guardBlocks} ` +
        `contentRepetition=${cell.contentRepetitionMean} ` +
        `creativity=${cell.axisMeans["creativity_unhinged"] ?? "-"} ` +
        `cohesion=${cell.axisMeans["narrative_cohesion"] ?? "-"}`,
    );
  }

  const report = {
    version: "temperature-sweep-v1" as const,
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
  process.argv[1]?.endsWith("sweep-temperature.js") ||
  process.argv[1]?.endsWith("sweep-temperature.ts")
) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
