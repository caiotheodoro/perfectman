import { afterEach, describe, expect, it, vi } from "vitest";
import { GoalScenarioRunner } from "../goal-scenario-runner.js";
import { getGoalRecipe } from "../scenario-recipes.js";

const RUNNER = new GoalScenarioRunner();
const RESOLVE_GOAL = "crystal-ana-resolve-general";

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Determinism contract (T202 precursor): the harness is mock-only, so a
 * run's report must be reproducible from its inputs alone — the same seed
 * events must produce the same trajectories and the same termination,
 * regardless of wall-clock progress. The completion-beat gate derives from
 * event timestamps the recipes leave to the append stamp.
 */
describe("goal-layer run determinism", () => {
  it("terminates reached on the healthy arc even when the wall clock does not advance between append stamps", async () => {
    // Freeze the wall clock: every committed event is stamped with the same
    // millisecond, which is precisely what happens on fast CI/CLI machines
    // when an append batch lands within a single Date.now() tick.
    vi.useFakeTimers({ toFake: ["Date"] });

    const result = await RUNNER.run(getGoalRecipe("healthy-achiever"), {
      enabled: true,
      reviewEveryPulses: 1,
    });

    const resolve = result.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!;
    expect(resolve.termination).toBe("reached");
    expect(result.capped).toBe(false);
  });

  it("produces identical trajectories across repeated runs of the same cell", async () => {
    const recipe = getGoalRecipe("healthy-achiever");
    const overrides = { enabled: true, reviewEveryPulses: 1 } as const;
    const runs = await Promise.all(
      Array.from({ length: 8 }, () => RUNNER.run(recipe, overrides)),
    );
    const signatures = runs.map((r) =>
      JSON.stringify({ trajectories: r.trajectories, pulsesRun: r.pulsesRun, capped: r.capped }),
    );
    expect(new Set(signatures).size).toBe(1);
  });
});