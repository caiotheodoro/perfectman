import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OpenAiCompatibleProvider } from "../openai-compatible-provider.js";
import { LLMTimeoutError, LLMHttpError, LLMConfigurationError, LLMResponseError } from "../llm-errors.js";
import type { AgentRuntimeInput } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../../agent/agent-runtime.types.js";

describe("OpenAiCompatibleProvider", () => {
  const context: AgentRuntimeContext = {
    pulseIndex: 10,
    now: Date.now(),
  };

  const prompt: BuiltPrompt = {
    system: "system prompt",
    user: "user prompt",
    inputTokensEstimate: 100,
  };

  const availableActions = [
    { intentType: "send_message", channelTargets: ["general"], personTargets: [], blocked: false }
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
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should successfully execute completions and return expected result structure", async () => {
    const mockJson = {
      choices: [{ message: { content: '{"intentType":"no_op"}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
      model: "google/gemini-2.5-flash",
    };

    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => mockJson,
      headers: new Map([
        ["x-routed-model", "gemini-flash-routed"],
        ["x-fallback-attempts", "0"]
      ]),
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const provider = new OpenAiCompatibleProvider({
      providerType: "freellmapi",
      baseUrl: "http://localhost:3001/v1",
      modelName: "gemini/gemini-2.5-flash",
      temperature: 0.7,
      maxInputTokens: 1000,
      maxOutputTokens: 200,
      timeoutMs: 5000,
      retryCount: 2,
    });

    const res = await provider.generateIntent(baseInput, context, prompt);

    expect(res.content).toBe('{"intentType":"no_op"}');
    expect(res.usage.inputTokens).toBe(120);
    expect(res.usage.outputTokens).toBe(30);
    expect(res.model).toBe("google/gemini-2.5-flash");
    expect(res.requestedModel).toBe("gemini/gemini-2.5-flash");
    expect(res.routedModel).toBe("gemini-flash-routed");
    expect(res.fallbackAttempts).toBe(0);
  });

  it("should throw LLMConfigurationError when baseUrl is missing", async () => {
    const provider = new OpenAiCompatibleProvider({
      providerType: "freellmapi",
      baseUrl: "", // missing
      modelName: "gemini",
      temperature: 0.7,
      maxInputTokens: 1000,
      maxOutputTokens: 200,
      timeoutMs: 5000,
      retryCount: 2,
    });

    await expect(provider.generateIntent(baseInput, context, prompt)).rejects.toThrow(LLMConfigurationError);
  });

  it("should throw LLMHttpError on non-2xx status code", async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    };

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const provider = new OpenAiCompatibleProvider({
      providerType: "freellmapi",
      baseUrl: "http://localhost:3001/v1",
      modelName: "gemini",
      temperature: 0.7,
      maxInputTokens: 1000,
      maxOutputTokens: 200,
      timeoutMs: 5000,
      retryCount: 0, // no retries
    });

    await expect(provider.generateIntent(baseInput, context, prompt)).rejects.toThrow(LLMHttpError);
  });

  it("should abort and throw LLMTimeoutError when request times out", async () => {
    // Mock fetch that throws AbortError (DOMException)
    const abortError = new DOMException("The user aborted a request.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    const provider = new OpenAiCompatibleProvider({
      providerType: "freellmapi",
      baseUrl: "http://localhost:3001/v1",
      modelName: "gemini",
      temperature: 0.7,
      maxInputTokens: 1000,
      maxOutputTokens: 200,
      timeoutMs: 100, // small timeout
      retryCount: 0,
    });

    await expect(provider.generateIntent(baseInput, context, prompt)).rejects.toThrow(LLMTimeoutError);
  });

  it("should include response_format only when explicitly enabled", async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        model: "test-model",
      }),
      headers: new Map(),
    };

    const fetchSpy = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal("fetch", fetchSpy);

    const provider = new OpenAiCompatibleProvider({
      providerType: "qwen3",
      baseUrl: "http://localhost:11434/v1",
      modelName: "qwen3:8b",
      temperature: 0.7,
      maxInputTokens: 1000,
      maxOutputTokens: 200,
      timeoutMs: 5000,
      retryCount: 0,
    });

    await provider.generateIntent(baseInput, context, prompt);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.response_format).toBeUndefined();

    fetchSpy.mockClear();
    const jsonProvider = new OpenAiCompatibleProvider({
      providerType: "freellmapi",
      baseUrl: "http://localhost:3001/v1",
      modelName: "auto",
      temperature: 0.7,
      maxInputTokens: 1000,
      maxOutputTokens: 200,
      timeoutMs: 5000,
      retryCount: 0,
      responseFormatJson: true,
    });

    await jsonProvider.generateIntent(baseInput, context, prompt);
    const jsonBody = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    // default: shape-constrained json_schema decoding
    expect(jsonBody.response_format.type).toBe("json_schema");
    expect(jsonBody.response_format.json_schema.name).toBe("intent_packet");
    expect(jsonBody.response_format.json_schema.schema.required).toEqual(["intentType", "privateMotiveSummary"]);
  });

  it("forces syntax-only json_object when responseFormatJsonSchema is false", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: '{"intentType":"no_op"}' } }], model: "test" }),
      headers: new Map(),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new OpenAiCompatibleProvider({
      providerType: "freellmapi", baseUrl: "http://localhost:3001/v1", modelName: "auto",
      temperature: 0.7, maxInputTokens: 1000, maxOutputTokens: 200, timeoutMs: 5000, retryCount: 0,
      responseFormatJson: true, responseFormatJsonSchema: false,
    });
    await provider.generateIntent(baseInput, context, prompt);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("falls back to json_object on a 400 json_schema rejection", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => "schema not supported" })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ choices: [{ message: { content: '{"intentType":"no_op","privateMotiveSummary":"s"}' } }], model: "test" }),
        headers: new Map(),
      });
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new OpenAiCompatibleProvider({
      providerType: "freellmapi", baseUrl: "http://localhost:3001/v1", modelName: "auto",
      temperature: 0.7, maxInputTokens: 1000, maxOutputTokens: 200, timeoutMs: 5000, retryCount: 0,
      responseFormatJson: true,
    });
    await provider.generateIntent(baseInput, context, prompt);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const fallbackBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string);
    expect(fallbackBody.response_format).toEqual({ type: "json_object" });
  });

  it("should fail fast on malformed OpenAI-compatible response shape", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [], model: "broken-model" }),
      headers: new Map(),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const provider = new OpenAiCompatibleProvider({
      providerType: "freellmapi",
      baseUrl: "http://localhost:3001/v1",
      modelName: "gemini",
      temperature: 0.7,
      maxInputTokens: 1000,
      maxOutputTokens: 200,
      timeoutMs: 5000,
      retryCount: 2,
    });

    await expect(provider.generateIntent(baseInput, context, prompt)).rejects.toThrow(LLMResponseError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("should retry transient errors (like 429) up to retryCount", async () => {
    const errorResponse = {
      ok: false,
      status: 429,
      text: async () => "Rate Limit Exceeded",
    };

    const mockJson = {
      choices: [{ message: { content: '{"intentType":"no_op"}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 30 },
      model: "google/gemini-2.5-flash",
    };

    const successResponse = {
      ok: true,
      status: 200,
      json: async () => mockJson,
      headers: new Map(),
    };

    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(errorResponse)
      .mockResolvedValueOnce(successResponse);

    vi.stubGlobal("fetch", fetchSpy);

    const provider = new OpenAiCompatibleProvider({
      providerType: "freellmapi",
      baseUrl: "http://localhost:3001/v1",
      modelName: "gemini",
      temperature: 0.7,
      maxInputTokens: 1000,
      maxOutputTokens: 200,
      timeoutMs: 5000,
      retryCount: 2, // 2 retries (3 total attempts allowed)
    });

    const res = await provider.generateIntent(baseInput, context, prompt);

    expect(res.content).toBe('{"intentType":"no_op"}');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});
