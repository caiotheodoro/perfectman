import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OllamaProvider } from "../ollama-provider.js";
import { LlmConfigurationError } from "../llm-errors.js";
import type { AgentRuntimeInput } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../../agent/agent-runtime.types.js";

describe("OllamaProvider", () => {
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

  const baseConfig = {
    providerType: "ollama" as const,
    baseUrl: "http://localhost:11434/v1",
    modelName: "qwen3:1.7b",
    temperature: 0.25,
    maxInputTokens: 4096,
    maxOutputTokens: 600,
    timeoutMs: 5000,
    retryCount: 0,
  };

  const successResponse = () => ({
    ok: true,
    status: 200,
    json: async () => ({
      message: { content: '{"intentType":"no_op"}' },
      prompt_eval_count: 120,
      eval_count: 30,
      model: "qwen3:1.7b",
    }),
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("translates flat extraBody sampling params into nested ollama options", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const provider = new OllamaProvider({
      ...baseConfig,
      extraBody: {
        top_p: 0.95,
        repetition_penalty: 1.1,
        seed: 42,
      },
    });

    await provider.generateIntent(baseInput, context, prompt);

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.options.top_p).toBe(0.95);
    expect(body.options.repeat_penalty).toBe(1.1);
    expect(body.options.seed).toBe(42);
  });

  it("omits sampling options when extraBody does not set them", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const provider = new OllamaProvider({ ...baseConfig });
    await provider.generateIntent(baseInput, context, prompt);

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.options.seed).toBeUndefined();
    expect(body.options.repeat_penalty).toBeUndefined();
    expect(body.options.top_p).toBeUndefined();
  });

  it("does not leak flat sampling params onto the request body root", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const provider = new OllamaProvider({
      ...baseConfig,
      extraBody: { think: false, seed: 7, repetition_penalty: 1.05 },
    });
    await provider.generateIntent(baseInput, context, prompt);

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.seed).toBeUndefined();
    expect(body.repetition_penalty).toBeUndefined();
    expect(body.think).toBe(false);
  });

  it("derives the native /api/chat url from a /v1 base url", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal("fetch", fetchSpy);

    const provider = new OllamaProvider({ ...baseConfig });
    await provider.generateIntent(baseInput, context, prompt);

    expect(fetchSpy.mock.calls[0]![0]).toBe("http://localhost:11434/api/chat");
  });

  it("sets format json only when responseFormatJson is enabled", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal("fetch", fetchSpy);

    await new OllamaProvider({ ...baseConfig }).generateIntent(baseInput, context, prompt);
    let body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.format).toBeUndefined();

    await new OllamaProvider({
      ...baseConfig,
      responseFormatJson: true,
    }).generateIntent(baseInput, context, prompt);
    body = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string);
    expect(body.format).toBe("json");
  });

  it("returns the expected result structure on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(successResponse()));

    const provider = new OllamaProvider({
      ...baseConfig,
      responseFormatJson: true,
    });
    const res = await provider.generateIntent(baseInput, context, prompt);

    expect(res.content).toBe('{"intentType":"no_op"}');
    expect(res.usage.inputTokens).toBe(120);
    expect(res.usage.outputTokens).toBe(30);
    expect(res.model).toBe("qwen3:1.7b");
    expect(res.requestedModel).toBe("qwen3:1.7b");
    expect(res.routedModel).toBe("qwen3:1.7b");
    expect(res.fallbackAttempts).toBe(0);
  });

  it("throws LlmConfigurationError when baseUrl is missing", async () => {
    const provider = new OllamaProvider({ ...baseConfig, baseUrl: "" });
    await expect(provider.generateIntent(baseInput, context, prompt)).rejects.toThrow(
      LlmConfigurationError
    );
  });
});
