import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../prompt-builder.js";
import { BackgroundReflectionPromptBuilder } from "../background-reflection-prompt-builder.js";
import { GENERIC_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import type { AgentRuntimeInput, Memory } from "@perfectman/shared";
import type { BuiltPrompt } from "../agent-runtime.types.js";

function memory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem-1",
    agentId: "goulart",
    simulationId: "sim",
    type: "relationship",
    subjectAgentIds: ["bruno"],
    sourceEventIds: [],
    summary: "bruno me ignorou de propósito",
    emotionalTone: "resentful",
    confidence: 0.8,
    unresolved: true,
    createdAt: 1,
    lastReinforcedAt: Date.now(),
    ...overrides,
  };
}

const availableActions = [
  { intentType: "send_message", channelTargets: ["general"], personTargets: [], blocked: false },
];

function input(memories: Memory[] = []): AgentRuntimeInput {
  return {
    simulationId: "sim-123",
    agentId: "goulart",
    personaConfig: {
      id: "goulart",
      name: "Goulart",
      archetype: "provocateur",
      writingStyle: "lowercase blunt",
      styleExamples: [],
      baselineValence: 0.1,
      baselineArousal: 0.65,
      baselineStability: 0.35,
      baselineEnergy: 0.70,
      emotionalReactivity: 1.5,
      moodInertia: 0.25,
      maxMoodRotation: 0.8,
      energyRegen: 0.06,
      exclusionSensitivity: 0.7,
      praiseSensitivity: 1.2,
      conflictSensitivity: 1.8,
      boredomSensitivity: 1.4,
      intimacySensitivity: 0.5,
      socialSensitivities: {},
    },
    perceptionPacket: {
      agentId: "goulart",
      triggeringEvent: null,
      visibleContextEvents: [],
      ownRecentUtterances: [],
      involvedPeople: [],
      relevantChannels: ["general"],
      relevantMemories: memories,
      translatedEmotionalState: {
        moodDescription: "You feel tense and watched",
        socialContext: "",
        relationalFlavors: [],
        pressureDescriptions: [],
        inhibitionDescriptions: [],
      },
      availableActions,
    },
    emotionalState: {
      coreMood: {
        valence: 0, arousal: 0, stability: 0.5, energy: 0.5,
        circumplexAngle: 0, circumplexRadius: 0, momentumValence: 0, momentumArousal: 0,
      },
      socialEmotions: {
        jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
        affection: 0, resentment: 0, suspicion: 0, admiration: 0,
        contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
        desireForStatus: 0, desireForIntimacy: 0,
      },
      relationalStates: new Map(),
    },
    activeMotivations: [],
    activePressures: [],
    activeInhibitions: [],
    relevantMemories: memories,
    availableActions,
    budgetPriority: "normal",
    triggeringReason: "initiative_cadence",
  };
}

describe("BackgroundReflectionPromptBuilder", () => {
  const profile = GENERIC_PROMPT_PROFILE;

  it("carries the background_reflection purpose", () => {
    const built = BackgroundReflectionPromptBuilder.build(input(), profile);
    expect(built.purpose).toBe("background_reflection");
  });

  it("includes identity frame and relationship biases (field matrix)", () => {
    const built = BackgroundReflectionPromptBuilder.build(input(), profile);
    expect(built.system).toContain(profile.identityFrame);
    expect(built.system).toContain("How you tend to feel about the others");
  });

  it("excludes voice guidelines and style examples (field matrix)", () => {
    const built = BackgroundReflectionPromptBuilder.build(input(), profile);
    expect(built.system).not.toContain(profile.voiceGuidelines[0]);
    expect(built.system).not.toContain(profile.styleExamples.default[0]);
  });

  it("documents the consolidation output contract, derived from MemoryWriteProposalSchema", () => {
    const built = BackgroundReflectionPromptBuilder.build(input(), profile);
    for (const fragment of [
      '"consolidations"',
      'pending_intention',
      'emotional_residue',
      '"confidence" (required): number (0-1)',
      '"unresolved" (required): boolean',
      'ONLY a JSON object',
    ]) {
      expect(built.system, fragment).toContain(fragment);
    }
  });

  it("renders unresolved memories and current mood into the user prompt", () => {
    const built = BackgroundReflectionPromptBuilder.build(
      input([memory(), memory({ id: "mem-2", summary: "resolved thing", unresolved: false })]),
      profile,
    );
    expect(built.user).toContain("bruno me ignorou de propósito");
    expect(built.user).not.toContain("resolved thing");
    expect(built.user).toContain("You feel tense and watched");
  });

  it("handles an empty scene without memories", () => {
    const built = BackgroundReflectionPromptBuilder.build(input(), profile);
    expect(built.user).toContain("(nothing happened recently)");
    expect(built.user).toContain("(none carried into this scene)");
  });

  it("is dispatched by PromptBuilder without throwing", () => {
    const built = PromptBuilder.build(input([memory()]), profile, "background_reflection");
    expect((built as BuiltPrompt).purpose).toBe("background_reflection");
  });

  it("maps to the reflection call type", async () => {
    const { purposeToCallType } = await import("../surface/llm-step.js");
    expect(purposeToCallType("background_reflection")).toBe("reflection");
  });

  it("assigns a deterministic promptVersion (stable across identical builds)", () => {
    const a = BackgroundReflectionPromptBuilder.build(input(), profile);
    const b = BackgroundReflectionPromptBuilder.build(input(), profile);
    expect(a.version).toBe(b.version);
    expect(a.version).toMatch(/^[0-9a-z]+$/);
  });

  it("keeps templateVersion stable across renders whose per-pulse content differs, unlike version", () => {
    const a = BackgroundReflectionPromptBuilder.build(input(), profile);
    const b = BackgroundReflectionPromptBuilder.build(input([memory()]), profile);
    expect(a.version).not.toBe(b.version);
    expect(a.templateVersion).toBeTruthy();
    expect(a.templateVersion).toBe(b.templateVersion);
  });

  it("still fails closed for the other reserved purposes", () => {
    expect(() => PromptBuilder.build(input(), profile, "social_interpretation")).toThrow(/Unsupported/);
    expect(() => PromptBuilder.build(input(), profile, "spectator_recap")).toThrow(/Unsupported/);
  });
});
