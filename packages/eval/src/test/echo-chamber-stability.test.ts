import { describe, it, expect } from "vitest";
import { ScenarioRunner } from "../run/scenario-runner.js";
import { getScenario } from "@perfectman/shared";

/**
 * Regression guard for the echo-chamber mock degeneracy: a high-affection,
 * zero-tension room used to collapse one persona into an infinite identical-
 * emoji react loop (a dozen 😂 in a row), which read as wildly
 * out-of-character and tanked judged authenticity.
 */
describe("persona-aware mock: echo-chamber stability", () => {
  it("never emits more than two identical consecutive reactions per agent", async () => {
    const scenario = getScenario("stagnation_echo_chamber");
    if (!scenario) throw new Error("scenario missing from registry");
    const artifact = await ScenarioRunner.run(scenario, { llmMode: "mock" });

    const agents = ["caio", "leo", "mariana", "bruno"];
    const maxStreaks: Array<{ agentId: string; maxRun: number }> = [];
    for (const agentId of agents) {
      const emojis = artifact.events
        .filter(e => e.type === "reaction_sent" && e.actorId === agentId)
        .map(e => String((e.payload as Record<string, unknown>)["emoji"] ?? ""));
      let maxRun = 0;
      let run = 0;
      let prev: string | undefined;
      for (const emoji of emojis) {
        run = emoji === prev ? run + 1 : 1;
        prev = emoji;
        maxRun = Math.max(maxRun, run);
      }
      maxStreaks.push({ agentId, maxRun });
    }
    const offenders = maxStreaks.filter(s => s.maxRun > 2);
    expect(offenders).toEqual([]);
  });

  it("keeps the echo-chamber expected signals passing", async () => {
    const scenario = getScenario("stagnation_echo_chamber");
    if (!scenario) throw new Error("scenario missing from registry");
    const artifact = await ScenarioRunner.run(scenario, { llmMode: "mock" });
    expect(artifact.passedSignals).toBe(artifact.totalSignals);
  });
});
