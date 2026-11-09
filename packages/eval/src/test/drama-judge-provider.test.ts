import { afterEach, describe, expect, it, vi } from "vitest";
import { SpendMeter } from "../hotel/hotel-judge.js";
import { createChatCompletionProvider, loadDramaJudgeConfig, type DramaJudgeConfig, type DramaJudgeRequest } from "../drama/index.js";
import type { ChatCompletionOptions } from "../llm/chat-completion-error.js";

const CONFIG: DramaJudgeConfig = {
  baseUrl: "http://judge.invalid/v1",
  model: "acme/vision-1",
  apiKey: "sk-test",
  timeoutMs: 1234,
  maxTokens: 2500,
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

describe("loadDramaJudgeConfig token limit", () => {
  it("defaults DRAMA_JUDGE_MAX_TOKENS to 2500", () => {
    expect(loadDramaJudgeConfig({ DRAMA_JUDGE_MODEL: "m" }).maxTokens).toBe(2500);
  });
});

describe("loadDramaJudgeConfig headers", () => {
  const env = (extra: Record<string, string>) => ({ DRAMA_JUDGE_MODEL: "m", ...extra });

  it("has no extra headers by default", () => {
    const cfg = loadDramaJudgeConfig(env({}));
    expect(cfg.headers).toBeUndefined();
    expect(cfg.sessionHeader).toBeUndefined();
  });

  it("accepts a JSON object of string headers and a session header name", () => {
    const cfg = loadDramaJudgeConfig(env({ DRAMA_JUDGE_HEADERS: '{"X-Title":"pm","x-team":"drama"}', DRAMA_JUDGE_SESSION_HEADER: "x-opencode-session" }));
    expect(cfg.headers).toEqual({ "X-Title": "pm", "x-team": "drama" });
    expect(cfg.sessionHeader).toBe("x-opencode-session");
  });

  it("treats blank values as unset", () => {
    const cfg = loadDramaJudgeConfig(env({ DRAMA_JUDGE_HEADERS: "  ", DRAMA_JUDGE_SESSION_HEADER: "" }));
    expect(cfg.headers).toBeUndefined();
    expect(cfg.sessionHeader).toBeUndefined();
  });

  it.each([
    ["an array", '[["x","y"]]', /DRAMA_JUDGE_HEADERS.*JSON object/],
    ["not JSON", "x-a: b", /DRAMA_JUDGE_HEADERS.*JSON object/],
    ["a non-string value", '{"x-a":1}', /DRAMA_JUDGE_HEADERS.*"x-a".*string/],
    ["Authorization", '{"Authorization":"Bearer abc"}', /DRAMA_JUDGE_HEADERS.*"Authorization".*not allowed/],
    ["Content-Type in any case", '{"content-TYPE":"text/plain"}', /not allowed/],
    ["Host", '{"Host":"evil"}', /not allowed/],
    ["a newline in a value", '{"x-a":"b\\nx-evil: 1"}', /DRAMA_JUDGE_HEADERS.*"x-a".*newline/],
    ["a newline in a name", '{"x-a\\nb":"c"}', /DRAMA_JUDGE_HEADERS/],
  ])("rejects %s", (_name, raw, message) => {
    expect(() => loadDramaJudgeConfig(env({ DRAMA_JUDGE_HEADERS: raw }))).toThrow(message);
  });

  it("never puts a header value in the error", () => {
    for (const raw of ['{"Authorization":"SECRET-VALUE"}', '{"x-a":"SECRET-VALUE\\n"}', '{"x-a":["SECRET-VALUE"]}']) {
      try {
        loadDramaJudgeConfig(env({ DRAMA_JUDGE_HEADERS: raw }));
        throw new Error("expected a throw");
      } catch (e) {
        expect((e as Error).message).not.toContain("SECRET-VALUE");
      }
    }
  });

  it.each(["Authorization", "host", "content-type", "bad name", "x-a\nb"])("rejects %j as the session header name", (name) => {
    expect(() => loadDramaJudgeConfig(env({ DRAMA_JUDGE_SESSION_HEADER: name }))).toThrow(/DRAMA_JUDGE_SESSION_HEADER/);
  });
});

describe("createChatCompletionProvider over a fake fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okBody = (content: string, finish = "stop"): Response =>
    new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }] }), { status: 200, headers: { "Content-Type": "application/json" } });

  const sentHeaders = (fetchMock: ReturnType<typeof vi.fn>, call: number): Headers => {
    const [, init] = fetchMock.mock.calls[call]! as [string, { headers: ConstructorParameters<typeof Headers>[0] }];
    return new Headers(init.headers);
  };

  it("sends the configured headers on the request and keeps authorization", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => okBody("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createChatCompletionProvider({ ...CONFIG, headers: { "X-Title": "pm" } });
    await provider.complete(REQUEST);
    const headers = sentHeaders(fetchMock, 0);
    expect(headers.get("x-title")).toBe("pm");
    expect(headers.get("authorization")).toBe("Bearer sk-test");
  });

  it("sends the session header with one stable per-provider id across calls, different between providers", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => okBody("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createChatCompletionProvider({ ...CONFIG, sessionHeader: "x-opencode-session" });
    await provider.complete(REQUEST);
    await provider.complete(REQUEST);
    const first = sentHeaders(fetchMock, 0).get("x-opencode-session");
    const second = sentHeaders(fetchMock, 1).get("x-opencode-session");
    expect(first).toMatch(/^pm-judge-[a-z0-9]{8,}$/);
    expect(second).toBe(first);

    await createChatCompletionProvider({ ...CONFIG, sessionHeader: "x-opencode-session" }).complete(REQUEST);
    expect(sentHeaders(fetchMock, 2).get("x-opencode-session")).not.toBe(first);
  });

  it("sends no extra header when none is configured", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => okBody("ok"));
    vi.stubGlobal("fetch", fetchMock);
    await createChatCompletionProvider(CONFIG).complete(REQUEST);
    expect(sentHeaders(fetchMock, 0).get("x-opencode-session")).toBeNull();
  });

  it("reports the finish reason when the endpoint sent one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => okBody('{"scores": {', "length")));
    await expect(createChatCompletionProvider(CONFIG).complete(REQUEST)).resolves.toEqual({ content: '{"scores": {', finishReason: "length" });
  });

  it("passes the configured token limit to the judge as its own default", () => {
    expect(createChatCompletionProvider({ ...CONFIG, maxTokens: 1500 }).maxTokens).toBe(1500);
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
