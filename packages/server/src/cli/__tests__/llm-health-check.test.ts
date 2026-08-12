import { describe, expect, it, vi } from "vitest";
import {
  assertQwenAvailable,
  assertRequiredLlmServicesAvailable,
} from "../llm-health-check.js";
import type { SimulationAppConfig } from "../../config/simulation-config.js";

function baseConfig(): SimulationAppConfig {
  return {
    simulation: {
      id: "sim",
      name: "Sim",
      seed: 1,
      status: "created",
      settings: {
        omniscientSpectatorMode: false,
        allowPrivateChannels: true,
        maxPrivateChannelsPerAgent: 3,
        maxMessagesPerMinutePerAgent: 30,
        llmCallBudgetPerMinute: 20,
        pulseIntervalMs: 3000,
        tokenBudgetPerHour: 100_000,
      },
      createdAt: 1,
      updatedAt: 1,
    },
    persistence: { type: "memory" },
    debug: {},
    deliveryGateways: [{ id: "mock", type: "mock" }],
    channels: [{
      id: "general",
      type: "public_channel",
      name: "general",
      default: true,
      memberAgentIds: ["ana"],
    }],
    agents: [{
      id: "ana",
      presence: "active",
      persona: {
        id: "ana",
        name: "Ana",
        archetype: "observer",
        writingStyle: "brief",
        styleExamples: [],
      },
      promptProfile: {
        personaId: "ana",
        displayName: "Ana",
        identityFrame: "You are Ana.",
        voiceGuidelines: [],
        styleExamples: { default: [], animated: [], dryOrLowEnergy: [], conflict: [] },
        relationshipBiases: {},
        language: "en",
      },
      llm: {
        providerType: "qwen3_8b",
        baseUrl: "http://localhost:11434/v1",
        modelName: "qwen3:1.7b",
        maxInputTokens: 1024,
        maxOutputTokens: 192,
        temperature: 0.7,
        timeoutMs: 30_000,
        retryCount: 0,
        responseFormatJson: true,
        extraBody: { stream: false },
      },
    }],
  };
}

describe("LLM health checks", () => {
  it("performs a Qwen generation health check", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    await assertQwenAvailable(baseConfig().agents[0]!.llm, { fetch, timeoutMs: 1000 });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe("qwen3:1.7b");
    expect(body.max_tokens).toBe(8);
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
  });

  it("fails Qwen health check when generation returns an Ollama error", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "{\"error\":{\"message\":\"llama runner process has terminated\"}}",
    });

    await expect(
      assertQwenAvailable(baseConfig().agents[0]!.llm, { fetch, timeoutMs: 1000 }),
    ).rejects.toThrow("Qwen service is reachable only if it can complete a tiny generation");
  });

  it("checks each unique Qwen base URL and model once", async () => {
    const config = baseConfig();
    config.agents.push({
      ...config.agents[0]!,
      id: "bruno",
    });
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    await assertRequiredLlmServicesAvailable(config, { fetch, timeoutMs: 1000 });

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
