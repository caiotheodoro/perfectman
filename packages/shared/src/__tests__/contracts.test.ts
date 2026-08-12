import { describe, expect, it } from "vitest";
import type { RoleplayScenario, RubricAxis, PersonaPack } from "../index.js";

describe("scenario contracts", () => {
  it("exposes the scenario types", () => {
    const rubric: RubricAxis = {
      id: "in_character",
      label: "In-character fidelity",
      anchors: {
        1: "Completely out of character",
        2: "Mostly out of character",
        3: "Recognizable but flat",
        4: "Clearly in character",
        5: "Deeply in character",
      },
      weight: 1,
    };
    expect(rubric.anchors[5]).toContain("Deeply");
  });

  it("scenario category set covers the product surface", () => {
    const categories = [
      "v1_behavior",
      "motive_archetype",
      "stagnation_attractor",
      "edge_chaos",
      "calibration",
    ] as const;
    const scenario: Partial<RoleplayScenario> = { category: categories[0] };
    expect(scenario.category).toBe("v1_behavior");
  });
});

describe("persona pack contracts", () => {
  it("carries the unhinged spec", () => {
    const pack: PersonaPack = {
      personaId: "bruno",
      displayName: "Bruno",
      archetype: "observer",
      identityFrame: "x",
      voiceGuidelines: [],
      styleExamples: [],
      relationshipBiases: {},
      language: "pt-BR",
      memorySeeds: [],
      pendingIntentions: [],
      socialTheory: [],
      edgeProfile: {
        chaosCap: "medium",
        impulseBehaviors: [],
        triggers: [],
        maskTells: [],
        privateMotiveLexicon: [],
        hardLimits: [],
      },
      presenceProfile: {
        responseDelayMs: [2000, 15000],
        silenceTolerancePulses: 6,
        messageLength: "short",
        punctuationTells: [],
      },
      sampling: { temperature: 0.7, repetitionPenalty: 1.1, topP: 0.95, maxTokens: 300 },
    };
    expect(pack.edgeProfile.chaosCap).toBe("medium");
    expect(pack.presenceProfile.responseDelayMs).toEqual([2000, 15000]);
  });
});
