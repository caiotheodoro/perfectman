import { describe, it, expect, vi, afterEach } from "vitest";
import { llmJudge, retryOnTransientError } from "../judge/judge.js";
import { ChatCompletionError } from "../llm/chat-completion-error.js";
import { LLMHttpError } from "@perfectman/server";
import { getScenario } from "@perfectman/shared";

const scenario = getScenario("v1_casual_chat")!;
const config = { baseUrl: "http://localhost:11434/v1", model: "test-model" };

// Root-caused via a real canary bench round against OrcaRouter's free tier:
// every one of 12 scenarios was marked "failed" — not because generation or
// scoring logic was wrong, but because the judge's first HTTP call hit a
// transient 429 ("Free model capacity is limited right now") and that error
// propagated straight out of llmJudge uncaught. runJudgeWithRetrySalvage only
// ever retried unparseable *responses* — a transport-level failure on the
// very first call had no retry path at all, discarding an otherwise-valid
// scenario run's signal/probe results along with it.
describe("retryOnTransientError", () => {
  it("retries a transient error and returns the eventual success", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls++;
      if (calls < 2) {
        return Promise.reject(new ChatCompletionError("LLM judge HTTP 429: rate limited", new LLMHttpError(429, "rate limited")));
      }
      return Promise.resolve("ok");
    });
    const result = await retryOnTransientError(fn, { retries: 2, delayMs: 1 });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("retries a 503 the same way as a 429", async () => {
    let calls = 0;
    const fn = vi.fn().mockImplementation(() => {
      calls++;
      if (calls < 2) {
        return Promise.reject(new ChatCompletionError("LLM judge HTTP 503: unavailable", new LLMHttpError(503, "unavailable")));
      }
      return Promise.resolve("ok");
    });
    const result = await retryOnTransientError(fn, { retries: 2, delayMs: 1 });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("gives up after exhausting retries and rethrows the last transient error", async () => {
    const err = new ChatCompletionError("LLM judge HTTP 429: rate limited", new LLMHttpError(429, "rate limited"));
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryOnTransientError(fn, { retries: 2, delayMs: 1 })).rejects.toThrow(err);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("never retries a non-transient error (e.g. a genuine 400)", async () => {
    const err = new ChatCompletionError("LLM judge HTTP 400: bad request", new LLMHttpError(400, "bad request"));
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryOnTransientError(fn, { retries: 2, delayMs: 1 })).rejects.toThrow(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("llmJudge transient transport resilience", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("survives a transient 429 on the first judge call instead of failing the whole scenario", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        call++;
        if (call === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ error: { message: "Free model capacity is limited right now." } }), {
              status: 429,
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: '{"axes": {"in_character": 4}}' } }] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );

    const { axes, salvaged } = await llmJudge(scenario, [], config);
    expect(call).toBe(2);
    expect(axes["in_character"]).toBe(4);
    expect(salvaged).toBe(false);
  });
});
