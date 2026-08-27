import { describe, expect, it } from "vitest";
import type { GoalLayerConfig } from "@perfectman/shared";
import { GoalScenarioRunner } from "../goal-scenario-runner.js";
import { getGoalRecipe } from "../scenario-recipes.js";

const RUNNER = new GoalScenarioRunner();
const RESOLVE_GOAL = "crystal-ana-resolve-general";

function dense(): GoalLayerConfig {
  return { enabled: true, reviewEveryPulses: 1 };
}

describe("goal-scenario-runner", () => {
  it("runs the healthy-achiever arc: crystallizes + accepts the resolve goal, samples the gap per review, and terminates reached", async () => {
    const recipe = getGoalRecipe("healthy-achiever");
    const result = await RUNNER.run(recipe, dense());

    const resolve = result.trajectories.find((t) => t.goalId === RESOLVE_GOAL);
    expect(resolve).toBeDefined();
    expect(resolve!.proposed).toBe(true);
    expect(resolve!.accepted).toBe(true);
    // One delusion_gap_sampled row per review the goal was active for
    // (acceptance at review 2, reached flip at review 3).
    expect(resolve!.gapSamples.length).toBeGreaterThanOrEqual(2);
    expect(resolve!.termination).toBe("reached");

    const offered = result.events.find((e) => e.type === "ending_offered")!;
    const reasons = offered.payload["offer"] as { reasons: string[] };
    expect(reasons.reasons).toContain("world verdict: reached");

    const stopped = result.events.find((e) => e.type === "simulation_stopped")!;
    expect(stopped.payload["endReason"]).toBe("goal_end_offered");

    expect(result.pulsesRun).toBeLessThanOrEqual(result.pulseCap);
    expect(result.capped).toBe(false);
    expect(result.providerCalls).toBe(0);
    expect(result.llmCalls).toBe(0);
    expect(result.goalCalls).toBe(0);
  });

  it("samples at review cadence: reviewEveryPulses=1 yields more gap rows than 10 on the deluded arc", async () => {
    const recipe = getGoalRecipe("deluded-achiever");
    const denseRun = await RUNNER.run(recipe, dense());
    const sparseRun = await RUNNER.run(recipe, { enabled: true, reviewEveryPulses: 10 });

    const denseResolve = denseRun.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!;
    const sparseResolve = sparseRun.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!;
    expect(denseResolve.gapSamples.length).toBeGreaterThan(sparseResolve.gapSamples.length * 3);
    // Both runs stay bounded by the pulse cap.
    expect(denseRun.pulsesRun).toBe(denseRun.pulseCap);
    expect(sparseRun.pulsesRun).toBe(sparseRun.pulseCap);
    expect(denseResolve.termination).toBe("pulse-cap-stop");
    expect(sparseResolve.termination).toBe("pulse-cap-stop");
  });

  it("applies a delusionWeightsByAgent override: the weighted cell produces distinct gap magnitudes", async () => {
    const recipe = getGoalRecipe("healthy-achiever");
    const baseline = await RUNNER.run(recipe, dense());
    const weighted = await RUNNER.run(recipe, {
      enabled: true,
      reviewEveryPulses: 1,
      delusionWeightsByAgent: {
        ana: { wSignal: 1, wSocial: 0, wIdentity: 0, revisionThreshold: 0.5 },
        bruno: { wSignal: 1, wSocial: 0, wIdentity: 0, revisionThreshold: 0.5 },
        carla: { wSignal: 1, wSocial: 0, wIdentity: 0, revisionThreshold: 0.5 },
        diego: { wSignal: 1, wSocial: 0, wIdentity: 0, revisionThreshold: 0.5 },
      },
    });

    const a = baseline.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!.gapSamples[0]!.magnitude;
    const b = weighted.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!.gapSamples[0]!.magnitude;
    expect(b).not.toBeCloseTo(a, 5);
  });

  it("delays termination when offerAcceptPulses > 0 and still terminates reached", async () => {
    const recipe = getGoalRecipe("healthy-achiever");
    const immediate = await RUNNER.run(recipe, dense());
    const delayed = await RUNNER.run(recipe, {
      enabled: true,
      reviewEveryPulses: 1,
      ending: { offerAcceptPulses: 2 },
    });

    expect(delayed.pulsesRun).toBeGreaterThan(immediate.pulsesRun);
    expect(delayed.capped).toBe(false);
    const resolve = delayed.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!;
    expect(resolve.termination).toBe("reached");
  });

  it("rejects an override with an incomplete DelusionWeights set", async () => {
    const recipe = getGoalRecipe("healthy-achiever");
    // Runtime-parsed fixture: JSON.parse returns any, so the shape type-
    // checks while carrying an incomplete weight set — the schema validation
    // inside the runner is the rejection point.
    const incomplete = JSON.parse(`{"ana": {"wSignal": 0.5}}`);
    await expect(
      RUNNER.run(recipe, {
        enabled: true,
        reviewEveryPulses: 1,
        delusionWeightsByAgent: incomplete,
      }),
    ).rejects.toThrow();
  });

  it("records re_goal/continue end conditions through the wrapped evaluator", async () => {
    const recipe = getGoalRecipe("contested-consensus");
    const result = await RUNNER.run(recipe, dense());

    const resolveRecords = result.endConditionLog.filter((r) => r.goalId === RESOLVE_GOAL);
    expect(resolveRecords.length).toBeGreaterThanOrEqual(3);
    for (const r of resolveRecords) {
      expect(["re_goal", "continue"]).toContain(r.kind);
    }
    // Every record carries the review pulse it was decided at.
    for (const r of resolveRecords) {
      expect(r.pulseIndex).toBeGreaterThan(0);
    }
  });
});