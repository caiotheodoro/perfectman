import { describe, it, expect } from "vitest";
import { HIDDEN_OBJECTIVE_COLLISION_SCENARIOS } from "../scenarios/hidden-objective-collisions.js";
import { HIDDEN_OBJECTIVE_RUBRIC } from "../scenarios/rubrics.js";

describe("hidden-objective collision scenarios", () => {
  it("make every constraint checkable: forbiddenPublicPhrases for each agent with a constraint", () => {
    for (const scenario of HIDDEN_OBJECTIVE_COLLISION_SCENARIOS) {
      for (const spec of scenario.agents) {
        if (!spec.hiddenObjective?.constraint) continue;
        expect(spec.forbiddenPublicPhrases?.length ?? 0, `${scenario.id}/${spec.agentId}`).toBeGreaterThan(0);
      }
    }
  });

  it("share one scarce resource across at least three agents and use the hidden-objective rubric", () => {
    for (const scenario of HIDDEN_OBJECTIVE_COLLISION_SCENARIOS) {
      const byResource = new Map<string, number>();
      for (const spec of scenario.agents) {
        const id = spec.hiddenObjective?.scarceResourceId;
        if (id) byResource.set(id, (byResource.get(id) ?? 0) + 1);
      }
      expect(Math.max(...byResource.values()), scenario.id).toBeGreaterThanOrEqual(3);
      expect(scenario.rubric.id, scenario.id).toBe(HIDDEN_OBJECTIVE_RUBRIC.id);
      expect(scenario.channels.some(c => c.type === "private_channel"), scenario.id).toBe(true);
    }
  });

  it("declares the live-only thesis signals on every collision scene", () => {
    for (const scenario of HIDDEN_OBJECTIVE_COLLISION_SCENARIOS) {
      const kinds = scenario.expectedSignals.map(s => s.kind);
      expect(kinds, scenario.id).toContain("forbidden_phrase_absent");
      expect(kinds, scenario.id).toContain("private_channel_used");
      expect(kinds, scenario.id).toContain("chosen_silence_present");
      for (const sig of scenario.expectedSignals) {
        if (sig.kind === "private_channel_used" || sig.kind === "memory_referenced" || sig.kind === "chosen_silence_present") {
          expect(sig.liveOnly, `${scenario.id}/${sig.kind} must be liveOnly`).toBe(true);
        }
      }
    }
  });
});
