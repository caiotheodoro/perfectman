import { describe, expect, it } from "vitest";
import { SpendMeter } from "../hotel/hotel-judge.js";
import { createChatCompletionProvider, loadDramaJudgeConfig, type DramaJudgeConfig, type DramaJudgeRequest } from "../drama/index.js";
import type { ChatCompletionOptions } from "../llm/chat-completion-error.js";

const CONFIG: DramaJudgeConfig = {
  baseUrl: "http://judge.invalid/v1",
  model: "acme/vision-1",
  apiKey: "sk-test",
  timeoutMs: 1234,
  maxTokens: 900,
  maxUsd: 1,
};

const REQUEST: DramaJudgeRequest = {
  system: "sys",
  user: "user text",
  images: [
    { mediaType: "image/png", base64: "AAAA" },
    { mediaType: "image/jpeg", base64: "BBBB" },
  ],
  temperature: 0,
  maxTokens: 700,
};

describe("loadDramaJudgeConfig", () => {
  it("takes the model from DRAMA_JUDGE_MODEL and has no default model", () => {
    expect(loadDramaJudgeConfig({ DRAMA_JUDGE_MODEL: "acme/vision-1" }).model).toBe("acme/vision-1");
    expect(() => loadDramaJudgeConfig({})).toThrow(/DRAMA_JUDGE_MODEL/);
  });

  it("lets --model win over the environment", () => {
    expect(loadDramaJudgeConfig({ DRAMA_JUDGE_MODEL: "env/model" }, { model: "flag/model" }).model).toBe("flag/model");
    expect(loadDramaJudgeConfig({}, { model: "flag/model" }).model).toBe("flag/model");
  });

  it("reads the key the hotel judge already reads, most specific first, and never invents one", () => {
    const env = { DRAMA_JUDGE_MODEL: "m" };
    expect(loadDramaJudgeConfig({ ...env, OPENROUTER_API_KEY: "or" }).apiKey).toBe("or");
    expect(loadDramaJudgeConfig({ ...env, OPENROUTER_API_KEY: "or", HOTEL_JUDGE_API_KEY: "hotel" }).apiKey).toBe("hotel");
    expect(loadDramaJudgeConfig({ ...env, OPENROUTER_API_KEY: "or", HOTEL_JUDGE_API_KEY: "hotel", DRAMA_JUDGE_API_KEY: "drama" }).apiKey).toBe("drama");
    expect(loadDramaJudgeConfig(env).apiKey).toBeUndefined();
  });

  it("falls back from the drama base URL to the hotel one to OpenRouter, and reads numeric limits", () => {
    expect(loadDramaJudgeConfig({ DRAMA_JUDGE_MODEL: "m" }).baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(loadDramaJudgeConfig({ DRAMA_JUDGE_MODEL: "m", HOTEL_JUDGE_BASE_URL: "http://h/v1" }).baseUrl).toBe("http://h/v1");
    const cfg = loadDramaJudgeConfig({ DRAMA_JUDGE_MODEL: "m", DRAMA_JUDGE_BASE_URL: "http://d/v1", DRAMA_JUDGE_MAX_USD: "2.5", DRAMA_JUDGE_TIMEOUT_MS: "5000", DRAMA_JUDGE_MAX_TOKENS: "1200" });
    expect(cfg).toMatchObject({ baseUrl: "http://d/v1", maxUsd: 2.5, timeoutMs: 5000, maxTokens: 1200 });
  });
});

describe("createChatCompletionProvider", () => {
  it("sends the system message, then the user message with its images, at temperature 0, through the shared chat completion", async () => {
    const seen: ChatCompletionOptions[] = [];
    const provider = createChatCompletionProvider(CONFIG, {
      complete: async (opts) => {
        seen.push(opts);
        return "reply";
      },
    });

    expect(provider.model).toBe("acme/vision-1");
    await expect(provider.complete(REQUEST)).resolves.toBe("reply");

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      baseUrl: "http://judge.invalid/v1",
      model: "acme/vision-1",
      apiKey: "sk-test",
      temperature: 0,
      maxTokens: 700,
      timeoutMs: 1234,
      label: "drama judge",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "user text", images: REQUEST.images },
      ],
    });
  });

  it("counts every image against the spend cap before it calls the model", async () => {
    let called = false;
    // priced model: the 700 output tokens alone cost $0.00056, the two images add about $0.0004 more
    const config = { ...CONFIG, model: "qwen/qwen3-235b-a22b-2507" };
    const complete = async (): Promise<string> => ((called = true), "reply");
    const textOnly = createChatCompletionProvider(config, { meter: new SpendMeter(0.0007), complete });
    await textOnly.complete({ ...REQUEST, images: [] });
    expect(called).toBe(true);

    called = false;
    const withImages = createChatCompletionProvider(config, { meter: new SpendMeter(0.0007), complete });
    await expect(withImages.complete(REQUEST)).rejects.toThrow(/spend cap reached/);
    expect(called).toBe(false);
  });

  it("records spend after a call, so the cap tightens across calls", async () => {
    const meter = new SpendMeter(5);
    const provider = createChatCompletionProvider(CONFIG, { meter, complete: async () => "x".repeat(400) });
    await provider.complete(REQUEST);
    await provider.complete(REQUEST);
    expect(meter.calls).toBe(2);
    expect(meter.spentUsd).toBeGreaterThan(0);
  });
});
