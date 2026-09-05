import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildOpenAiCompatibleRequestBody,
  generateOpenAiCompatibleIntent,
  generateOllamaIntent,
} from "../sdk-transport.js";
import {
  LLMConfigurationError,
  LLMError,
  LLMHttpError,
  LLMResponseError,
  LLMTimeoutError,
} from "../llm-errors.js";
import type { LLMConfig } from "../llm-config.js";
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

function openAiConfig(overrides: Record<string, unknown> = {}): LLMConfig {
  return {
    providerType: "openai-compatible",
    baseUrl: "http://localhost:3001/v1",
    modelName: "gemini/gemini-2.5-flash",
    maxInputTokens: 1000,
    maxOutputTokens: 200,
    temperature: 0.7,
    timeoutMs: 5000,
    retryCount: 0,
    ...overrides,
  } as LLMConfig;
}

function ollamaConfig(overrides: Record<string, unknown> = {}): LLMConfig {
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
  } as LLMConfig;
}

function openAiOkResponse(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function ollamaOkResponse(content: string, overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({ message: { content }, model: "qwen3:8b", prompt_eval_count: 20, eval_count: 5, ...overrides }),
    { status: 200 },
  );
}

/** A fetch stub whose response body never emits chunks (headers resolve, body hangs). */
function hangingBodyFetch() {
  return vi.fn().mockResolvedValue(
    new Response(new ReadableStream<Uint8Array>({ pull() {} }), { status: 200 }),
  );
}

/** A fetch stub whose response body emits one chunk, then stalls mid-stream. */
function chunkThenHangFetch() {
  const encoder = new TextEncoder();
  return vi.fn().mockResolvedValue(
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"choices":'));
        },
      }),
      { status: 200 },
    ),
  );
}

const startTime = () => Date.now() - 100;

