/**
 * Goal-layer calibration sweep — the six scenario recipes across the RD-4
 * matrix (scaffold defaults / reviewEveryPulses=1 / adjusted weights, plus
 * two offerAcceptPulses probes on the healthy arc) with the per-cell
 * trajectories the calibration record is written from. Zero wire calls by
 * construction: no-op agents + deterministic or canned goal legs.
 *
 * Usage:
 *   pnpm --filter @perfectman/eval sweep:goal-layer --out out/goal-layer-sweep.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DelusionWeights, GoalLayerConfig } from "@perfectman/shared";
import { GoalScenarioRunner, type GoalTrajectory } from "../goal-layer/goal-scenario-runner.js";
import {
  GOAL_SCENARIO_IDS,
  allGoalRecipes,
  getGoalRecipe,
  type GoalScenarioId,
} from "../goal-layer/scenario-recipes.js";

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

const PULSE_CAP = 120;
const RESOLVE_GOAL = "crystal-ana-resolve-general";

/** Sensitivity probe distinct from the scaffold 0.4/0.4/0.2 default. */
const ADJUSTED_WEIGHTS: DelusionWeights = {
  wSignal: 0.6,
  wSocial: 0.3,
  wIdentity: 0.1,
  revisionThreshold: 0.5,
};

function adjustedWeightsByAgent(): Record<string, DelusionWeights> {
  return Object.fromEntries(
    ["ana", "bruno", "carla", "diego"].map((id) => [id, ADJUSTED_WEIGHTS]),
  );
}

type CellSpec = {
  scenario: GoalScenarioId;
  label: string;
  overrides: GoalLayerConfig;
};

function buildCells(): CellSpec[] {
  const scenarios = allGoalRecipes();
  const cells: CellSpec[] = [];
  for (const recipe of scenarios) {
    cells.push({ scenario: recipe.id, label: "defaults", overrides: { enabled: true } });
  }
  for (const recipe of scenarios) {
    cells.push({
      scenario: recipe.id,
      label: "reviewEveryPulses=1",
      overrides: { enabled: true, reviewEveryPulses: 1 },
    });
  }
  for (const recipe of scenarios) {
    cells.push({
      scenario: recipe.id,
      label: "adjusted-weights",
      overrides: { enabled: true, delusionWeightsByAgent: adjustedWeightsByAgent() },
    });
  }
  for (const offerAcceptPulses of [2, 8]) {
    cells.push({
      scenario: "healthy-achiever",
      label: `offerAcceptPulses=${offerAcceptPulses}`,
      overrides: {
        enabled: true,
        reviewEveryPulses: 1,
        ending: { offerAcceptPulses },
      },
    });
  }
  // Issue #106: the meaning-made gate's dedicated grid — 5 ceilings × the 3
  // gate-relevant arcs × 2 cadences. 0.33 is the scaffold default the sweep
  // must re-justify (ADR-0011 D-28); 0.326 is the healthy arc's closest
  // approach at cadence 1, so 0.30/0.25 probe false-reject and 0.36/0.40
  // probe false-accept against the contested window (0.376).
  const MEANING_MADE_CEILINGS = [0.25, 0.3, 0.33, 0.36, 0.4];
  const MEANING_MADE_ARCS: GoalScenarioId[] = [
    "healthy-achiever",
    "world-briefly-wrong",
    "hollow-completion",
  ];
  for (const ceiling of MEANING_MADE_CEILINGS) {
    for (const arc of MEANING_MADE_ARCS) {
      for (const reviewEveryPulses of [1, 10]) {
        cells.push({
          scenario: arc,
          label: `meaningMade=${ceiling}@cadence${reviewEveryPulses}`,
          overrides: {
            enabled: true,
            reviewEveryPulses,
            ending: { meaningMadeMaxDivergence: ceiling },
          },
        });
      }
    }
  }
  return cells;
}

type GridCell = {
  scenario: GoalScenarioId;
  cell: string;
  mode: "deterministic" | "llm";
  reviewEveryPulses: number;
  offerAcceptPulses: number;
  weights: "default" | "adjusted";
  goalsProposed: number;
  goalsAccepted: number;
  goalsDeclined: number;
  gapRows: number;
  termination: string | null;
  pulsesRun: number;
  capped: boolean;
  providerCalls: number;
  llmCalls: number;
  goalCalls: number;
  /** Non-resolve trajectories excluded from `trajectories` below (witnessed-event legacy proposals on the four non-terminating arcs; organic-signal goals on the terminating deterministic cells). */
  witnessedLegacyTrajectories: number;
  witnessedLegacyGapRows: number;
  trajectories: GoalTrajectory[];
};

