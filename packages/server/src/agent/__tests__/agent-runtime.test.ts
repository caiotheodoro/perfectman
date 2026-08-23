import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AgentRuntime } from "../agent-runtime.js";
import { llmBudget } from "../../llm/llm-budget.js";
import type { AgentRuntimeInput, AvailableAction } from "@perfectman/shared";
import type { AgentRuntimeContext } from "../agent-runtime.types.js";
import { setRepetitionPolicy, getRepetitionPolicy, REPETITION_SIMILARITY_THRESHOLD } from "../repetition-guard.js";

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
      visibleContextEvents: [], ownRecentUtterances: [],
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
    // Register an OpenAI-compatible config but with a missing baseUrl, which throws LLMConfigurationError!
    const runtime = new AgentRuntime({
      "example-friend": {
        providerType: "qwen3",
        baseUrl: "", // Will throw LLMConfigurationError!
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

  describe("repetition guard retry", () => {
    let savedPolicy: ReturnType<typeof getRepetitionPolicy>;
    beforeEach(() => {
      savedPolicy = { ...getRepetitionPolicy() };
    });
    afterEach(() => setRepetitionPolicy(savedPolicy));

    const repeatingInput: AgentRuntimeInput = {
      ...baseInput,
      perceptionPacket: {
        ...baseInput.perceptionPacket,
        ownRecentUtterances: ["kkkkk não acredito nesse take"],
      },
    };

    function jsonResponse(content: string, promptTokens = 50, completionTokens = 10) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({
            id: "intent-1",
            actorId: "example-friend",
            intentType: "send_message",
            channelTarget: "general",
            personTargets: [],
            visibleContent: content,
            privateMotiveSummary: "reacting",
            emotionDrivers: [],
            motivationDrivers: [],
            memoryWrites: [],
          }) } }],
          usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
          model: "test-model",
        }),
        headers: new Map(),
      };
    }

    it("retries once and commits fresh content when the retry is genuinely different", async () => {
      const runtime = new AgentRuntime({
        "example-friend": { providerType: "qwen3", baseUrl: "http://localhost:11434/v1", modelName: "test-model" },
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse("kkkkk não acredito nesse take", 50, 10)) // repeat of ownRecentUtterances
        .mockResolvedValueOnce(jsonResponse("acho que devíamos falar de outra coisa agora", 60, 15)); // genuinely new
      vi.stubGlobal("fetch", fetchMock);

      const output = await runtime.generateIntent(repeatingInput, context);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(output.fallbackApplied).toBe(false);
      expect(output.intent.intentType).toBe("send_message");
      expect(output.intent.visibleContent).toBe("acho que devíamos falar de outra coisa agora");
      // Usage should sum both calls, not just the first.
      expect(output.llmUsage!.inputTokens).toBe(110);
      expect(output.llmUsage!.outputTokens).toBe(25);
      // No intent_blocked event — the retry recovered real content.
      expect(output.operatorEvents.some(e => e.type === "intent_blocked")).toBe(false);
    });

    it("falls back to no_op when the retry also repeats", async () => {
      const runtime = new AgentRuntime({
        "example-friend": { providerType: "qwen3", baseUrl: "http://localhost:11434/v1", modelName: "test-model" },
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse("kkkkk não acredito nesse take", 50, 10))
        .mockResolvedValueOnce(jsonResponse("kkkkk não acredito nesse take", 40, 8)); // still a repeat
      vi.stubGlobal("fetch", fetchMock);

      const output = await runtime.generateIntent(repeatingInput, context);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(output.fallbackApplied).toBe(true);
      expect(output.intent.intentType).toBe("no_op");
      expect(output.intent.privateMotiveSummary).toContain("Repetition guard");
      expect(output.intent.privateMotiveSummary).toContain("after 1 retry attempt(s)");
      expect(output.operatorEvents.some(e => e.type === "intent_blocked")).toBe(true);
    });

    it("honors maxRetries=2: recovers on the second retry after two repeats", async () => {
      setRepetitionPolicy({ threshold: 0.7, maxRetries: 2 });
      const runtime = new AgentRuntime({
        "example-friend": { providerType: "qwen3", baseUrl: "http://localhost:11434/v1", modelName: "test-model" },
      });
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(jsonResponse("kkkkk não acredito nesse take", 50, 10))
        .mockResolvedValueOnce(jsonResponse("kkkkk não acredito nesse take mesmo", 40, 8))
        .mockResolvedValueOnce(jsonResponse("vou mudar de assunto então", 30, 12));
      vi.stubGlobal("fetch", fetchMock);

      const output = await runtime.generateIntent(repeatingInput, context);

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(output.fallbackApplied).toBe(false);
      expect(output.intent.visibleContent).toBe("vou mudar de assunto então");
    });

    it("blocks immediately with zero retry budget (single provider call)", async () => {
      setRepetitionPolicy({ threshold: 0.7, maxRetries: 0 });
      const runtime = new AgentRuntime({
        "example-friend": { providerType: "qwen3", baseUrl: "http://localhost:11434/v1", modelName: "test-model" },
      });
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse("kkkkk não acredito nesse take"));
      vi.stubGlobal("fetch", fetchMock);

      const output = await runtime.generateIntent(repeatingInput, context);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output.fallbackApplied).toBe(true);
      expect(output.intent.privateMotiveSummary).toContain("without any retry attempt");
    });

    it("routes a budget-denied retry through llm_failure, not intent_blocked", async () => {
      setRepetitionPolicy({ threshold: 0.7, maxRetries: 2 });
      const runtime = new AgentRuntime({
        "example-friend": { providerType: "qwen3", baseUrl: "http://localhost:11434/v1", modelName: "test-model" },
      });
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse("kkkkk não acredito nesse take", 50, 10));
      vi.stubGlobal("fetch", fetchMock);
      // First canCall (main attempt) allows; the retry re-check denies.
      let canCalls = 0;
      const canCallSpy = vi.spyOn(llmBudget, "canCall").mockImplementation((req) => {
        canCalls++;
        return canCalls === 1
          ? { allowed: true, reason: undefined, priority: req.priority }
          : { allowed: false, reason: "token budget exhausted", priority: req.priority };
      });

      const output = await runtime.generateIntent(repeatingInput, context);

      expect(fetchMock).toHaveBeenCalledTimes(1); // denied before any retry wire call
      expect(canCallSpy).toHaveBeenCalledTimes(2);
      expect(output.intent.intentType).toBe("no_op");
      const kinds = output.operatorEvents.map(e => e.type);
      expect(kinds).not.toContain("intent_blocked");
      expect(kinds).toContain("llm_failure");
      const failureDetail = JSON.stringify(output.operatorEvents.find(e => e.type === "llm_failure"));
      expect(failureDetail).toContain("budget exhausted");
      canCallSpy.mockRestore();
    });

    it("honors a stricter threshold: a loose near-match passes when raised", async () => {
      // "kkkkk não acredito nesse take mesmo" sits at Jaccard ~5/6: blocks
      // at the default 0.7 but passes at 0.99 — proving the knob is plumbed.
      setRepetitionPolicy({ threshold: 0.99, maxRetries: 1 });
      const runtime = new AgentRuntime({
        "example-friend": { providerType: "qwen3", baseUrl: "http://localhost:11434/v1", modelName: "test-model" },
      });
      const borderline = "kkkkk não acredito nesse take mesmo";
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(borderline));
      vi.stubGlobal("fetch", fetchMock);

      const output = await runtime.generateIntent(repeatingInput, context);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(output.fallbackApplied).toBe(false);
      expect(output.intent.visibleContent).toBe(borderline);
    });
  });
});
