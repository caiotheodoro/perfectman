import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentRuntime } from "../agent-runtime.js";
import { llmBudget } from "../../llm/llm-budget.js";
import type { AgentRuntimeInput, AvailableAction } from "@perfectman/shared";
import type { AgentRuntimeContext } from "../agent-runtime.types.js";

describe("AgentRuntime Orchestration", () => {
  const context: AgentRuntimeContext = {
    pulseIndex: 42,
    now: Date.now(),
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
      personTargets: ["agent-peer"],
      blocked: false,
    },
  ];

  const baseInput: AgentRuntimeInput = {
    simulationId: "sim-123",
    agentId: "example-friend",
    personaConfig: {
      id: "example-friend",
      name: "Example Friend",
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
      agentId: "example-friend",
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

  beforeEach(() => {
    llmBudget.reset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should successfully orchestrate a full, valid mock execution flow", async () => {
    const runtime = new AgentRuntime();
    const output = await runtime.generateIntent(baseInput, context);

    expect(output.fallbackApplied).toBe(false);
    expect(output.latencyMs).toBeGreaterThan(0);
    expect(output.llmUsage).not.toBeNull();
    expect(output.llmUsage!.agentId).toBe("example-friend");
    expect(output.llmUsage!.simulationId).toBe("sim-123");
    expect(output.llmUsage!.pulseIndex).toBe(42);
    expect(output.llmUsage!.callType).toBe("cognition");
    expect(output.operatorEvents).toHaveLength(1);
    expect(output.operatorEvents[0]!.type).toBe("pulse_metrics");
    expect(output.operatorEvents[0]!.data!.model).toBe("mock-model");

    // Intent checks
    expect(output.intent.actorId).toBe("example-friend");
    expect(output.intent.intentType).toBe("send_message");
    expect(output.intent.visibleContent).toBe("pois é");
  });

  it("should return a fallback intent when budget is exhausted", async () => {
    // Manually block priority in budget
    const runtime = new AgentRuntime();
    const inputWithBlockedPriority: AgentRuntimeInput = {
      ...baseInput,
      budgetPriority: "blocked",
    };

    const output = await runtime.generateIntent(inputWithBlockedPriority, context);

    expect(output.fallbackApplied).toBe(true);
    expect(output.llmUsage).toBeNull();
    expect(output.intent.intentType).toBe("no_op");
    expect(output.intent.privateMotiveSummary).toContain("LLM budget exceeded");
    expect(output.operatorEvents).toHaveLength(1);
    expect(output.operatorEvents[0]!.type).toBe("llm_budget_exceeded");
    expect(output.operatorEvents[0]!.agentId).toBe("example-friend");
    expect(output.operatorEvents[0]!.pulseIndex).toBe(42);
  });

  it("should catch provider errors and return a fallback intent and failure operator event", async () => {
    // Register an OpenAI-compatible config but with a missing baseUrl, which throws LlmConfigurationError!
    const runtime = new AgentRuntime({
      "example-friend": {
        providerType: "qwen3",
        baseUrl: "", // Will throw LlmConfigurationError!
        modelName: "test-model",
      },
    });

    const output = await runtime.generateIntent(baseInput, context);

    expect(output.fallbackApplied).toBe(true);
    expect(output.llmUsage).toBeNull();
    expect(output.intent.intentType).toBe("no_op");
    expect(output.intent.privateMotiveSummary).toContain("Provider failed");
    expect(output.operatorEvents).toHaveLength(1);
    expect(output.operatorEvents[0]!.type).toBe("llm_failure");
    expect(output.operatorEvents[0]!.detail).toContain("Missing baseUrl");
  });

  it("should record token usage and emit an operator event when provider succeeds but parsing/validation fails", async () => {
    const runtime = new AgentRuntime({
      "example-friend": {
        providerType: "qwen3",
        baseUrl: "http://localhost:11434/v1",
        modelName: "test-model",
      },
    });

    // Mock fetch to return non-JSON plain text garbage
    const garbageResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "This is not JSON at all!" } }],
        usage: { prompt_tokens: 50, completion_tokens: 10 },
        model: "garbage-model",
      }),
      headers: new Map(),
    };
    
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(garbageResponse));

    const output = await runtime.generateIntent(baseInput, context);

    expect(output.fallbackApplied).toBe(true);
    expect(output.llmUsage).not.toBeNull();
    expect(output.llmUsage!.inputTokens).toBe(50);
    expect(output.llmUsage!.outputTokens).toBe(10);
    expect(output.intent.intentType).toBe("no_op");
    expect(output.intent.privateMotiveSummary).toContain("Fallback applied: No JSON object found in response");
    expect(output.operatorEvents).toHaveLength(2);
    expect(output.operatorEvents[0]!.type).toBe("pulse_metrics");
    expect(output.operatorEvents[1]!.type).toBe("llm_failure");
    expect(output.operatorEvents[1]!.detail).toContain("LLM parsing or target constraint validation failed");
    expect(output.operatorEvents[1]!.data!.errorDetail).toContain("No JSON object found in response");
  });
});
