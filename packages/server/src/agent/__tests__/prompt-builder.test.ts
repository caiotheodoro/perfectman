import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../prompt-builder.js";
import { GOULART_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import type { AgentRuntimeInput, CommittedEvent } from "@perfectman/shared";

describe("PromptBuilder", () => {
  const triggeringEvent: CommittedEvent = {
    id: "evt-111",
    simulationId: "sim-123",
    channelId: "general",
    actorId: "agent-bruno",
    type: "message_sent",
    payload: { content: "o Goulart tá sumido hoje né" },
    createdAt: Date.now(),
    pulseIndex: 12,
    sourceEventIds: [],
    emotionalSalience: "medium",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public message",
    },
  };

  const contextEvent: CommittedEvent = {
    id: "evt-222",
    simulationId: "sim-123",
    channelId: "general",
    actorId: "agent-caio",
    type: "reply_sent",
    payload: { content: "verdade, deve tá na academia" },
    createdAt: Date.now(),
    pulseIndex: 13,
    sourceEventIds: ["evt-111"],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public reply",
    },
  };

  const input: AgentRuntimeInput = {
    simulationId: "sim-123",
    agentId: "goulart",
    personaConfig: {
      id: "goulart",
      name: "Goulart",
      archetype: "provocateur",
      writingStyle: "lowercase blunt",
      styleExamples: ["calmae"],
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
      triggeringEvent: triggeringEvent,
      visibleContextEvents: [triggeringEvent, contextEvent],
      involvedPeople: ["agent-bruno", "agent-caio"],
      relevantChannels: ["general"],
      relevantMemories: [
        {
          id: "mem-999",
          agentId: "goulart",
          simulationId: "sim-123",
          type: "relationship",
          subjectAgentIds: ["agent-bruno"],
          sourceEventIds: [],
          summary: "Bruno is often quiet and passive aggressive",
          emotionalTone: "suspicion",
          confidence: 0.8,
          unresolved: true,
          createdAt: Date.now(),
          lastReinforcedAt: Date.now(),
        },
      ],
      translatedEmotionalState: {
        moodDescription: "You feel excited, energized, and ready to stir up some chat.",
        socialContext: "Bruno mentioned you in general channel.",
        relationalFlavors: [
          {
            targetAgentId: "agent-bruno",
            description: "You find Bruno a bit annoying but you like poking him.",
          },
        ],
        pressureDescriptions: ["You feel a strong urge to reply to Bruno's tease."],
        inhibitionDescriptions: ["You feel slightly hesitant to look too eager, but your excitement beats it."],
      },
      availableActions: [
        {
          intentType: "send_message",
          channelTargets: ["general"],
          personTargets: [],
          blocked: false,
        },
        {
          intentType: "reply_to_message",
          channelTargets: ["general"],
          personTargets: ["agent-bruno"],
          blocked: false,
        },
      ],
    },
    emotionalState: {
      coreMood: {
        valence: 0.1,
        arousal: 0.65,
        stability: 0.35,
        energy: 0.70,
        circumplexAngle: 0.8,
        circumplexRadius: 0.6,
        momentumValence: 0,
        momentumArousal: 0,
      },
      socialEmotions: {
        jealousy: 0, envy: 0, humiliation: 0, pride: 0.2, shame: 0,
        affection: 0.3, resentment: 0, suspicion: 0.1, admiration: 0,
        contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
        desireForStatus: 0.4, desireForIntimacy: 0.1,
      },
      relationalStates: new Map(),
    },
    activeMotivations: [],
    activePressures: [],
    activeInhibitions: [],
    relevantMemories: [],
    availableActions: [
      {
        intentType: "send_message",
        channelTargets: ["general"],
        personTargets: [],
        blocked: false,
      },
      {
        intentType: "reply_to_message",
        channelTargets: ["general"],
        personTargets: ["agent-bruno"],
        blocked: false,
      },
    ],
    budgetPriority: "normal",
    triggeringReason: "attention_event",
  };

  it("should successfully build a prompt with system and user properties", () => {
    const prompt = PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "action_intent");

    expect(prompt).toBeDefined();
    expect(typeof prompt.system).toBe("string");
    expect(typeof prompt.user).toBe("string");
    expect(prompt.inputTokensEstimate).toBeGreaterThan(0);
  });

  it("should verify that the prompt contains all required sections", () => {
    const prompt = PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "action_intent");
    const combined = prompt.system + "\n\n" + prompt.user;

    expect(combined).toContain("SECTION 1: YOUR IDENTITY");
    expect(combined).toContain("SECTION 2: RECENT CHANNEL EVENTS");
    expect(combined).toContain("SECTION 3: SOCIAL INTERPRETATION");
    expect(combined).toContain("SECTION 4: HOW YOU SUBJECTIVELY FEEL");
    expect(combined).toContain("SECTION 5: FELT URGES & SOCIAL BLOCKS");
    expect(combined).toContain("SECTION 6: WHAT YOU REMEMBER");
    expect(combined).toContain("SECTION 7: PERMITTED ACTIONS MENU");
    expect(combined).toContain("SECTION 8: OUTPUT CONTRACT");
  });

  it("should verify that the prompt includes the triggering event and context", () => {
    const prompt = PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "action_intent");
    
    expect(prompt.user).toContain("o Goulart tá sumido hoje né");
    expect(prompt.user).toContain("verdade, deve tá na academia");
    expect(prompt.user).toContain("agent-bruno");
    expect(prompt.user).toContain("agent-caio");
  });

  it("should verify that the prompt includes available actions and target options", () => {
    const prompt = PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "action_intent");

    expect(prompt.user).toContain("send_message");
    expect(prompt.user).toContain("reply_to_message");
    expect(prompt.user).toContain("agent-bruno");
  });

  it("should verify that the prompt completely excludes raw numeric scores", () => {
    const prompt = PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "action_intent");
    const combined = prompt.system + "\n\n" + prompt.user;

    // Verify exclusions
    expect(combined).not.toContain("0.65"); // raw arousal
    expect(combined).not.toContain("0.35"); // raw stability
    expect(combined).not.toContain("0.70"); // raw energy
    expect(combined).not.toContain("0.4");  // status drive
    expect(combined).not.toContain("0.1");  // valence
  });

  it("should verify that the prompt demands strict JSON output without thinking frames", () => {
    const prompt = PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "action_intent");

    expect(prompt.system).toContain("SINGLE valid JSON object");
    expect(prompt.system).toContain("DO NOT include any chain-of-thought");
    expect(prompt.system).toContain("privateMotiveSummary");
  });

  describe("PromptBuilder - PromptPurpose policy", () => {
  it("action_intent: BuiltPrompt.purpose is 'action_intent'", () => {
    const prompt = PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "action_intent");

    expect(prompt.purpose).toBe("action_intent");
  });

  it("action_intent: includes voiceGuidelines and styleExamples", () => {
    const prompt = PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "action_intent");

    expect(prompt.system).toContain("Voice Guidelines");
    expect(prompt.system).toContain("Style Examples");
    expect(prompt.system).toContain(GOULART_PROMPT_PROFILE.voiceGuidelines[0]!);
  });

  it("action_intent: Section 1 preserves the original rendered order", () => {
    const prompt = PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "action_intent");
    const section1 = prompt.system.split("\n\n### SECTION 8: OUTPUT CONTRACT & JSON FORMAT")[0]!;
    const expectedSection1 = `### SECTION 1: YOUR IDENTITY & PERSONA
You are roleplaying as a highly specific person in an online chat room. You must completely inhabit this character.
- **Display Name**: ${GOULART_PROMPT_PROFILE.displayName}
- **Persona Vibe**: ${GOULART_PROMPT_PROFILE.identityFrame}
- **Primary Language**: Portuguese (pt-BR)

Voice Guidelines:
${GOULART_PROMPT_PROFILE.voiceGuidelines.map((g) => `- ${g}`).join("\n")}

Relationship Biases & Interpersonal Views:
${Object.entries(GOULART_PROMPT_PROFILE.relationshipBiases)
  .map(([peer, bias]) => `- **${peer}**: ${bias}`)
  .join("\n")}

Style Examples (mimic these natural patterns):
${GOULART_PROMPT_PROFILE.styleExamples.map((e) => `"${e}"`).join(", ")}`;

    expect(section1).toBe(expectedSection1);
  });

  it("reserved purposes are rejected until dedicated builders exist", () => {
    expect(() =>
      PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "social_interpretation")
    ).toThrow("Unsupported prompt purpose: social_interpretation");
    expect(() =>
      PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "background_reflection")
    ).toThrow("Unsupported prompt purpose: background_reflection");
    expect(() =>
      PromptBuilder.build(input, GOULART_PROMPT_PROFILE, "spectator_recap")
    ).toThrow("Unsupported prompt purpose: spectator_recap");
  });
});
});
