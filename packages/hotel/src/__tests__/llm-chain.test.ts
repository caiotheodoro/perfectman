import { LLMHttpError, LLMTimeoutError } from "@perfectman/server/hotel";
import type { BuiltPrompt, LLMConfig, LLMProvider, LLMProviderResult } from "@perfectman/server/hotel";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../clock/manual-clock.js";
import { ConfigError, linksOf, parseConfig } from "../config.js";
import { BreakerDriver } from "../llm/breaker.js";
import { ChainExhaustedError, LlmChain } from "../llm/chain.js";
import type { MakeProvider } from "../llm/chain.js";
import { defaultHeadersFor, linkHeaders, linkInputBudget, parseChain } from "../llm/chain-config.js";
import type { LlmLink } from "../llm/chain-config.js";
import { hostLlmConfig } from "../llm/env.js";
import { linkPromptStyle } from "../llm/chain-config.js";
import { LlmGovernor } from "../llm/governor.js";

const MYTHO: LlmLink = { name: "mythomax", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "gryphe/mythomax-l2-13b", maxContextTokens: 4096 };
const LUNARIS: LlmLink = { name: "lunaris", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "sao10k/l3-lunaris-8b", maxContextTokens: 8192 };
const GO: LlmLink = { name: "opencode", baseUrl: "https://opencode.ai/zen/go/v1", apiKeyEnv: "OC_KEY", model: "glm-5.3-flash", sessionHeader: "x-opencode-session" };
const PRICES = { "gryphe/mythomax-l2-13b": { inUsdPerMTok: 0.08, outUsdPerMTok: 0.11 }, "sao10k/l3-lunaris-8b": { inUsdPerMTok: 0.04, outUsdPerMTok: 0.05 }, "glm-5.3-flash": { inUsdPerMTok: 0, outUsdPerMTok: 0 } };
const ENV = { OR_KEY: "or-test", OC_KEY: "oc-test" } as NodeJS.ProcessEnv;

const BASE: LLMConfig = hostLlmConfig({ provider: "openai-compatible", baseUrl: MYTHO.baseUrl, apiKeyEnv: "OR_KEY", models: [MYTHO.model], chain: [MYTHO, LUNARIS, GO], prices: PRICES, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 });
const prompt = (estimate = 2000): BuiltPrompt => ({ system: "s", user: "u", inputTokensEstimate: estimate, purpose: "action_intent", version: "v", templateVersion: "t" });
const ok = (over: Partial<LLMProviderResult> = {}): LLMProviderResult => ({ content: "{}", usage: { inputTokens: 2400, outputTokens: 100 }, latencyMs: 1500, model: "x", ...over });

type Script = Record<string, Array<LLMProviderResult | Error | (() => Promise<LLMProviderResult>)>>;

/** A scripted provider per model: each call takes the model's next scripted step (the last repeats). */
function scripted(script: Script): { make: MakeProvider; calls: string[]; configs: LLMConfig[] } {
  const calls: string[] = [];
  const configs: LLMConfig[] = [];
  const make: MakeProvider = (config) => {
    const provider: LLMProvider = {
      generateIntent: async () => {
        calls.push(config.modelName);
        configs.push(config);
        const steps = script[config.modelName] ?? [ok()];
        const step = steps.length > 1 ? steps.shift()! : steps[0]!;
        if (step instanceof Error) throw step;
        return typeof step === "function" ? step() : step;
      },
    };
    return provider;
  };
  return { make, calls, configs };
}

function chain(script: Script, links: LlmLink[] = [MYTHO, LUNARIS, GO], clock = new ManualClock()) {
  const s = scripted(script);
  const governor = new LlmGovernor(clock, () => 0.5);
  const c = new LlmChain({ links, clock, runId: 42, simulationId: "sim", governor, prices: PRICES, env: ENV, makeProvider: s.make });
  const p = c.provider(BASE, "duda");
  const call = (estimate?: number) => p.generateIntent(undefined as never, undefined as never, prompt(estimate));
  return { c, clock, call, ...s };
}