const FULL_TRAJECTORIES = args.includes("--full-trajectories");

export async function main(): Promise<void> {
  const runner = new GoalScenarioRunner();
  const grid: GridCell[] = [];

  for (const spec of buildCells()) {
    const result = await runner.run(getGoalRecipe(spec.scenario), spec.overrides, {
      pulseCap: PULSE_CAP,
    });

    const goalsProposed = result.trajectories.filter((t) => t.proposed).length;
    const goalsAccepted = result.trajectories.filter((t) => t.accepted).length;
    const goalsDeclined = result.trajectories.filter((t) => t.declined).length;
    const gapRows = result.trajectories.reduce(
      (sum, t) => sum + t.gapSamples.length,
      0,
    );
    // The resolve goal is the recipe's primary arc; the run-level label
    // separates offer terminations from cap stops. The excluded trajectories
    // are witnessed-event legacy proposals on the four non-terminating arcs
    // (nextGoalAvailable) and organic-signal goals on the terminating
    // deterministic cells; the committed report carries the primary
    // trajectory and transparent counts for the excluded rows
    // (--full-trajectories restores them all).
    const primary = result.trajectories.find((t) => t.goalId === RESOLVE_GOAL);
    const witnessed = result.trajectories.filter((t) => t.goalId !== RESOLVE_GOAL);
    const termination = primary?.termination ?? null;
    const trajectories = FULL_TRAJECTORIES
      ? result.trajectories
      : primary
        ? [primary]
        : [];

    grid.push({
      scenario: spec.scenario,
      cell: spec.label,
      mode: result.mode,
      reviewEveryPulses: result.config.reviewEveryPulses,
      offerAcceptPulses: result.config.ending.offerAcceptPulses,
      weights: spec.label === "adjusted-weights" ? "adjusted" : "default",
      goalsProposed,
      goalsAccepted,
      goalsDeclined,
      gapRows,
      termination,
      pulsesRun: result.pulsesRun,
      capped: result.capped,
      providerCalls: result.providerCalls,
      llmCalls: result.llmCalls,
      goalCalls: result.goalCalls,
      witnessedLegacyTrajectories: witnessed.length,
      witnessedLegacyGapRows: witnessed.reduce(
        (sum, t) => sum + t.gapSamples.length,
        0,
      ),
      trajectories,
    });
    console.log(
      `${spec.scenario} ${spec.label} | pulses=${result.pulsesRun} ` +
        `capped=${result.capped} termination=${termination ?? "none"} ` +
        `goals=${goalsProposed}/${goalsAccepted}/${goalsDeclined} gapRows=${gapRows}`,
    );
  }

  const report = {
    version: "goal-layer-sweep-v1" as const,
    mode: "mock" as const,
    pulseCap: PULSE_CAP,
    scenarios: GOAL_SCENARIO_IDS,
    limitations:
      "Trajectories sample at review cadence (reviewEveryPulses), not per pulse; pulse 0 is review-exempt. " +
      "Crystallizer minima (2 blocked / 3 gaze) are engine module-locals with no per-run config path — measured at scaffold values only, never swept. " +
      "revisionThreshold (0.5) is carried in the engine's default weights but consumed nowhere in runtime code — recorded as a measured no-op (RD-5). " +
      "Self-claims are canned (deterministic in_progress or the reached-claim client), so arcs exercise the goal-layer machinery, not model behavior. " +
      "Per-cell trajectories list the recipe's resolve goal (the calibration signal). Excluded from trajectories and counted in " +
      "witnessedLegacyTrajectories/GapRows are the per-review witnessed-event legacy proposals on the four non-terminating arcs " +
      "(they keep nextGoalAvailable true) and, on the terminating deterministic cells (healthy-achiever, world-briefly-wrong), " +
      "organic-signal goals crystallized from ambient chatter — no witness event is injected there " +
      "(rerun with --full-trajectories for the unfiltered report).",
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
  process.argv[1]?.endsWith("sweep-goal-layer.js") ||
  process.argv[1]?.endsWith("sweep-goal-layer.ts")
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}