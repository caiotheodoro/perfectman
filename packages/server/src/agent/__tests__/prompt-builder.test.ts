import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../prompt-builder.js";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import type { AgentRuntimeInput, CommittedEvent } from "@perfectman/shared";

describe("PromptBuilder", () => {
  const triggeringEvent: CommittedEvent = {
    id: "evt-111",
    simulationId: "sim-123",
    channelId: "general",
    actorId: "agent-peer",
    type: "message_sent",
    payload: { content: "o Example Friend tá sumido hoje né" },
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
    actorId: "agent-peer",
    type: "reply_sent",
    payload: { content: "verdade, deve tá ocupado" },
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
    agentId: "example-friend",
    personaConfig: {
      id: "example-friend",
      name: "Example Friend",
      archetype: "careful-observer",
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
      agentId: "example-friend",
      triggeringEvent: triggeringEvent,
      visibleContextEvents: [triggeringEvent, contextEvent],
      ownRecentUtterances: [],
      involvedPeople: ["agent-peer", "agent-peer"],
      relevantChannels: ["general"],
      relevantMemories: [
        {
          id: "mem-999",
          agentId: "example-friend",
          simulationId: "sim-123",
          type: "relationship",
          subjectAgentIds: ["agent-peer"],
          sourceEventIds: [],
          summary: "This friend is often quiet and indirect",
          emotionalTone: "suspicion",
          confidence: 0.8,
          unresolved: true,
          createdAt: Date.now(),
          lastReinforcedAt: Date.now(),
        },
      ],
      translatedEmotionalState: {
        moodDescription: "You feel excited, energized, and ready to stir up some chat.",
        socialContext: "A friend mentioned you in general channel.",
        relationalFlavors: [
          {
            targetAgentId: "agent-peer",
            description: "You find this friend ambiguous but worth checking on.",
          },
        ],
        pressureDescriptions: ["You feel a strong urge to reply to the tease."],
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
          personTargets: ["agent-peer"],
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
        personTargets: ["agent-peer"],
        blocked: false,
      },
    ],
    budgetPriority: "normal",
    triggeringReason: "attention_event",
  };

  it("should successfully build a prompt with system and user properties", () => {
    const prompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(prompt).toBeDefined();
    expect(typeof prompt.system).toBe("string");
    expect(typeof prompt.user).toBe("string");
    expect(prompt.inputTokensEstimate).toBeGreaterThan(0);
  });

  it("should verify that the prompt contains all required sections", () => {
    const prompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");
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
    const prompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");
    
    expect(prompt.user).toContain("o Example Friend tá sumido hoje né");
    expect(prompt.user).toContain("verdade, deve tá ocupado");
    expect(prompt.user).toContain("agent-peer");
    expect(prompt.user).toContain("agent-peer");
  });

  it("should verify that the prompt includes available actions and target options", () => {
    const prompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(prompt.user).toContain("send_message");
    expect(prompt.user).toContain("reply_to_message");
    expect(prompt.user).toContain("agent-peer");
  });

  it("should verify that the prompt completely excludes raw numeric scores", () => {
    const prompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");
    const combined = prompt.system + "\n\n" + prompt.user;

    // Verify exclusions
    expect(combined).not.toContain("0.65"); // raw arousal
    expect(combined).not.toContain("0.35"); // raw stability
    expect(combined).not.toContain("0.70"); // raw energy
    expect(combined).not.toContain("0.4");  // status drive
    expect(combined).not.toContain("0.1");  // valence
  });

  it("should verify that the prompt demands strict JSON output without thinking frames", () => {
    const prompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

    expect(prompt.system).toContain("SINGLE valid JSON object");
    expect(prompt.system).toContain("DO NOT include any chain-of-thought");
    expect(prompt.system).toContain("privateMotiveSummary");
  });

  describe("PromptPurpose policy", () => {
    it("action_intent: BuiltPrompt.purpose is 'action_intent'", () => {
      const prompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

      expect(prompt.purpose).toBe("action_intent");
    });

    it("action_intent: includes voice guidelines and grouped style examples", () => {
      const prompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

      expect(prompt.system).toContain("Voice guidelines");
      expect(prompt.system).toContain("Tonal/register guide");
      expect(prompt.system).toContain(EXAMPLE_PROMPT_PROFILE.voiceGuidelines[0]!);
      expect(prompt.system).toContain(EXAMPLE_PROMPT_PROFILE.styleExamples.default[0]!);
      expect(prompt.system).toContain(EXAMPLE_PROMPT_PROFILE.styleExamples.dryOrLowEnergy[0]!);
    });

    it("action_intent: Section 1 renders the richer persona profile compactly", () => {
      const prompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");
      const section1 = prompt.system.split("\n\n### SECTION 8: OUTPUT CONTRACT & JSON FORMAT")[0]!;

      expect(section1).toContain("SECTION 1: YOUR IDENTITY & PERSONA");
      expect(section1).toContain(`- **Display Name**: ${EXAMPLE_PROMPT_PROFILE.displayName}`);
      expect(section1).toContain("Core traits");
      expect(section1).toContain("Values and motivations");
      expect(section1).toContain("Social presence");
      expect(section1).toContain("Thought process");
      expect(section1).toContain("Conflict and repair style");
      expect(section1).toContain("Hard avoids");
      expect(section1).toContain("Relationship-specific views");
    });

    it("action_intent: Section 1 includes cognitive style and hard avoids", () => {
      const prompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

      expect(prompt.system).toContain("You compare context, timing, and likely consequences before acting.");
      expect(prompt.system).toContain("Do not sound overly warm, sentimental, or artificially therapeutic.");
    });

    it("action_intent: Section 1 does not render source refs, raw transcripts, or assessment scores", () => {
      const prompt = PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "action_intent");

      expect(prompt.system).not.toContain("sourceRefs");
      expect(prompt.system).not.toContain("assessmentIds");
      expect(prompt.system).not.toContain("real-person-assessment");
      expect(prompt.system).not.toContain("transcript");
      expect(prompt.system).not.toContain("5/5");
      expect(prompt.system).not.toContain("0.65");
    });

    it("reserved purposes are rejected until dedicated builders exist", () => {
      expect(() =>
        PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "social_interpretation")
      ).toThrow("Unsupported prompt purpose: social_interpretation");
      expect(() =>
        PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "background_reflection")
      ).toThrow("Unsupported prompt purpose: background_reflection");
      expect(() =>
        PromptBuilder.build(input, EXAMPLE_PROMPT_PROFILE, "spectator_recap")
      ).toThrow("Unsupported prompt purpose: spectator_recap");
    });
  });
});
