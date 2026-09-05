import { describe, it, expect } from "vitest";
import { getScenario } from "@perfectman/shared";
import { ScenarioRunner } from "../run/scenario-runner.js";
import {
  countGuardBlocks,
  sweepScenarios,
} from "../cli/sweep-temperature.js";
import { REPETITION_GUARD_MARKER } from "@perfectman/server";
import { resolveBenchSlice } from "../bench-slices.js";

describe("temperature sweep: scenario resolution", () => {
  it("takes its set from the canary slice rather than a second hardcoded list", () => {
    expect(sweepScenarios().map(s => s.id)).toEqual(resolveBenchSlice("canary"));
  });

  it("aborts on an id that no longer resolves instead of shrinking the grid", () => {
    expect(() => sweepScenarios(["motive_gossip", "renamed_away"])).toThrow(
      /unknown scenario "renamed_away"/,
    );
  });

  it("aborts on an empty set instead of reporting an all-zero grid", () => {
    expect(() => sweepScenarios([])).toThrow(/no scenarios/);
    expect(() => sweepScenarios(undefined)).not.toThrow();
  });
});

/**
 * `guardBlocks` is the sweep's headline metric and its only signal is prose
 * that `ActionIntentStep` writes into a blocked intent's motive. Rewording
 * that sentence would zero the metric with no other symptom, so the marker is
 * asserted against a real pipeline run rather than a synthetic event.
 */
describe("temperature sweep: repetition-guard marker", () => {
  it("counts guard blocks the real pipeline actually emits", async () => {
    const scenario = getScenario("motive_gossip");
    if (!scenario) throw new Error("motive_gossip missing from the scenario registry");
    const artifact = await ScenarioRunner.run(scenario, { llmMode: "mock" });

    const noOpMotives = artifact.events
      .filter(e => e.type === "no_op_recorded" || e.type === "repetition_blocked")
      .map(e => e.payload["privateMotiveSummary"])
      .filter((m): m is string => typeof m === "string");

    // Without no_ops the marker assertion below would be vacuous.
    expect(noOpMotives.length).toBeGreaterThan(0);
    expect(noOpMotives.some(m => m.includes(REPETITION_GUARD_MARKER))).toBe(true);
    expect(countGuardBlocks(artifact.events)).toBeGreaterThan(0);
  });

  it("ignores no_ops whose motive is not a guard block", () => {
    expect(
      countGuardBlocks([
        { type: "no_op_recorded", payload: { privateMotiveSummary: "Chose to stay quiet." } },
        { type: "message_sent", payload: { privateMotiveSummary: "Repetition guard: ..." } },
        { type: "no_op_recorded", payload: {} },
      ]),
    ).toBe(0);
  });
});

describe("temperature sweep: pinned seed", () => {
  it("replays an identical transcript across runs of the same scenario", async () => {
    const scenario = getScenario("motive_gossip");
    if (!scenario) throw new Error("motive_gossip missing from the scenario registry");
    const fingerprint = async (): Promise<string> => {
      const artifact = await ScenarioRunner.run(scenario, { llmMode: "mock" });
      return artifact.events
        .map(e => `${e.type}|${e.actorId ?? ""}|${JSON.stringify(e.payload["visibleContent"] ?? e.payload["emoji"] ?? "")}`)
        .join("\n");
    };

    const first = await fingerprint();
    expect(first.length).toBeGreaterThan(0);
    expect(await fingerprint()).toBe(first);
  });
});
