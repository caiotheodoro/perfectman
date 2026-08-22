/**
 * Generation-temperature sweep — the 0.25 default was never compared
 * against alternatives. Grid over temperatures x the canary slice, fully
 * offline (persona-aware mock + rule judge).
 *
 * Determinism: the mock provider is seeded from `scenario.seed`, so a cell
 * replays the same transcript on every run and the report is byte-identical
 * across runs. `PERFECTMAN_LLM_SEED` cannot perturb it — that env var feeds
 * `benchSeed()` inside `localLLMConfig`, which only the live-model path uses.
 * The report carries no wall-clock field for the same reason: the committed
 * evidence matrix has to diff cleanly against a fresh run.
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
import type { PersonaPack, RoleplayScenario } from "@perfectman/shared";
import { getScenario, getPersonaPackById, ALL_PERSONAS } from "@perfectman/shared";
import { ScenarioRunner } from "../run/scenario-runner.js";
import { ruleJudge } from "../judge/judge.js";
import { personaAwareProviderFactory } from "../bench/persona-aware-mock.js";
import { resolveBenchSlice } from "../bench-slices.js";

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const value = args[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

const TEMPERATURES = [0.25, 0.5, 0.7, 1.0];

/** The slice this sweep runs; `canary` is owned by `bench-slices.ts`. */
const SLICE = "canary";

/**
 * The prefix `ActionIntentStep` stamps on a repetition-guard fallback's
 * `privateMotiveSummary`. `guardBlocks` is the sweep's headline metric and
 * this prose is its only signal, so rewording that sentence upstream would
 * zero the metric with no other symptom — `sweep-temperature.test.ts` pins
 * the marker against a real run so the reword fails loudly instead.
 */
export const REPETITION_GUARD_MOTIVE_MARKER = "Repetition guard";

type Cell = {
  temperature: number;
  runs: number;
  guardBlocks: number;
  contentRepetitionMean: number;
  axisMeans: Record<string, number>;
};

/**
 * Exported for tests: an id that stops resolving must abort the sweep, not
 * quietly shrink the grid's denominator.
 */
export function sweepScenarios(
  ids: readonly string[] | undefined = resolveBenchSlice(SLICE),
): RoleplayScenario[] {
  if (!ids || ids.length === 0) {
    throw new Error(`Slice "${SLICE}" resolved to no scenarios — nothing to sweep`);
  }
  return ids.map(id => {
    const scenario = getScenario(id);
    if (!scenario) throw new Error(`Slice "${SLICE}" references unknown scenario "${id}"`);
    return scenario;
  });
}

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

export function countGuardBlocks(
  events: readonly { type: string; payload: Record<string, unknown> }[],
): number {
  return events.filter(e => {
    if (e.type !== "no_op_recorded") return false;
    const motive = e.payload["privateMotiveSummary"];
    return typeof motive === "string" && motive.includes(REPETITION_GUARD_MOTIVE_MARKER);
  }).length;
}

export async function main(): Promise<void> {
  // Resolved before the grid runs: a malformed --out must not cost 16 runs
  // and then discard them.
  const out = argValue("--out");
  const scenarios = sweepScenarios();
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
    let repetitionRuns = 0;

    for (const scenario of scenarios) {
      const artifact = await ScenarioRunner.run(scenario, {
        llmMode: "mock",
        providerFactory: personaAwareProviderFactory(packs, scenario.seed),
      });

      cell.runs++;
      cell.guardBlocks += countGuardBlocks(artifact.events);
      const repetitionProbe = artifact.probeResults.find(p => p.probe === "content-repetition");
      if (!repetitionProbe) {
        throw new Error(`content-repetition probe missing from ${scenario.id} — the cell mean would read 0`);
      }
      repetitionSum += repetitionProbe.measured;
      repetitionRuns++;

      const scores = ruleJudge(
        scenario,
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

    cell.contentRepetitionMean = Math.round((repetitionSum / repetitionRuns) * 1000) / 1000;
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
    slice: SLICE,
    scenarios: scenarios.map(s => s.id),
    grid,
  };
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