describe("PERFECTMAN_LLM_CHAIN parsing", () => {
  const good = JSON.stringify([MYTHO, LUNARIS, GO]);

  it("parses the links in order, and the chain's models are the allowlist and its prices come from the known table", () => {
    const env = { PERFECTMAN_ENABLED: "1", PERFECTMAN_SECRET: "s".repeat(32), PERFECTMAN_DIRECTOR_URL: "ws://d/x", PERFECTMAN_INTERNAL_URL: "http://d", PERFECTMAN_LLM_CHAIN: good, PERFECTMAN_LLM_PRICES: JSON.stringify({ [GO.model]: { inUsdPerMTok: 0, outUsdPerMTok: 0 } }), OR_KEY: "k", OC_KEY: "k" };
    const c = parseConfig(env);
    expect(c.llm.chain?.map((l) => l.name)).toEqual(["mythomax", "lunaris", "opencode"]);
    expect(c.llm.models).toEqual([MYTHO.model, LUNARIS.model, GO.model]);
    expect(c.llm).toMatchObject({ baseUrl: MYTHO.baseUrl, apiKeyEnv: "OR_KEY" });
    expect(c.llm.prices[MYTHO.model]).toEqual({ inUsdPerMTok: 0.08, outUsdPerMTok: 0.11 });
    expect(c.llm.prices[LUNARIS.model]).toEqual({ inUsdPerMTok: 0.04, outUsdPerMTok: 0.05 });
    expect(c.llm.prices[GO.model]).toEqual({ inUsdPerMTok: 0, outUsdPerMTok: 0 });
    // PERFECTMAN_LLM_PRICES still wins.
    const over = parseConfig({ ...env, PERFECTMAN_LLM_PRICES: JSON.stringify({ [MYTHO.model]: { inUsdPerMTok: 1, outUsdPerMTok: 2 }, [GO.model]: { inUsdPerMTok: 0, outUsdPerMTok: 0 } }) });
    expect(over.llm.prices[MYTHO.model]).toEqual({ inUsdPerMTok: 1, outUsdPerMTok: 2 });
  });

  it("falls back to the legacy single-link vars when no chain is set", () => {
    const c = parseConfig({ PERFECTMAN_ENABLED: "1", PERFECTMAN_SECRET: "s".repeat(32), PERFECTMAN_DIRECTOR_URL: "ws://d/x", PERFECTMAN_INTERNAL_URL: "http://d", PERFECTMAN_LLM_BASE_URL: "https://llm.example/v1", PERFECTMAN_LLM_API_KEY: "k", PERFECTMAN_LLM_MODELS: "fast", PERFECTMAN_LLM_PRICES: JSON.stringify({ fast: { inUsdPerMTok: 1, outUsdPerMTok: 2 } }) });
    expect(c.llm.chain).toBeUndefined();
    expect(linksOf(c.llm)).toEqual([{ name: "default", baseUrl: "https://llm.example/v1", apiKeyEnv: "PERFECTMAN_LLM_API_KEY", model: "fast" }]);
    expect(hostLlmConfig(c.llm).maxInputTokens).toBe(6000);
  });

  it("names every bad entry, and a missing key env of any link, at once", () => {
    const problems: string[] = [];
    expect(parseChain(JSON.stringify([{ name: "a", baseUrl: "ftp://x", apiKeyEnv: "sk-live-123 456", model: "" }, { name: "a", baseUrl: "https://x", apiKeyEnv: "K", model: "m", headers: { Authorization: "Bearer x" }, maxContextTokens: 10 }]), problems)).toEqual([]);
    expect(problems.join("\n")).toMatch(/model must be[\s\S]*baseUrl must be an http\(s\) URL[\s\S]*apiKeyEnv must be an env var NAME[\s\S]*used twice[\s\S]*maxContextTokens[\s\S]*not allowed/);
    expect(() => parseConfig({ PERFECTMAN_ENABLED: "1", PERFECTMAN_SECRET: "s".repeat(32), PERFECTMAN_DIRECTOR_URL: "ws://d/x", PERFECTMAN_INTERNAL_URL: "http://d", PERFECTMAN_LLM_CHAIN: good, PERFECTMAN_LLM_PRICES: JSON.stringify({ [GO.model]: { inUsdPerMTok: 0, outUsdPerMTok: 0 } }), OR_KEY: "k" })).toThrow(/OC_KEY is not set/);
    expect(() => parseConfig({ PERFECTMAN_ENABLED: "1", PERFECTMAN_LLM_CHAIN: "not json" })).toThrow(ConfigError);
  });

  it("gives link 1 an input budget from its window minus the answer, which keeps MythoMax under about 3.4K", () => {
    expect(linkInputBudget(MYTHO)).toBe(3400);
    expect(linkInputBudget(LUNARIS)).toBe(7168);
    expect(linkInputBudget(GO)).toBe(6000);
    expect(BASE).toMatchObject({ maxInputTokens: 3400, maxOutputTokens: 400, modelName: MYTHO.model, apiKeyEnv: "OR_KEY" });
  });

  it("fills in the measured tokenizer ratio of known models, which shrinks MythoMax's budget to what really fits 4K", () => {
    const problems: string[] = [];
    const [m, l, g] = parseChain(JSON.stringify([{ ...MYTHO }, { ...LUNARIS }, { ...GO }]), problems);
    expect(problems).toEqual([]);
    expect([m?.tokenRatio, l?.tokenRatio, g?.tokenRatio]).toEqual([1.25, 1.1, undefined]);
    expect(linkInputBudget(m!)).toBe(2720);
    expect(linkInputBudget({ maxContextTokens: 4096, tokenRatio: 1 })).toBe(3400);
    expect(parseChain(JSON.stringify([{ ...MYTHO, tokenRatio: 9 }]), [])).toEqual([]);
  });

  it("sends OpenRouter's attribution headers and the run id in the session header, never a credential", () => {
    expect(defaultHeadersFor("https://openrouter.ai/api/v1")).toEqual({ "HTTP-Referer": "https://habbo.avenza.cloud", "X-Title": "CMB" });
    expect(linkHeaders(MYTHO, 42)).toMatchObject({ "X-Title": "CMB" });
    expect(linkHeaders(GO, 42)).toEqual({ "x-opencode-session": "42" });
    expect(linkHeaders({ ...MYTHO, headers: { "X-Title": "Mine" } }, 1)["X-Title"]).toBe("Mine");
  });
});

