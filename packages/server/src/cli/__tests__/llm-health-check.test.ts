import { describe, expect, it, vi } from "vitest";
import {
  assertQwenAvailable,
  assertRequiredLLMServicesAvailable,
} from "../llm-health-check.js";
import { generateOpenAiCompatibleIntent } from "../../llm/sdk-transport.js";
import type { SimulationAppConfig } from "../../config/simulation-config.js";
import type { BuiltPrompt } from "../../agent/agent-runtime.types.js";

const driftGuardPrompt: BuiltPrompt = {
  system: "Return only JSON.",
  user: "Return {\"ok\":true}.",
  inputTokensEstimate: 10,
  purpose: "action_intent",
  version: "v-test",
  templateVersion: "template-test",
};

function okJsonResponse(content: string): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }], model: "m" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

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
        providerType: "openai-compatible",
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
      text: async () => JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }),
    });

    const cfg = baseConfig();
    cfg.agents[0]!.llm.extraBody = { thinking: { type: "disabled" }, seed: 7 };
    await assertQwenAvailable(cfg.agents[0]!.llm, { fetch, timeoutMs: 1000 });

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
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.seed).toBe(7);
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
      text: async () => JSON.stringify({ choices: [{ message: { content: "{\"ok\":true}" } }] }),
    });

    await assertRequiredLLMServicesAvailable(config, { fetch, timeoutMs: 1000 });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails the health check when an OK response carries no parseable JSON object", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ choices: [{ message: { content: "" } }] }),
    });

    const err = await assertQwenAvailable(baseConfig().agents[0]!.llm, { fetch, timeoutMs: 1000 })
      .then(() => undefined)
      .catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(/reasoning/i);
    expect(err!.message).toMatch(/disabl/i);
    expect(err!.message).toContain("extraBody");
    expect(err!.message).toContain('{ "thinking": { "type": "disabled" } }');

    const proseFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "Let me think about this..." } }] }),
    });
    await expect(
      assertQwenAvailable(baseConfig().agents[0]!.llm, { fetch: proseFetch, timeoutMs: 1000 }),
    ).rejects.toThrow(/reasoning/i);
  });

  it("does not bury the reasoning-overflow cause under the generic health-check hint", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: "Let me think about this..." } }] }),
    });

    const err = await assertQwenAvailable(baseConfig().agents[0]!.llm, { fetch, timeoutMs: 1000 })
      .then(() => undefined)
      .catch((e: unknown) => e as Error);

    expect(err).toBeInstanceOf(Error);
    expect(err!.message).not.toContain("Check the baseUrl, modelName, and API key");
    expect(err!.message).not.toMatch(/^Qwen service is reachable only if/);
  });

  it("passes the health check when OK response content embeds a parseable JSON object", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content: 'prefix noise {"ok":true} trailing' } }] }),
    });

    await expect(
      assertQwenAvailable(baseConfig().agents[0]!.llm, { fetch, timeoutMs: 1000 }),
    ).resolves.toBeUndefined();
  });

  it("keeps the preflight probe body and the runtime intent body in agreement on reasoning and sampling fields", async () => {
    const cfg = baseConfig();
    cfg.agents[0]!.llm.extraBody = { thinking: { type: "disabled" }, seed: 5, top_p: 0.8 };
    const llm = cfg.agents[0]!.llm;

    const runtimeFetch = vi.fn().mockResolvedValue(okJsonResponse('{"intentType":"no_op","privateMotiveSummary":"s"}'));
    await generateOpenAiCompatibleIntent(llm, driftGuardPrompt, Date.now(), { fetch: runtimeFetch });

    const probeFetch = vi.fn().mockResolvedValue(okJsonResponse('{"ok":true}'));
    await assertQwenAvailable(llm, { fetch: probeFetch, timeoutMs: 1000 });

    const runtimeBody = JSON.parse(runtimeFetch.mock.calls[0]![1]!.body as string);
    const probeBody = JSON.parse(probeFetch.mock.calls[0]![1]!.body as string);

    expect(runtimeBody.thinking).toEqual({ type: "disabled" });
    expect(probeBody.thinking).toEqual(runtimeBody.thinking);
    expect(probeBody.seed).toEqual(runtimeBody.seed);
    expect(probeBody.top_p).toEqual(runtimeBody.top_p);
  });

  it("agrees that no reasoning field is present when the config has no extraBody", async () => {
    const cfg = baseConfig();
    delete cfg.agents[0]!.llm.extraBody;
    const llm = cfg.agents[0]!.llm;

    const runtimeFetch = vi.fn().mockResolvedValue(okJsonResponse('{"intentType":"no_op","privateMotiveSummary":"s"}'));
    await generateOpenAiCompatibleIntent(llm, driftGuardPrompt, Date.now(), { fetch: runtimeFetch });

    const probeFetch = vi.fn().mockResolvedValue(okJsonResponse('{"ok":true}'));
    await assertQwenAvailable(llm, { fetch: probeFetch, timeoutMs: 1000 });

    const runtimeBody = JSON.parse(runtimeFetch.mock.calls[0]![1]!.body as string);
    const probeBody = JSON.parse(probeFetch.mock.calls[0]![1]!.body as string);

    expect(runtimeBody.thinking).toBeUndefined();
    expect(probeBody.thinking).toBeUndefined();
  });

  it("probes the native /api/chat endpoint for ollama-shaped configs", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });
    const llm: SimulationAppConfig["agents"][number]["llm"] = {
      ...baseConfig().agents[0]!.llm,
      providerType: "ollama",
    };

    await assertQwenAvailable(llm, { fetch, timeoutMs: 1000 });

    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = JSON.parse(fetch.mock.calls[0]![1]!.body as string);
    expect(body.model).toBe("qwen3:1.7b");
    expect(body.options).toEqual({ num_predict: 8 });
    expect(body.think).toBe(false);
    expect(body.stream).toBe(false);
  });
});
