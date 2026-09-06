import { describe, it, expect } from "vitest";
import { MockLLMProvider } from "../mock-llm-provider.js";
import { IntentParser } from "../../agent/intent-parser.js";
import type { AgentRuntimeInput, AvailableAction } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../../agent/agent-runtime.types.js";

describe("MockLLMProvider", () => {
  const provider = new MockLLMProvider();

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
      personTargets: ["agent-alpha"],
      blocked: false,
    },
    {
      intentType: "create_channel",
      channelTargets: [],
      personTargets: ["agent-alpha"],
      blocked: false,
    },
  ];

  const baseInput: AgentRuntimeInput = {
    simulationId: "sim-123",
    agentId: "agent-beta",
    personaConfig: {
      id: "agent-beta",
      name: "Beta",
      archetype: "observer",
      writingStyle: "brief",
      styleExamples: [],
      baselineValence: 0,
      baselineArousal: 0.3,
      baselineStability: 0.7,
      baselineEnergy: 0.6,
      emotionalReactivity: 1.0,
      moodInertia: 0.5,
      maxMoodRotation: 0.4,
      energyRegen: 0.04,
      exclusionSensitivity: 1,
      praiseSensitivity: 1,
      conflictSensitivity: 1,
      boredomSensitivity: 1,
      intimacySensitivity: 1,
      socialSensitivities: {},
    },
    perceptionPacket: {
      agentId: "agent-beta",
      triggeringEvent: null,
      visibleContextEvents: [], eventHandles: {}, ownRecentUtterances: [],
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

    expect(parsed1.actorId).toBe(parsed2.actorId);
    expect(parsed1.intentType).toBe(parsed2.intentType);
    expect(parsed1.visibleContent).toBe(parsed2.visibleContent);
    expect(parsed1.privateMotiveSummary).toBe(parsed2.privateMotiveSummary);
  });

  it("should pick reply_to_message when triggering reason is attention_event and actor is reachable", async () => {
    const input: AgentRuntimeInput = {
      ...baseInput,
      triggeringReason: "attention_event",
      perceptionPacket: {
        ...baseInput.perceptionPacket,
        triggeringEvent: {
          id: "evt-123",
          simulationId: "sim-123",
          channelId: "general",
          actorId: "agent-alpha",
          type: "message_sent",
          payload: { content: "@agent-beta" },
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
    expect(parsed.personTargets).toContain("agent-alpha");
    // The wording rotates so the repetition guard does not block every turn
    // after the first; what matters here is that a reply carries something.
    expect(parsed.visibleContent).toBeTypeOf("string");
    expect(parsed.visibleContent.length).toBeGreaterThan(0);

    const parserResult = IntentParser.parse(res.content, "agent-beta", availableActions);
    expect(parserResult.fallbackApplied).toBe(false);
  });

  it("should fall back to send_message when reply target is not in available personTargets", async () => {
    const input: AgentRuntimeInput = {
      ...baseInput,
      triggeringReason: "attention_event",
      perceptionPacket: {
        ...baseInput.perceptionPacket,
        triggeringEvent: {
          id: "evt-456",
          simulationId: "sim-123",
          channelId: "general",
          actorId: "agent-unknown",
          type: "message_sent",
          payload: { content: "hello" },
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

    expect(parsed.intentType).toBe("send_message");

    const parserResult = IntentParser.parse(res.content, "agent-beta", availableActions);
    expect(parserResult.fallbackApplied).toBe(false);
  });

  it("should pick no_op when high inhibition is active", async () => {
    const input: AgentRuntimeInput = {
      ...baseInput,
      activeInhibitions: [
        {
          id: "inh-1",
          agentId: "agent-beta",
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

    const parserResult = IntentParser.parse(res.content, "agent-beta", availableActions);
    expect(parserResult.fallbackApplied).toBe(false);
  });

  it("should pick create_channel when it is the best available action", async () => {
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
    expect(parsed.personTargets).toContain("agent-alpha");

    const parserResult = IntentParser.parse(res.content, "agent-beta", noSendMessageActions);
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
    expect(parsed.visibleContent.length).toBeGreaterThan(0);
    expect(parsed.privateMotiveSummary.length).toBeGreaterThan(0);
  });

  it("says something different next turn, so the repetition guard has nothing to block", async () => {
    // Three canned lines shared by every agent meant a sixteen-turn run
    // produced three messages and then a room of people saying nothing.
    const noCreateChannelActions = availableActions.filter((a) => a.intentType !== "create_channel");
    const input: AgentRuntimeInput = {
      ...baseInput,
      availableActions: noCreateChannelActions,
      perceptionPacket: { ...baseInput.perceptionPacket, availableActions: noCreateChannelActions },
    };

    // A fresh provider per turn, because that is what the factory does.
    const said = new Set<string>();
    for (let pulseIndex = 0; pulseIndex < 4; pulseIndex++) {
      const res = await new MockLLMProvider().generateIntent(input, { ...context, pulseIndex }, prompt);
      said.add(JSON.parse(res.content).visibleContent as string);
    }
    expect(said.size).toBe(4);
  });

  it("should report tokens usage and latency", async () => {
    const res = await provider.generateIntent(baseInput, context, prompt);

    expect(res.usage.inputTokens).toBe(200);
    expect(res.usage.outputTokens).toBeGreaterThan(0);
    expect(res.latencyMs).toBeGreaterThanOrEqual(50);
  });
});
