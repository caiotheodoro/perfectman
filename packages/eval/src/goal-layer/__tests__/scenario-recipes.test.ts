import { describe, expect, it } from "vitest";
import type { WorldVerdict } from "@perfectman/shared";
import { GoalScenarioRunner } from "../goal-scenario-runner.js";
import { getGoalRecipe } from "../scenario-recipes.js";

const RUNNER = new GoalScenarioRunner();
const RESOLVE_GOAL = "crystal-ana-resolve-general";

function verdictsOf(events: { type: string; payload: Record<string, unknown> }[], goalId: string): WorldVerdict[] {
  return events
    .filter((e) => e.type === "world_verdict" && e.payload["goalId"] === goalId)
    .map((e) => e.payload["verdict"] as WorldVerdict);
}

async function capped(recipeId: "deluded-achiever" | "premature-closer" | "contested-consensus" | "hollow-completion") {
  return RUNNER.run(getGoalRecipe(recipeId), { enabled: true, reviewEveryPulses: 1 });
}

describe("goal scenario recipes", () => {
  it("healthy-achiever: ended via a reached-based offer on the low-gap arc", async () => {
    const result = await RUNNER.run(getGoalRecipe("healthy-achiever"), {
      enabled: true,
      reviewEveryPulses: 1,
    });
    const resolve = result.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!;
    expect(resolve.termination).toBe("reached");
    // Uncontested, near-zero log divergence: every gap sample is low.
    for (const sample of resolve.gapSamples) {
      expect(sample.magnitude).toBeLessThan(0.33);
    }
    expect(result.events.some((e) => e.type === "ending_offered")).toBe(true);
    expect(result.capped).toBe(false);
  });

  it("deluded-achiever (G5): re_goal on every review to the pulse cap, zero end offers, full claim-vs-world divergence", async () => {
    const result = await capped("deluded-achiever");
    const resolve = result.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!;

    expect(result.events.some((e) => e.type === "ending_offered")).toBe(false);
    expect(result.capped).toBe(true);
    expect(resolve.termination).toBe("pulse-cap-stop");

    const resolveRecords = result.endConditionLog.filter((r) => r.goalId === RESOLVE_GOAL);
    expect(resolveRecords.length).toBeGreaterThanOrEqual(6);
    for (const r of resolveRecords) {
      expect(r.kind).toBe("re_goal");
    }
    for (const sample of resolve.gapSamples) {
      expect(sample.divergenceFromWorld).toBe(1);
      expect(sample.magnitude).toBeGreaterThanOrEqual(0.4);
    }
    expect(verdictsOf(result.events, RESOLVE_GOAL).every((v) => v.determination === "not_reached")).toBe(true);
  });

  it("premature-closer: public claim + challenge/ridicule → not_reached determination, mid-high gap, never terminates", async () => {
    const result = await capped("premature-closer");
    const resolve = result.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!;

    expect(result.capped).toBe(true);
    expect(result.events.some((e) => e.type === "ending_offered")).toBe(false);
    for (const sample of resolve.gapSamples) {
      expect(sample.divergenceFromWorld).toBe(1);
      // wSocial 1.0 + wIdentity felt-boost carry the gap past 0.5 on every
      // post-challenge sample.
      expect(sample.magnitude).toBeGreaterThanOrEqual(0.5);
    }
    const resolveRecords = result.endConditionLog.filter((r) => r.goalId === RESOLVE_GOAL);
    for (const r of resolveRecords) {
      expect(r.kind).toBe("re_goal");
    }
  });

  it("contested-consensus: mixed in-group defer vs collective challenge → contested verdicts, wSocial 0.5, continue to the cap", async () => {
    const result = await capped("contested-consensus");
    const resolve = result.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!;

    expect(result.capped).toBe(true);
    for (const v of verdictsOf(result.events, RESOLVE_GOAL)) {
      expect(v.determination).toBe("contested");
    }
    for (const sample of resolve.gapSamples) {
      // claim reached vs contested world → wSocial channel split
      expect(sample.divergenceFromWorld).toBe(0.5);
    }
    const resolveRecords = result.endConditionLog.filter((r) => r.goalId === RESOLVE_GOAL);
    expect(resolveRecords.length).toBeGreaterThanOrEqual(3);
    for (const r of resolveRecords) {
      expect(r.kind).toBe("continue");
    }
  });

  it("hollow-completion: world reached but meaning never made → hollow re-goals, zero end offers", async () => {
    const result = await capped("hollow-completion");
    const resolve = result.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!;

    expect(result.capped).toBe(true);
    expect(result.events.some((e) => e.type === "ending_offered")).toBe(false);
    const resolveRecords = result.endConditionLog.filter((r) => r.goalId === RESOLVE_GOAL);
    expect(resolveRecords.length).toBeGreaterThanOrEqual(3);
    for (const r of resolveRecords) {
      expect(r.kind).toBe("re_goal");
      expect(r.reason).toContain("hollow completion re-goals");
    }
  });

  it("world-briefly-wrong: ratified-consensus window while the objective is unmet spikes the trajectory, then settles into reached", async () => {
    const result = await RUNNER.run(getGoalRecipe("world-briefly-wrong"), {
      enabled: true,
      reviewEveryPulses: 1,
    });
    const resolve = result.trajectories.find((t) => t.goalId === RESOLVE_GOAL)!;

    const determinations = verdictsOf(result.events, RESOLVE_GOAL).map((v) => v.determination);
    expect(determinations).toContain("contested");
    expect(determinations[determinations.length - 1]).toBe("reached");

    expect(resolve.termination).toBe("reached");
    expect(result.capped).toBe(false);
    expect(result.events.some((e) => e.type === "ending_offered")).toBe(true);

    // Spike-then-settle: the contested-window sample (review 3 of the
    // not_reached → contested → reached arc) out-magnitudes the final one.
    const contested = resolve.gapSamples[1]!;
    const last = resolve.gapSamples[resolve.gapSamples.length - 1]!;
    expect(contested.magnitude).toBeGreaterThan(last.magnitude);
  });
});