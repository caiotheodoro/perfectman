import { describe, it, expect, afterEach, vi } from "vitest";
import {
  chatCompletion,
  ChatCompletionError,
  ChatCompletionHttpError,
  ChatCompletionTimeoutError,
} from "../llm/chat-completion.js";

const opts = {
  baseUrl: "http://judge-host/v1",
  model: "qwen3:8b",
  label: "Test caller",
  messages: [{ role: "system" as const, content: "sys" }, { role: "user" as const, content: "user" }],
  temperature: 0,
  maxTokens: 800,
};

function fetchLike(overrides: Partial<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown>; headers: ReturnType<typeof headersLike> }>) {
  return {
    ok: true,
    status: 200,
    headers: headersLike([]),
    json: async () => ({ choices: [{ message: { content: "answer" } }] }),
    ...overrides,
    text: overrides.text ?? (async () => ""),
  } as Response;
}

function headersLike(entries: Array<[string, string]>) {
  const map = new Map(entries.map(([k, v]) => [k.toLowerCase(), v]));
  return { forEach: (fn: (v: string, k: string) => void) => map.forEach((v, k) => fn(v, k)) };
}

describe("chatCompletion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the OpenAI-compatible shape and returns the assistant content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchLike({}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatCompletion(opts);

    expect(result.content).toBe("answer");
    const [url, init] = fetchMock.mock.calls[0]! as [string, { method: string; headers: Record<string, string>; body: string }];
    expect(url).toBe("http://judge-host/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.model).toBe("qwen3:8b");
    expect(body.messages).toEqual(opts.messages);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(800);
  });

  it("sends Bearer auth when an apiKey is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchLike({}));
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion({ ...opts, apiKey: "sk-test" });

    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(init.headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("sends response_format json_object only when requested (narrator path)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchLike({}));
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion({ ...opts, responseFormatJson: true });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as { response_format?: unknown };
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("sends the json_schema response format verbatim when a schema is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchLike({}));
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion({
      ...opts,
      responseFormatJson: true,
      jsonSchemaFormat: { name: "intent_packet", schema: { required: ["intentType", "privateMotiveSummary"] }, strict: false },
    });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as {
      response_format?: { type: string; json_schema: { name: string; schema: unknown; strict: boolean } };
    };
    expect(body.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "intent_packet", schema: { required: ["intentType", "privateMotiveSummary"] }, strict: false },
    });
  });

  it("spreads extraBody into the request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchLike({}));
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion({ ...opts, extraBody: { think: false, stream: false } });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as Record<string, unknown>;
    expect(body.think).toBe(false);
    expect(body.stream).toBe(false);
  });

  it("resolves to empty content when the model sent none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchLike({ json: async () => ({ choices: [] }) })));
    expect((await chatCompletion(opts)).content).toBe("");
  });

  it("throws a typed ChatCompletionError with the caller label on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchLike({ ok: false, status: 500, text: async () => "boom" })));
    await expect(chatCompletion(opts)).rejects.toThrow(ChatCompletionError);
    await expect(chatCompletion(opts)).rejects.toThrow("Test caller HTTP 500: boom");
  });

  it("exposes the response body on ChatCompletionHttpError for caller wrapping", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchLike({ ok: false, status: 500, text: async () => "boom" })));
    try {
      await chatCompletion(opts);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ChatCompletionHttpError);
      expect((err as ChatCompletionHttpError).status).toBe(500);
      expect((err as ChatCompletionHttpError).bodyText).toBe("boom");
    }
  });

  it("retries transient errors (429/5xx) up to retryCount", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fetchLike({ ok: false, status: 429, text: async () => "rate" }))
      .mockResolvedValueOnce(fetchLike({ ok: false, status: 503, text: async () => "down" }))
      .mockResolvedValueOnce(fetchLike({}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatCompletion({ ...opts, retryCount: 2 });

    expect(result.content).toBe("answer");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.attemptCount).toBe(3);
  });

  it("does not retry non-transient 4xx errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchLike({ ok: false, status: 400, text: async () => "bad" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatCompletion(opts)).rejects.toThrow(ChatCompletionHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("exhausts retries before surfacing the error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchLike({ ok: false, status: 429, text: async () => "rate" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatCompletion({ ...opts, retryCount: 2 })).rejects.toThrow(ChatCompletionHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("falls back to json_object on a 400 json_schema rejection without burning a retry slot", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(fetchLike({ ok: false, status: 400, text: async () => "schema not supported" }))
      .mockResolvedValueOnce(fetchLike({}));
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatCompletion({
      ...opts,
      responseFormatJson: true,
      jsonSchemaFormat: { name: "intent_packet", schema: {}, strict: false },
      retryCount: 0,
    });

    expect(result.content).toBe("answer");
    // The fallback consumed no retry budget slot: 2 HTTP calls but a net
    // attempt count of 1 (mirrors the provider's attempts-- arithmetic).
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallbackBody = JSON.parse((fetchMock.mock.calls[1]![1] as { body: string }).body) as { response_format?: unknown };
    expect(fallbackBody.response_format).toEqual({ type: "json_object" });
    expect(result.attemptCount).toBe(1);
  });

  it("extracts response headers lowercased", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fetchLike({
        headers: headersLike([["X-Routed-Model", "gemini-flash"], ["X-Fallback-Attempts", "2"]]),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatCompletion(opts);

    expect(result.responseHeaders["x-routed-model"]).toBe("gemini-flash");
    expect(result.responseHeaders["x-fallback-attempts"]).toBe("2");
  });

  it("throws ChatCompletionTimeoutError on an aborted request (connect timeout)", async () => {
    const abortError = new DOMException("The user aborted a request.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError));

    await expect(chatCompletion({ ...opts, timeoutMs: 42 })).rejects.toThrow(ChatCompletionTimeoutError);
  });

  it("throws ChatCompletionTimeoutError when the body read hangs past the deadline", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      fetchLike({ json: () => new Promise<never>(() => {}) }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(chatCompletion({ ...opts, timeoutMs: 30 })).rejects.toThrow(ChatCompletionTimeoutError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});