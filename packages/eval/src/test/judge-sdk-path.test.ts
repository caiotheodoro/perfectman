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
    expect(body.max_tokens).toBe(3000);
    expect(body.temperature).toBe(0.9);
  });

  // Root-caused via a real capture: the narrator dressed up a line a
  // character said PUBLICLY as if it were the hiddenShift reveal, even
  // though a real [internally: ...] line was sitting right there in the
  // transcript unused — scored hidden_payoff=2. The system prompt's own
  // checklist already asked for traceability to the transcript; it just
  // never ruled out a public line satisfying that check.
  it("instructs the narrator to never use a public line as the hiddenShift reveal", async () => {
    vi.stubEnv("PERFECTMAN_LLM_API_KEY", "sk-narr");
    vi.stubEnv("PERFECTMAN_LLM_BASE_URL", "http://narr-host/v1");
    vi.stubEnv("PERFECTMAN_LLM_MODEL", "narr-model");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse(JSON.stringify({ title: "T", recap: "R", hiddenShift: "H" })));
    vi.stubGlobal("fetch", fetchMock);

    await narrateTranscript("[p0] caio (message_sent): oi", "Scene", "desc", "s1");

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = body.messages.find((m) => m.role === "system")!.content;
    expect(system).toContain("NUNCA pode ser uma frase que alguém já disse em público");
  });

  // Root-caused via a real capture: a rich 64-event scene truncated the
  // narrator's response mid-JSON ("Unexpected end of JSON input"), floored
  // by the rule fallback — the same hidden-reasoning-burns-the-budget
  // failure already fixed for the agent path (scenario-runner.ts's
  // `thinking: {type: "disabled"}`) had never been applied to narration,
  // which has no way to disable it at all.
  it("disables deepseek-v4 hidden reasoning for narration too, the same way the agent path does", async () => {
    vi.stubEnv("PERFECTMAN_LLM_API_KEY", "sk-narr");
    vi.stubEnv("PERFECTMAN_LLM_PROVIDER", "deepseek");
    vi.stubEnv("PERFECTMAN_LLM_BASE_URL", "http://narr-host/v1");
    vi.stubEnv("PERFECTMAN_LLM_MODEL", "deepseek/deepseek-v4-flash");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse(JSON.stringify({ title: "T", recap: "R", hiddenShift: "H" })));
    vi.stubGlobal("fetch", fetchMock);

    await narrateTranscript("[p0] caio (message_sent): oi", "Scene", "desc", "s1");

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as {
      thinking?: unknown;
    };
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("does not send the thinking field for a non-deepseek-v4 narration model", async () => {
    vi.stubEnv("PERFECTMAN_LLM_API_KEY", "sk-narr");
    vi.stubEnv("PERFECTMAN_LLM_BASE_URL", "http://narr-host/v1");
    vi.stubEnv("PERFECTMAN_LLM_MODEL", "narr-model");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(okResponse(JSON.stringify({ title: "T", recap: "R", hiddenShift: "H" })));
    vi.stubGlobal("fetch", fetchMock);

    await narrateTranscript("[p0] caio (message_sent): oi", "Scene", "desc", "s1");

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body) as {
      thinking?: unknown;
    };
    expect(body.thinking).toBeUndefined();
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

  // Root-caused via a real local capture: narration ALWAYS fell back to the
  // empty rule template ("0 messages crossed the room...") on every local
  // Ollama run, even when the same Ollama endpoint was working fine for
  // every agent's own intent generation. Ollama needs no API key at all —
  // gating the LLM attempt on "no key = no LLM" was correct for the
  // deepseek/cloud protocol (which does require one) but silently starved
  // the local path of ever narrating for real.
  it("attempts a local LLM call even with no API key configured, since Ollama needs no auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse(JSON.stringify({ title: "T", recap: "R", hiddenShift: "H" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const narration = await narrateTranscript("[p0] caio (message_sent): oi", "Scene", "desc");

    expect(narration.narrator).toBe("llm");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]! as [string];
    expect(url).toBe("http://localhost:11434/v1/chat/completions");
  });
});