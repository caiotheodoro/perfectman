import { afterEach, describe, expect, it, vi } from "vitest";
import { chatCompletion, ChatCompletionError } from "../llm/chat-completion-error.js";
import { narrateTranscript } from "../narrator/narrator.js";

const opts = {
  baseUrl: "http://judge-host/v1",
  model: "qwen3:8b",
  label: "Test caller",
  messages: [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "user" },
  ],
  temperature: 0,
  maxTokens: 800,
};

function okResponse(content: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("judge/narrator shared path (chatCompletion over the server SDK seam)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts the OpenAI-compatible shape and returns the assistant content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse("answer"));
    vi.stubGlobal("fetch", fetchMock);

    const content = await chatCompletion(opts);

    expect(content).toBe("answer");
    const [url, init] = fetchMock.mock.calls[0]! as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("http://judge-host/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).has("authorization")).toBe(false);
    const body = JSON.parse(init.body) as {
      model: string;
      messages: unknown;
      temperature: number;
      max_tokens: number;
      response_format?: unknown;
    };
    expect(body.model).toBe("qwen3:8b");
    expect(body.messages).toEqual(opts.messages);
    expect(body.temperature).toBe(0);
    expect(body.max_tokens).toBe(800);
    expect(body.response_format).toBeUndefined();
  });

  it("sends Bearer auth when an apiKey is provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse("answer"));
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion({ ...opts, apiKey: "sk-test" });

    const init = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer sk-test");
  });

  it("sends response_format json_object only when requested (narrator path)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse("{}"));
    vi.stubGlobal("fetch", fetchMock);

    await chatCompletion({ ...opts, responseFormatJson: true });

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as {
      response_format?: unknown;
    };
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("resolves to empty content when the model sent none", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    expect(await chatCompletion(opts)).toBe("");
  });

  it("throws a label-prefixed ChatCompletionError on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }),
      ),
    );
    const err = await chatCompletion(opts).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChatCompletionError);
    expect((err as Error).message).toBe("Test caller HTTP 500: boom");
  });

  it("makes a single transport attempt (the judge/narrator plan their own retries)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("boom", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(chatCompletion(opts)).rejects.toThrow(ChatCompletionError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts a hanging request after the caller timeout with a single attempt", async () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    const err = await chatCompletion({ ...opts, timeoutMs: 50 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ChatCompletionError);
    expect((err as Error).message).toMatch(/Test caller Request timed out after 50ms/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("narrator env routing on the shared path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("routes PERFECTMAN_LLM_BASE_URL/PERFECTMAN_LLM_MODEL through the shared path with json_object", async () => {
    vi.stubEnv("PERFECTMAN_LLM_API_KEY", "sk-narr");
    vi.stubEnv("PERFECTMAN_LLM_BASE_URL", "http://narr-host/v1");
    vi.stubEnv("PERFECTMAN_LLM_MODEL", "narr-model");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        okResponse(JSON.stringify({ title: "T", recap: "R", hiddenShift: "H" })),
      );
    vi.stubGlobal("fetch", fetchMock);

    const narration = await narrateTranscript("[p0] caio (message_sent): oi", "Scene", "desc", "s1");

    expect(narration.narrator).toBe("llm");
    expect(narration.title).toBe("T");
    expect(narration.model).toBe("narr-model");
    const [url, init] = fetchMock.mock.calls[0]! as [string, { body: string }];
    expect(url).toBe("http://narr-host/v1/chat/completions");
    const body = JSON.parse(init.body) as {
      model: string;
      response_format?: unknown;
      max_tokens: number;
      temperature: number;
    };
    expect(body.model).toBe("narr-model");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(350);
    expect(body.temperature).toBe(0.9);
  });

  it("falls back to rule narration carrying the label-scoped ChatCompletionError", async () => {
    vi.stubEnv("PERFECTMAN_LLM_API_KEY", "sk-narr");
    vi.stubEnv("PERFECTMAN_LLM_BASE_URL", "http://narr-host/v1");
    vi.stubEnv("PERFECTMAN_LLM_MODEL", "narr-model");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }),
      ),
    );

    const narration = await narrateTranscript("[p0] caio (message_sent): oi", "Scene", "desc");

    expect(narration.narrator).toBe("rule");
    expect(narration.model).toContain("fallback:narrator HTTP 500: boom");
  });

  it("skips the LLM entirely when no API key is configured (rule fallback, no request)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const narration = await narrateTranscript("[p0] caio (message_sent): oi", "Scene", "desc");

    expect(narration.narrator).toBe("rule");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});