describe("provider chain failover", () => {
  it("serves from link 1 when it is healthy and records which link served, with the cost at that link's price", async () => {
    const { c, call, calls } = chain({});
    const r = await call();
    expect(calls).toEqual([MYTHO.model]);
    expect(r).toMatchObject({ model: MYTHO.model, routedModel: "mythomax", fallbackAttempts: 0, latencyMs: 1500 });
    expect(r.responseHeaders?.["x-pm-link"]).toBe("mythomax");
    const [m] = c.snapshot().links;
    expect(m).toMatchObject({ served: 1, calls: 1, failures: 0, tokensIn: 2400, tokensOut: 100, p50Ms: 1500, p95Ms: 1500, estimateRatio: 1.2 });
    expect(m?.costUsd).toBeCloseTo((2400 * 0.08 + 100 * 0.11) / 1e6, 9);
    expect(c.served[0]).toMatchObject({ link: "mythomax", passedOver: 0 });
  });

  it.each([
    ["a 503", new LLMHttpError(503, "upstream down")],
    ["a 500", new LLMHttpError(500, "boom")],
    ["a timeout", new LLMTimeoutError("Request timed out after 8000ms.")],
    ["a network error", new TypeError("fetch failed")],
  ])("fails over to the next link on %s, and counts the wasted time in the served latency", async (_n, err) => {
    const { c, call, calls, clock } = chain({ [MYTHO.model]: [async () => { await clock.advance(3000); throw err; }] });
    const r = await call();
    expect(calls).toEqual([MYTHO.model, LUNARIS.model]);
    expect(r).toMatchObject({ model: LUNARIS.model, routedModel: "lunaris", fallbackAttempts: 1, latencyMs: 3000 + 1500 });
    expect(c.snapshot()).toMatchObject({ failovers: 1, links: [{ failures: 1, served: 0 }, { served: 1, failures: 0 }, { calls: 0 }] });
  });

  it("retries a 429 once on a short wait and then fails over, instead of holding the call", async () => {
    const { call, calls, c, clock } = chain({ [MYTHO.model]: [new LLMHttpError(429, "slow down", { "retry-after": "1" })] });
    const pending = call();
    await clock.advance(2000);
    const r = await pending;
    expect(calls).toEqual([MYTHO.model, MYTHO.model, LUNARIS.model]);
    expect(r.routedModel).toBe("lunaris");
    expect(c.snapshot().links[0]?.failures).toBe(1);
  });

  it("skips a throttled link without a call while another is behind it", async () => {
    const { call, calls, clock } = chain({ [MYTHO.model]: [new LLMHttpError(429, "slow down", { "retry-after": "1" })] });
    const first = call();
    await clock.advance(2000);
    await first;
    calls.length = 0;
    // The 1 s penalty window has passed; throttle it again with a fresh 429 and ask at once.
    const again = call();
    await clock.advance(2000);
    await again;
    expect(calls.at(-1)).toBe(LUNARIS.model);
  });

  it("treats a spent quota (429 carrying the provider's quota code) as out for a while: no retries, no further calls, then one trial", async () => {
    const quota = new LLMHttpError(429, '{"type":"error","error":{"type":"GoUsageLimitError","message":"Go usage limit exceeded"}}', { "retry-after": "155092" });
    const { c, call, calls, clock } = chain({ [MYTHO.model]: [quota] });
    const r1 = await call();
    expect(calls).toEqual([MYTHO.model, LUNARIS.model]);
    expect(r1.routedModel).toBe("lunaris");
    expect(c.snapshot().links[0]).toMatchObject({ cooldownMsLeft: 60 * 60_000, breaker: "closed" });
    calls.length = 0;
    await call();
    expect(calls).toEqual([LUNARIS.model]);
    expect(c.snapshot().links[0]?.skipped.cooldown).toBe(1);
    await clock.advance(60 * 60_000);
    calls.length = 0;
    await call();
    expect(calls[0]).toBe(MYTHO.model);
  });

  it("does not park a link for a generic 429, even one that says \"exceeded your\" or asks for a long wait", async () => {
    const loose = new LLMHttpError(429, "You have exceeded your current rate, try again", { "retry-after": "300" });
    const { c, call, clock } = chain({ [MYTHO.model]: [loose] });
    const pending = call();
    await clock.advance(2000);
    const r1 = await pending;
    expect(r1.routedModel).toBe("lunaris");
    // The governor's own Retry-After window throttles link 1; the hour-long quota cooldown is not applied.
    expect(c.snapshot().links[0]).toMatchObject({ cooldownMsLeft: 0, breaker: "closed" });
  });

  it("refuses to serve and throws one error naming every link when all of them fail", async () => {
    const { call, c } = chain({ [MYTHO.model]: [new LLMHttpError(500, "a")], [LUNARIS.model]: [new LLMHttpError(502, "b")], [GO.model]: [new LLMHttpError(429, '{"type":"error","error":{"type":"GoUsageLimitError","message":"Go usage limit exceeded"}}', { "retry-after": "155092" })] });
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChainExhaustedError);
    expect((err as Error).message).toMatch(/mythomax=http 500, lunaris=http 502, opencode=quota/);
    expect(c.snapshot().exhausted).toBe(1);
  });

  it("opens a link's breaker after 3 failures, sticks with the working link, and returns to link 1 after one good half-open trial", async () => {
    let mythoUp = false;
    const { c, call, calls, clock } = chain({ [MYTHO.model]: [async () => { if (!mythoUp) throw new LLMHttpError(500, "down"); return ok(); }] });
    for (let i = 0; i < 3; i++) await call();
    expect(c.snapshot().links[0]).toMatchObject({ breaker: "open", failures: 3 });
    calls.length = 0;
    await call();
    await call();
    expect(calls).toEqual([LUNARIS.model, LUNARIS.model]);
    expect(c.snapshot().links[0]?.skipped.breaker_open).toBe(2);

    mythoUp = true;
    await clock.advance(15_000);
    calls.length = 0;
    const trial = await call();
    expect(trial.routedModel).toBe("mythomax");
    expect(c.snapshot().links[0]?.breaker).toBe("closed");
    await call();
    expect(calls).toEqual([MYTHO.model, MYTHO.model]);
  });

  it("a failed half-open trial reopens the breaker with a longer backoff and the call still gets served", async () => {
    const { c, call, calls, clock } = chain({ [MYTHO.model]: [new LLMHttpError(500, "down")] });
    for (let i = 0; i < 3; i++) await call();
    await clock.advance(15_000);
    calls.length = 0;
    const r = await call();
    expect(calls).toEqual([MYTHO.model, LUNARIS.model]);
    expect(r.routedModel).toBe("lunaris");
    await clock.advance(15_000);
    calls.length = 0;
    await call();
    expect(calls).toEqual([LUNARIS.model]);
    await clock.advance(15_000);
    await call();
    expect(calls).toContain(MYTHO.model);
    expect(c.snapshot().links[0]?.breaker).toBe("open");
  });

  it("skips a link whose window the prompt does not fit, and throws when no link fits", async () => {
    const { call, calls, c } = chain({}, [MYTHO, LUNARIS]);
    const r = await call(3400);
    expect(calls).toEqual([LUNARIS.model]);
    expect(r).toMatchObject({ routedModel: "lunaris", fallbackAttempts: 1 });
    expect(c.snapshot().links[0]?.skipped.context).toBe(1);
    await expect(call(9000)).rejects.toBeInstanceOf(ChainExhaustedError);
  });

  it("learns a smaller window from a provider's context-length 400, without opening the breaker", async () => {
    const { c, call, calls } = chain({ [MYTHO.model]: [new LLMHttpError(400, "This model's maximum context length is 4096 tokens. However, you requested 4300 tokens")] });
    const r = await call(3100);
    expect(r.routedModel).toBe("lunaris");
    expect(c.snapshot().links[0]).toMatchObject({ breaker: "closed", inputBudget: 3099 });
    calls.length = 0;
    await call(3100);
    expect(calls).toEqual([LUNARIS.model]);
  });

  it("calls each link with its own url, key env, model, window and a deadline inside the generate budget", async () => {
    const { call, configs } = chain({ [MYTHO.model]: [new LLMHttpError(500, "x")] });
    await call();
    expect(configs[0]).toMatchObject({ baseUrl: MYTHO.baseUrl, apiKeyEnv: "OR_KEY", modelName: MYTHO.model, maxInputTokens: 3400, retryCount: 0, timeoutMs: 8000 });
    expect(configs[1]).toMatchObject({ modelName: LUNARIS.model, maxInputTokens: 7168 });
  });

  it("a lone link keeps the transport's own retry and a lone link's failure is the chain's", async () => {
    const { call, configs } = chain({ [MYTHO.model]: [new LLMHttpError(500, "x")] }, [MYTHO]);
    await expect(call()).rejects.toBeInstanceOf(ChainExhaustedError);
    expect(configs[0]?.retryCount).toBe(BASE.retryCount);
  });

  it("moves the prompt cap to the next link once link 1 cannot hold even the stripped prompt, and tells the runtime", async () => {
    const clock = new ManualClock();
    const s = scripted({});
    const caps: number[] = [];
    const styles: string[] = [];
    const c = new LlmChain({ links: [MYTHO, LUNARIS, GO], clock, runId: 1, simulationId: "s", governor: new LlmGovernor(clock), prices: PRICES, env: ENV, makeProvider: s.make, onCap: (n, style) => (caps.push(n), styles.push(style)) });
    expect(c.promptCap).toBe(3400);
    expect(c.promptStyle).toBe("compact");
    const stripped: BuiltPrompt = { ...prompt(3700), trim: { maxInputTokens: 3400, rawInputTokensEstimate: 5000, finalInputTokensEstimate: 3700, droppedEvents: 9, droppedMemories: 2, droppedUtterances: 3, droppedInputTokensEstimate: 1300, withinCap: false, phase: "assembly" } };
    const r = await c.provider(BASE, "duda").generateIntent(undefined as never, undefined as never, stripped);
    expect(r.routedModel).toBe("lunaris");
    expect(caps).toEqual([7168]);
    // Lunaris has the room for the full prompt, so the runtime goes back to writing it.
    expect(styles).toEqual(["full"]);
    expect(c.promptStyle).toBe("full");
    expect(c.promptCap).toBe(7168);
    // A prompt that was trimmed cleanly changes nothing.
    await c.provider(BASE, "duda").generateIntent(undefined as never, undefined as never, { ...stripped, trim: { ...stripped.trim!, withinCap: true } });
    expect(caps).toEqual([7168]);
  });

  it("reports successes and failures to the run's hooks", async () => {
    const clock = new ManualClock();
    const s = scripted({ [MYTHO.model]: [new LLMHttpError(500, "x")], [LUNARIS.model]: [new LLMHttpError(500, "x")], [GO.model]: [new LLMHttpError(500, "x")] });
    const c = new LlmChain({ links: [MYTHO, LUNARIS, GO], clock, runId: 1, simulationId: "s", governor: new LlmGovernor(clock), prices: PRICES, env: ENV, makeProvider: s.make });
    const seen: string[] = [];
    const p = c.provider(BASE, "a", { onSuccess: () => seen.push("ok"), onFailure: () => seen.push("fail") });
    await expect(p.generateIntent(undefined as never, undefined as never, prompt())).rejects.toThrow();
    expect(seen).toEqual(["fail"]);
  });
});

