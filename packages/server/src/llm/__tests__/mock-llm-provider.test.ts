import { describe, it, expect } from "vitest";
import { MockLlmProvider } from "../mock-llm-provider.js";
import { IntentParser } from "../../agent/intent-parser.js";
import type { AgentRuntimeInput, AvailableAction } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../../agent/agent-runtime.types.js";

describe("MockLlmProvider", () => {
  const provider = new MockLlmProvider();

  const context: AgentRuntimeContext = {
    pulseIndex: 10,
    now: Date.now(),
  };

  const prompt: BuiltPrompt = {
    system: "system prompt text",
    user: "user prompt text",
    inputTokensEstimate: 200,
  };

  const availableActions: AvailableAction[] = [
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
    {
      intentType: "create_channel",
      channelTargets: [],
      personTargets: ["agent-caio"],
      blocked: false,
    },
  ];

  const baseInput: AgentRuntimeInput = {
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
      involvedPeople: [],
      relevantChannels: ["general"],
      relevantMemories: [],
      translatedEmotionalState: {
        moodDescription: "You feel normal",
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
    relevantMemories: [],
    availableActions,
    budgetPriority: "normal",
    triggeringReason: "initiative_cadence",
  };

  it("should be deterministic (same input returns same output content)", async () => {
    const res1 = await provider.generateIntent(baseInput, context, prompt);
    const res2 = await provider.generateIntent(baseInput, context, prompt);

    const parsed1 = JSON.parse(res1.content);
    const parsed2 = JSON.parse(res2.content);

    // Except for generated unique ID, fields must match
    expect(parsed1.actorId).toBe(parsed2.actorId);
    expect(parsed1.intentType).toBe(parsed2.intentType);
    expect(parsed1.visibleContent).toBe(parsed2.visibleContent);
    expect(parsed1.privateMotiveSummary).toBe(parsed2.privateMotiveSummary);
  });

  it("should pick reply_to_message when triggering reason is mention", async () => {
    const input: AgentRuntimeInput = {
      ...baseInput,
      triggeringReason: "attention_event",
      perceptionPacket: {
        ...baseInput.perceptionPacket,
        triggeringEvent: {
          id: "evt-123",
          simulationId: "sim-123",
          channelId: "general",
          actorId: "agent-bruno",
          type: "message_sent",
          payload: { content: "@goulart" },
          createdAt: Date.now(),
          pulseIndex: 8,
          sourceEventIds: [],
          emotionalSalience: "high",
          visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "" },
        },
      },
    };

    const res = await provider.generateIntent(input, context, prompt);
    const parsed = JSON.parse(res.content);

    expect(parsed.intentType).toBe("reply_to_message");
    expect(parsed.personTargets).toContain("agent-bruno");
    expect(parsed.visibleContent).toContain("tava treinando"); // Goulart sarcasm
    
    // Test parser integration
    const parserResult = IntentParser.parse(res.content, "goulart", availableActions);
    expect(parserResult.fallbackApplied).toBe(false);
  });

  it("should pick no_op when high inhibition is active", async () => {
    const input: AgentRuntimeInput = {
      ...baseInput,
      activeInhibitions: [
        {
          id: "inh-1",
          agentId: "goulart",
          type: "fear_of_looking_needy",
          strength: "high",
          reason: "extremely high hesitation",
        },
      ],
    };

    const res = await provider.generateIntent(input, context, prompt);
    const parsed = JSON.parse(res.content);

    expect(parsed.intentType).toBe("no_op");
    expect(parsed.privateMotiveSummary).toContain("hesitations are holding me back");

    // Test parser integration
    const parserResult = IntentParser.parse(res.content, "goulart", availableActions);
    expect(parserResult.fallbackApplied).toBe(false);
  });

  it("should pick create_channel when private channel action is available and no other triggers stand out", async () => {
    const noSendMessageActions = availableActions.filter(a => a.intentType !== "send_message");
    const input: AgentRuntimeInput = {
      ...baseInput,
      availableActions: noSendMessageActions,
      perceptionPacket: {
        ...baseInput.perceptionPacket,
        availableActions: noSendMessageActions,
      },
    };

    const res = await provider.generateIntent(input, context, prompt);
    const parsed = JSON.parse(res.content);

    expect(parsed.intentType).toBe("create_channel");
    expect(parsed.personTargets).toContain("agent-caio");

    // Test parser integration
    const parserResult = IntentParser.parse(res.content, "goulart", noSendMessageActions);
    expect(parserResult.fallbackApplied).toBe(false);
  });

  it("should pick send_message on boredom / initiative trigger", async () => {
    const noCreateChannelActions = availableActions.filter(a => a.intentType !== "create_channel");
    const input: AgentRuntimeInput = {
      ...baseInput,
      availableActions: noCreateChannelActions,
      perceptionPacket: {
        ...baseInput.perceptionPacket,
        availableActions: noCreateChannelActions,
      },
    };

    const res = await provider.generateIntent(input, context, prompt);
    const parsed = JSON.parse(res.content);

    expect(parsed.intentType).toBe("send_message");
    expect(parsed.visibleContent).toContain("Chelsea");
    expect(parsed.privateMotiveSummary).toContain("Chelsea");
  });

  it("should report tokens usage and latency", async () => {
    const res = await provider.generateIntent(baseInput, context, prompt);

    expect(res.usage.inputTokens).toBe(200);
    expect(res.usage.outputTokens).toBeGreaterThan(0);
    expect(res.latencyMs).toBeGreaterThanOrEqual(50);
  });
});