describe("sdk-transport OpenAI-compatible path", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the expected result structure with usage, latency, model, and routed headers", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      openAiOkResponse(
        {
          choices: [{ message: { content: '{"intentType":"no_op"}' } }],
          usage: { prompt_tokens: 120, completion_tokens: 30 },
          model: "google/gemini-2.5-flash",
        },
        {
          "x-routed-model": "gemini-flash-routed",
          "X-FALLBACK-ATTEMPTS": "0",
          "x-extra": "v",
        },
      ),
    );

    const res = await generateOpenAiCompatibleIntent(
      openAiConfig({ apiKeyEnv: "TEST_API_KEY" }),
      prompt,
      startTime(),
      { fetch: fetchSpy, env: { TEST_API_KEY: "secret" } },
    );

    expect(res.content).toBe('{"intentType":"no_op"}');
    expect(res.usage.inputTokens).toBe(120);
    expect(res.usage.outputTokens).toBe(30);
    expect(res.model).toBe("google/gemini-2.5-flash");
    expect(res.requestedModel).toBe("gemini/gemini-2.5-flash");
    expect(res.routedModel).toBe("gemini-flash-routed");
    expect(res.fallbackAttempts).toBe(0);
    expect(res.latencyMs).toBeGreaterThanOrEqual(100);
    expect(res.responseHeaders).toEqual({
      "content-type": "application/json",
      "x-routed-model": "gemini-flash-routed",
      "x-fallback-attempts": "0",
      "x-extra": "v",
    });
  });

  it("builds the OpenAI-compatible request shape: URL, Bearer, messages, json_schema", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      openAiOkResponse({ choices: [{ message: { content: "{}" } }], model: "m" }),
    );

    await generateOpenAiCompatibleIntent(
      openAiConfig({ apiKeyEnv: "TEST_API_KEY", responseFormatJson: true }),
      prompt,
      startTime(),
      { fetch: fetchSpy, env: { TEST_API_KEY: "secret" } },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://localhost:3001/v1/chat/completions");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("gemini/gemini-2.5-flash");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ]);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("intent_packet");
    expect(body.response_format.json_schema.strict).toBe(false);
    expect(body.response_format.json_schema.schema.required).toEqual(["intentType", "privateMotiveSummary"]);
  });

  it("omits the Authorization header when no apiKeyEnv is configured", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(openAiOkResponse({ choices: [{ message: { content: "{}" } }], model: "m" }));

    await generateOpenAiCompatibleIntent(openAiConfig(), prompt, startTime(), { fetch: fetchSpy });

    const [, init] = fetchSpy.mock.calls[0]!;
    expect(new Headers(init.headers).has("authorization")).toBe(false);
  });

  it("spreads extraBody onto the request body root", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(openAiOkResponse({ choices: [{ message: { content: "{}" } }], model: "m" }));

    await generateOpenAiCompatibleIntent(
      openAiConfig({ extraBody: { custom_flag: true, seed: 7, thinking: { type: "disabled" } } }),
      prompt,
      startTime(),
      { fetch: fetchSpy },
    );

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.custom_flag).toBe(true);
    expect(body.seed).toBe(7);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("sends no response_format when responseFormatJson is not enabled", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(openAiOkResponse({ choices: [{ message: { content: "{}" } }], model: "m" }));

    await generateOpenAiCompatibleIntent(openAiConfig(), prompt, startTime(), { fetch: fetchSpy });

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.response_format).toBeUndefined();
  });

  it("forces json_object from the start when responseFormatJsonSchema is false", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(openAiOkResponse({ choices: [{ message: { content: "{}" } }], model: "m" }));

    await generateOpenAiCompatibleIntent(
      openAiConfig({ responseFormatJson: true, responseFormatJsonSchema: false }),
      prompt,
      startTime(),
      { fetch: fetchSpy },
    );

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  // 503 root-caused via a live probe against OrcaRouter's free deepseek-v4
  // route: a strict json_schema request consistently 503s ("upstream
  // provider is temporarily unavailable") while the identical request with
  // response_format:json_object succeeds — the free tier rejects
  // schema-constrained decoding specifically and signals it via 503 instead
  // of 400/422.
  it.each([400, 422, 503])(
    "falls back to json_object on a %i json_schema rejection on the same budget slot",
    async (status) => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(new Response("schema not supported", { status }))
        .mockResolvedValueOnce(
          openAiOkResponse({ choices: [{ message: { content: '{"intentType":"no_op","privateMotiveSummary":"s"}' } }], model: "m" }),
        );

      const res = await generateOpenAiCompatibleIntent(
        openAiConfig({ responseFormatJson: true }),
        prompt,
        startTime(),
        { fetch: fetchSpy },
      );

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const fallbackBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string);
      expect(fallbackBody.response_format).toEqual({ type: "json_object" });
      // The fallback does not consume the single attempt budget.
      expect(res.fallbackAttempts).toBe(0);
    },
  );

  it("retries transient 429 errors up to retryCount", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(new Response("Rate Limit Exceeded", { status: 429 }))
      .mockResolvedValueOnce(new Response("Rate Limit Exceeded", { status: 429 }))
      .mockResolvedValueOnce(openAiOkResponse({ choices: [{ message: { content: "{}" } }], model: "m" }));

    const res = await generateOpenAiCompatibleIntent(
      openAiConfig({ retryCount: 2 }),
      prompt,
      startTime(),
      { fetch: fetchSpy },
    );

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(res.fallbackAttempts).toBe(2);
  });

  it("maps a 500 response to LLMHttpError with the status", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("Internal Server Error", { status: 500 }));

    const err = await generateOpenAiCompatibleIntent(
      openAiConfig({ retryCount: 1 }),
      prompt,
      startTime(),
      { fetch: fetchSpy },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMHttpError);
  });

  it.each([
    ["abort", () => vi.fn().mockRejectedValue(new DOMException("The user aborted a request.", "AbortError"))],
    ["body-read hang", () => hangingBodyFetch()],
    ["never-settling fetch", () => vi.fn().mockReturnValue(new Promise(() => {}))],
  ] as const)("times out a %s as LLMTimeoutError", async (_label, makeFetch) => {
    const fetchSpy = makeFetch();
    await expect(
      generateOpenAiCompatibleIntent(openAiConfig({ timeoutMs: 50 }), prompt, startTime(), { fetch: fetchSpy }),
    ).rejects.toThrow(LLMTimeoutError);
  });

  it("times out a chunk-then-stall body as LLMTimeoutError without releasing the deadline", async () => {
    const fetchSpy = chunkThenHangFetch();

    await expect(
      generateOpenAiCompatibleIntent(openAiConfig({ timeoutMs: 50 }), prompt, startTime(), { fetch: fetchSpy }),
    ).rejects.toThrow(LLMTimeoutError);

    // The body deadline covers the whole read, so a mid-body stall trips it
    // and aborts the in-flight connection; the timed-out attempt is the only
    // request (a body-read timeout never consumes a retry slot).
    const [, init] = fetchSpy.mock.calls[0]!;
    expect((init as RequestInit).signal?.aborted).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["apiKeyEnv set but absent from the env", { apiKeyEnv: "MISSING_KEY" }, { fetch: vi.fn(), env: {} }],
    ["baseUrl missing", { baseUrl: "" }, { fetch: vi.fn() }],
  ] as const)(
    "throws LLMConfigurationError before any request when %s",
    async (_label, configOverrides, deps) => {
      await expect(
        generateOpenAiCompatibleIntent(openAiConfig(configOverrides), prompt, startTime(), deps),
      ).rejects.toThrow(LLMConfigurationError);
      const fetchSpy = deps.fetch as ReturnType<typeof vi.fn>;
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["malformed shape (empty choices)", { choices: [], model: "broken-model" }, 2],
    ["null completion content", { choices: [{ message: { content: null } }], model: "m" }, 0],
  ] as const)(
    "fails fast with LLMResponseError on %s",
    async (_label, responseBody, retryCount) => {
      const fetchSpy = vi.fn().mockResolvedValue(openAiOkResponse(responseBody));

      await expect(
        generateOpenAiCompatibleIntent(openAiConfig({ retryCount }), prompt, startTime(), { fetch: fetchSpy }),
      ).rejects.toThrow(LLMResponseError);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );

  it("falls back to the input-token estimate when usage is absent", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      openAiOkResponse({ choices: [{ message: { content: '{"intentType":"no_op"}' } }], model: "m" }),
    );

    const res = await generateOpenAiCompatibleIntent(openAiConfig(), prompt, startTime(), { fetch: fetchSpy });

    expect(res.usage.inputTokens).toBe(prompt.inputTokensEstimate);
    expect(res.usage.outputTokens).toBe(0);
    expect(res.model).toBe("m");
  });

  it("maps an unparseable 200 body to a transient LLMError", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("not json at all", { status: 200 }));

    await expect(
      generateOpenAiCompatibleIntent(openAiConfig(), prompt, startTime(), { fetch: fetchSpy }),
    ).rejects.toThrow(LLMError);
  });
});

