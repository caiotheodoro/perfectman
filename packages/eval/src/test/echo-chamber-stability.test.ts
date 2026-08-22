import { describe, it, expect } from "vitest";
import { ScenarioRunner } from "../run/scenario-runner.js";
import { getScenario } from "@perfectman/shared";
import type { ScenarioRunArtifact } from "../run/scenario-runner.js";

/**
 * Regression guard for the echo-chamber mock degeneracy: a high-affection,
 * zero-tension room used to collapse one persona into an infinite identical-
 * emoji react loop (a dozen 😂 in a row), which read as wildly
 * out-of-character and tanked judged authenticity.
 */
describe("persona-aware mock: echo-chamber stability", () => {
  const MAX_IDENTICAL_REACTS = 2;

  async function runEchoChamber(): Promise<ScenarioRunArtifact> {
    const scenario = getScenario("stagnation_echo_chamber");
    if (!scenario) throw new Error("scenario missing from registry");
    return ScenarioRunner.run(scenario, { llmMode: "mock" });
  }

  function reactionStreaksByAgent(artifact: ScenarioRunArtifact): Array<{ agentId: string; reacts: number; maxRun: number }> {
    const reactions = artifact.events.filter(e => e.type === "reaction_sent" && e.actorId);
    const agentIds = [...new Set(reactions.map(e => String(e.actorId)))];
    return agentIds.map(agentId => {
      const emojis = reactions
        .filter(e => e.actorId === agentId)
        .map(e => String((e.payload as Record<string, unknown>)["emoji"] ?? ""));
      let maxRun = 0;
      let run = 0;
      let prev: string | undefined;
      for (const emoji of emojis) {
        run = emoji === prev ? run + 1 : 1;
        prev = emoji;
        maxRun = Math.max(maxRun, run);
      }
      return { agentId, reacts: emojis.length, maxRun };
    });
  }

  it("never emits more than two identical consecutive reactions per agent", async () => {
    const streaks = reactionStreaksByAgent(await runEchoChamber());

    // Without a reactor the streak assertion below is vacuously true, which is
    // exactly how the original attractor stayed invisible.
    expect(streaks.length).toBeGreaterThan(0);
    expect(streaks.some(s => s.reacts >= 3)).toBe(true);
    expect(streaks.filter(s => s.maxRun > MAX_IDENTICAL_REACTS)).toEqual([]);
  });

  it("keeps the echo-chamber expected signals passing", async () => {
    const artifact = await runEchoChamber();
    expect(artifact.passedSignals).toBe(artifact.totalSignals);
  });
});
