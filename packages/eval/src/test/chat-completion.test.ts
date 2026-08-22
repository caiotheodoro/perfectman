import { describe, it, expect, afterEach, vi } from "vitest";
import { chatCompletion, ChatCompletionError } from "../llm/chat-completion.js";

const opts = {
  baseUrl: "http://judge-host/v1",
  model: "qwen3:8b",
  label: "Test caller",
  messages: [{ role: "system" as const, content: "sys" }, { role: "user" as const, content: "user" }],
  temperature: 0,
  maxTokens: 800,
};

function fetchLike(overrides: Partial<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "answer" } }] }),
    ...overrides,
    text: overrides.text ?? (async () => ""),
  } as Response;
}

describe("chatCompletion", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the OpenAI-compatible shape and returns the assistant content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(fetchLike({}));
    vi.stubGlobal("fetch", fetchMock);

    const content = await chatCompletion(opts);

    expect(content).toBe("answer");
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

  it("resolves to empty content when the model sent none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchLike({ json: async () => ({ choices: [] }) })));
    expect(await chatCompletion(opts)).toBe("");
  });

  it("throws a typed ChatCompletionError with the caller label on non-2xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(fetchLike({ ok: false, status: 500, text: async () => "boom" })));
    await expect(chatCompletion(opts)).rejects.toThrow(ChatCompletionError);
    await expect(chatCompletion(opts)).rejects.toThrow("Test caller HTTP 500: boom");
  });

  it("aborts the request after the caller timeout", async () => {
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: { signal?: AbortSignal }) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Promise.reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatCompletion({ ...opts, timeoutMs: 42 })).rejects.toThrow(/aborted/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});