describe("the real transport through the chain", () => {
  const body = (content: string) => JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 2500, completion_tokens: 80 }, model: "gryphe/mythomax-l2-13b" });

  it("sends attribution headers to OpenRouter, the run id as the session header to OpenCode, and fails over a 429 quota", async () => {
    const seen: Array<{ url: string; headers: Headers; auth: string | null; model: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers);
      const model = (JSON.parse(String(init?.body)) as { model: string }).model;
      seen.push({ url: String(input), headers, auth: headers.get("authorization"), model });
      if (String(input).includes("openrouter")) return new Response(JSON.stringify({ error: { message: "upstream" } }), { status: 503, headers: { "content-type": "application/json" } });
      return new Response(body("{\"intentType\":\"no_op\"}"), { status: 200, headers: { "content-type": "application/json" } });
    };
    const clock = new ManualClock();
    const c = new LlmChain({ links: [MYTHO, GO], clock, runId: 77, simulationId: "s", governor: new LlmGovernor(clock), prices: PRICES, env: ENV, fetchImpl });
    const r = await c.provider(BASE, "duda").generateIntent({} as never, undefined as never, prompt());
    expect(r).toMatchObject({ routedModel: "opencode", model: GO.model, fallbackAttempts: 1 });
    const or = seen.find((s) => s.url.includes("openrouter"));
    expect(or?.headers.get("http-referer")).toBe("https://habbo.avenza.cloud");
    expect(or?.headers.get("x-title")).toBe("CMB");
    expect(or?.headers.get("x-opencode-session")).toBeNull();
    expect(or?.auth).toBe("Bearer or-test");
    const go = seen.find((s) => s.url.includes("opencode.ai"));
    expect(go?.headers.get("x-opencode-session")).toBe("77");
    expect(go?.headers.get("http-referer")).toBeNull();
    expect(go?.auth).toBe("Bearer oc-test");
    expect(go?.model).toBe("glm-5.3-flash");
  });

  it("prefers the cost the provider billed (OpenRouter's usage.cost) to the price table", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 4580, completion_tokens: 211, cost: 0.0017275 }, model: "gryphe/mythomax-l2-13b" }), { status: 200, headers: { "content-type": "application/json" } });
    const clock = new ManualClock();
    const c = new LlmChain({ links: [MYTHO], clock, runId: 1, simulationId: "s", governor: new LlmGovernor(clock), prices: PRICES, env: ENV, fetchImpl });
    const r = await c.provider(BASE, "a").generateIntent({} as never, undefined as never, prompt());
    expect(r.responseHeaders?.["x-pm-cost-usd"]).toBe("0.0017275");
    expect(c.snapshot().links[0]?.costUsd).toBeCloseTo(0.0017275, 5);
    expect(c.served[0]?.costUsd).toBeCloseTo(0.0017275, 9);
  });

  it("ping walks the links, skipping one in a quota cooldown, and answers true on the first that does", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return String(input).includes("openrouter")
        ? new Response(JSON.stringify({ type: "error", error: { type: "GoUsageLimitError", message: "Go usage limit exceeded" } }), { status: 429, headers: { "retry-after": "155092" } })
        : new Response("{}", { status: 200 });
    };
    const clock = new ManualClock();
    const c = new LlmChain({ links: [MYTHO, GO], clock, runId: 1, simulationId: "s", governor: new LlmGovernor(clock), prices: PRICES, env: ENV, fetchImpl });
    expect(await c.ping()).toBe(true);
    expect(c.snapshot().links[0]?.cooldownMsLeft).toBeGreaterThan(0);
    calls.length = 0;
    expect(await c.ping()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("opencode.ai");
  });
});

describe("breaker probe events carry the structured provider-failure flag", () => {
  it.each([[true, false], [false, true]])("a probe that answered=%s is providerFailure=%s", async (answered, failure) => {
    const clock = new ManualClock();
    const b = new BreakerDriver({ clock, simulationId: "sim", probe: async () => answered, onOpen: () => true, onClose: () => undefined, notice: () => undefined });
    const seen: unknown[] = [];
    const observe = b.gateway.observe.bind(b.gateway);
    b.gateway.observe = (e) => {
      seen.push(e.data?.["providerFailure"]);
      observe(e);
    };
    const fail = { type: "action_intent" as const, simulationId: "sim", pulseIndex: 1, detail: "x", data: { providerFailure: true, privateMotiveSummary: "Provider failed: HTTP 503" }, createdAt: 0 };
    for (let i = 0; i < 5; i++) b.gateway.observe(fail);
    seen.length = 0;
    await clock.advance(15_000);
    expect(seen).toEqual([failure]);
    b.dispose();
  });
});