describe("buildOpenAiCompatibleRequestBody", () => {
  const probeMessages = [
    { role: "system", content: "sys" },
    { role: "user", content: "user" },
  ];

  it("spreads reasoning-disable and sampling extraBody entries onto the body root", () => {
    const body = buildOpenAiCompatibleRequestBody(
      openAiConfig({ extraBody: { thinking: { type: "disabled" }, seed: 7, top_p: 0.9 } }),
      probeMessages,
      8,
    );

    expect(body).toEqual({
      model: "gemini/gemini-2.5-flash",
      messages: probeMessages,
      stream: false,
      max_tokens: 8,
      temperature: 0.7,
      thinking: { type: "disabled" },
      seed: 7,
      top_p: 0.9,
    });
  });

  it("adds no reasoning-control field when the config has no extraBody", () => {
    const body = buildOpenAiCompatibleRequestBody(openAiConfig(), probeMessages, 8);

    expect(body).toEqual({
      model: "gemini/gemini-2.5-flash",
      messages: probeMessages,
      stream: false,
      max_tokens: 8,
      temperature: 0.7,
    });
    expect(body).not.toHaveProperty("thinking");
    expect(body).not.toHaveProperty("think");
    expect(body).not.toHaveProperty("response_format");
  });

  it("keeps the reasoning-disable entry at the body root through a proxy-style baseUrl", () => {
    const body = buildOpenAiCompatibleRequestBody(
      openAiConfig({
        baseUrl: "https://api.freellmapi.com/v1",
        extraBody: { thinking: { type: "disabled" } },
      }),
      probeMessages,
      8,
    );

    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("lets an extraBody max_tokens override the passed cap via spread order", () => {
    const body = buildOpenAiCompatibleRequestBody(
      openAiConfig({ extraBody: { max_tokens: 4096 } }),
      probeMessages,
      8,
    );

    expect(body.max_tokens).toBe(4096);
  });

  it("passes an empty messages array through unchanged", () => {
    const body = buildOpenAiCompatibleRequestBody(openAiConfig(), [], 8);

    expect(body.messages).toEqual([]);
  });
});

describe("sdk-transport Ollama native path", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("derives the /api/chat URL from a /v1 base url and builds the native request shape", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(ollamaOkResponse('{"intentType":"no_op"}'));

    await generateOllamaIntent(
      ollamaConfig({
        baseUrl: "http://localhost:11434/v1",
        extraBody: { think: false, top_p: 0.95, repetition_penalty: 1.1, seed: 42 },
      }),
      prompt,
      startTime(),
      { fetch: fetchSpy },
    );

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/api/chat");

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("qwen3:8b");
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ]);
    expect(body.stream).toBe(false);
    expect(body.think).toBe(false);
    expect(body.options.num_predict).toBe(200);
    expect(body.options.temperature).toBe(1);
    expect(body.options.top_p).toBe(0.95);
    expect(body.options.repeat_penalty).toBe(1.1);
    expect(body.options.seed).toBe(42);
    // The schema object is the format (not plain "json").
    expect(body.format).toEqual(ModelIntentPacketJsonSchema);
  });

  it("maps flat sampling params into nested options without leaking them to the root", async () => {
    const fetchSpy = vi.fn((_url: unknown, _init: unknown) => ollamaOkResponse('{"intentType":"no_op"}'));

    await generateOllamaIntent(ollamaConfig(), prompt, startTime(), { fetch: fetchSpy });

    const plainBody = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(plainBody.options.seed).toBeUndefined();
    expect(plainBody.options.repeat_penalty).toBeUndefined();
    expect(plainBody.options.top_p).toBeUndefined();

    await generateOllamaIntent(
      ollamaConfig({ extraBody: { think: false, seed: 7, repetition_penalty: 1.05, top_p: 0.9 } }),
      prompt,
      startTime(),
      { fetch: fetchSpy },
    );

    const fullBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string);
    expect(fullBody.options.seed).toBe(7);
    expect(fullBody.options.repeat_penalty).toBe(1.05);
    expect(fullBody.options.top_p).toBe(0.9);
    expect(fullBody.seed).toBeUndefined();
    expect(fullBody.repetition_penalty).toBeUndefined();
    expect(fullBody.top_p).toBeUndefined();
    expect(fullBody.think).toBe(false);
  });

  it("omits the format key when responseFormatJson is not enabled", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(ollamaOkResponse('{"intentType":"no_op"}'));

    await generateOllamaIntent(
      ollamaConfig({ responseFormatJson: false }),
      prompt,
      startTime(),
      { fetch: fetchSpy },
    );

    const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
    expect(body.format).toBeUndefined();
  });

  it.each([400, 422])(
    "falls back to format \"json\" on a %i schema rejection on the same budget slot",
    async (status) => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(new Response("schema unsupported", { status }))
        .mockResolvedValueOnce(ollamaOkResponse('{"intentType":"no_op","privateMotiveSummary":"s"}'));

      const res = await generateOllamaIntent(ollamaConfig(), prompt, startTime(), { fetch: fetchSpy });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const fallbackBody = JSON.parse(fetchSpy.mock.calls[1]![1]!.body as string);
      expect(fallbackBody.format).toBe("json");
      expect(res.fallbackAttempts).toBe(0);
    },
  );

  it("maps non-2xx responses to LLMHttpError", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));

    const err = await generateOllamaIntent(
      ollamaConfig({ retryCount: 1 }),
      prompt,
      startTime(),
      { fetch: fetchSpy },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LLMHttpError);
  });

  it.each([
    ["abort", () => vi.fn().mockRejectedValue(new DOMException("The user aborted a request.", "AbortError"))],
    ["body-read hang", () => hangingBodyFetch()],
    ["chunk-then-stall body", () => chunkThenHangFetch()],
  ] as const)("times out a %s as LLMTimeoutError", async (_label, makeFetch) => {
    const fetchSpy = makeFetch();
    await expect(
      generateOllamaIntent(ollamaConfig({ timeoutMs: 50 }), prompt, startTime(), { fetch: fetchSpy }),
    ).rejects.toThrow(LLMTimeoutError);
  });

  it("throws LLMConfigurationError before any request when baseUrl is missing", async () => {
    const fetchSpy = vi.fn();

    await expect(
      generateOllamaIntent(ollamaConfig({ baseUrl: "" }), prompt, startTime(), { fetch: fetchSpy }),
    ).rejects.toThrow(LLMConfigurationError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the expected result structure on success", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(ollamaOkResponse('{"intentType":"no_op"}', { prompt_eval_count: 120, eval_count: 30 }));

    const res = await generateOllamaIntent(ollamaConfig(), prompt, startTime(), { fetch: fetchSpy });

    expect(res.content).toBe('{"intentType":"no_op"}');
    expect(res.usage.inputTokens).toBe(120);
    expect(res.usage.outputTokens).toBe(30);
    expect(res.model).toBe("qwen3:8b");
    expect(res.requestedModel).toBe("qwen3:8b");
    expect(res.routedModel).toBe("qwen3:8b");
    expect(res.fallbackAttempts).toBe(0);
    expect(res.responseHeaders).toEqual({});
  });

  it("falls back to the input-token estimate when usage fields are absent", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "{}" }, model: "qwen3:8b" }), { status: 200 }),
    );

    const res = await generateOllamaIntent(ollamaConfig(), prompt, startTime(), { fetch: fetchSpy });

    expect(res.usage.inputTokens).toBe(prompt.inputTokensEstimate);
    expect(res.usage.outputTokens).toBe(0);
  });
});