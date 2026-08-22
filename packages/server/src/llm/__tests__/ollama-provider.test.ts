import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OllamaProvider } from "../ollama-provider.js";
import { LLMConfigurationError } from "../llm-errors.js";
import type { AgentRuntimeContext, BuiltPrompt } from "../../agent/agent-runtime.types.js";
import { ModelIntentPacketJsonSchema } from "@perfectman/shared";

const context: AgentRuntimeContext = { pulseIndex: 1, now: Date.now() };
const prompt: BuiltPrompt = {
  system: "sys",
  user: "user",
  inputTokensEstimate: 10,
  purpose: "action_intent",
  version: "v-test",
  templateVersion: "template-test",
};

const baseInput = {} as never;

function config(overrides: Record<string, unknown> = {}) {
  return {
    providerType: "ollama",
    baseUrl: "http://localhost:11434",
    modelName: "qwen3:8b",
    maxInputTokens: 1000,
    maxOutputTokens: 200,
    temperature: 1,
    timeoutMs: 5000,
    retryCount: 0,
    responseFormatJson: true,
    ...overrides,
  } as never;
}

function okResponse(content: string, overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      message: { content },
      model: "qwen3:8b",
      prompt_eval_count: 20,
      eval_count: 5,
      ...overrides,
    }),
  };
}

describe("OllamaProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns content and uses the schema object as format (not plain \"json\")", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse('{"intentType":"no_op"}'));
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new OllamaProvider(config());
    const res = await provider.generateIntent(baseInput, context, prompt);
    expect(res.content).toContain("no_op");
    const firstBody = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(firstBody.format).not.toBe("json");
  });

  it("falls back to format \"json\" on a 400 schema rejection", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 400, text: async () => "schema unsupported" })
      .mockResolvedValueOnce(okResponse('{"intentType":"no_op","privateMotiveSummary":"s"}'));
    vi.stubGlobal("fetch", fetchSpy);
    const provider = new OllamaProvider(config());
    const res = await provider.generateIntent(baseInput, context, prompt);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const fallbackBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string);
    expect(fallbackBody.format).toBe("json");
    expect(res.content).toContain("no_op");
  });

  it("translates flat extraBody sampling params into nested ollama options", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse('{"intentType":"no_op"}'));
    vi.stubGlobal("fetch", fetchSpy);

    const provider = new OllamaProvider(
      config({ extraBody: { top_p: 0.95, repetition_penalty: 1.1, seed: 42 } }),
    );
    await provider.generateIntent(baseInput, context, prompt);

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.options.top_p).toBe(0.95);
    expect(body.options.repeat_penalty).toBe(1.1);
    expect(body.options.seed).toBe(42);
  });

  it("omits sampling options when extraBody does not set them", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse('{"intentType":"no_op"}'));
    vi.stubGlobal("fetch", fetchSpy);

    const provider = new OllamaProvider(config());
    await provider.generateIntent(baseInput, context, prompt);

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.options.seed).toBeUndefined();
    expect(body.options.repeat_penalty).toBeUndefined();
    expect(body.options.top_p).toBeUndefined();
  });

  it("does not leak flat sampling params onto the request body root", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse('{"intentType":"no_op"}'));
    vi.stubGlobal("fetch", fetchSpy);

    const provider = new OllamaProvider(
      config({ extraBody: { think: false, seed: 7, repetition_penalty: 1.05 } }),
    );
    await provider.generateIntent(baseInput, context, prompt);

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.seed).toBeUndefined();
    expect(body.repetition_penalty).toBeUndefined();
    expect(body.think).toBe(false);
  });

  it("derives the native /api/chat url from a /v1 base url", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse('{"intentType":"no_op"}'));
    vi.stubGlobal("fetch", fetchSpy);

    const provider = new OllamaProvider(config({ baseUrl: "http://localhost:11434/v1" }));
    await provider.generateIntent(baseInput, context, prompt);

    expect(fetchSpy.mock.calls[0]![0]).toBe("http://localhost:11434/api/chat");
  });

  it("sets format only when responseFormatJson is enabled", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse('{"intentType":"no_op"}'));
    vi.stubGlobal("fetch", fetchSpy);

    await new OllamaProvider(config({ responseFormatJson: false })).generateIntent(baseInput, context, prompt);
    let body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.format).toBeUndefined();

    await new OllamaProvider(config({ responseFormatJson: true })).generateIntent(baseInput, context, prompt);
    body = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string);
    expect(body.format).toEqual(ModelIntentPacketJsonSchema);
  });

  it("returns the expected result structure on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse('{"intentType":"no_op"}', { prompt_eval_count: 120, eval_count: 30 })),
    );

    const provider = new OllamaProvider(config({ responseFormatJson: true }));
    const res = await provider.generateIntent(baseInput, context, prompt);

    expect(res.content).toBe('{"intentType":"no_op"}');
    expect(res.usage.inputTokens).toBe(120);
    expect(res.usage.outputTokens).toBe(30);
    expect(res.model).toBe("qwen3:8b");
    expect(res.requestedModel).toBe("qwen3:8b");
    expect(res.routedModel).toBe("qwen3:8b");
    expect(res.fallbackAttempts).toBe(0);
  });

  it("throws LLMConfigurationError when baseUrl is missing", async () => {
    const provider = new OllamaProvider(config({ baseUrl: "" }));
    await expect(provider.generateIntent(baseInput, context, prompt)).rejects.toThrow(
      LLMConfigurationError,
    );
  });
});
