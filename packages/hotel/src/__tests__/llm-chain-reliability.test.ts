import { LLMHttpError, LLMTimeoutError } from "@perfectman/server/hotel";
import type { BuiltPrompt, LLMConfig, LLMProvider, LLMProviderResult } from "@perfectman/server/hotel";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../testing/manual-clock.js";
import { ChainExhaustedError, LlmChain, failureClass } from "../llm/chain.js";
import type { MakeProvider } from "../llm/chain.js";
import type { LlmLink } from "../llm/chain-config.js";
import { hostLlmConfig } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";
import { withPickedModel } from "../llm/run-model.js";

const A: LlmLink = { name: "opencode-deepseek", baseUrl: "https://opencode.ai/zen/go/v1", apiKeyEnv: "OC_KEY", model: "deepseek-v4.1-flash", sessionHeader: "x-opencode-session" };
const B: LlmLink = { name: "opencode-glm", baseUrl: "https://opencode.ai/zen/go/v1", apiKeyEnv: "OC_KEY", model: "glm-5.3-flash", sessionHeader: "x-opencode-session" };
const C: LlmLink = { name: "lunaris", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "sao10k/l3-lunaris-8b", maxContextTokens: 8192 };
const PRICES = { [A.model]: { inUsdPerMTok: 0, outUsdPerMTok: 0 }, [B.model]: { inUsdPerMTok: 0, outUsdPerMTok: 0 }, [C.model]: { inUsdPerMTok: 0.04, outUsdPerMTok: 0.05 } };
const ENV = { OC_KEY: "oc-test", OR_KEY: "or-test" } as NodeJS.ProcessEnv;
const BASE: LLMConfig = hostLlmConfig({ provider: "openai-compatible", baseUrl: A.baseUrl, apiKeyEnv: "OC_KEY", models: [A.model], chain: [A, B, C], prices: PRICES, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 });

const prompt = (estimate = 2000): BuiltPrompt => ({ system: "s", user: "u", inputTokensEstimate: estimate, purpose: "action_intent", version: "v", templateVersion: "t" });
const ok = (over: Partial<LLMProviderResult> = {}): LLMProviderResult => ({ content: "{}", usage: { inputTokens: 2400, outputTokens: 100 }, latencyMs: 1500, model: "x", ...over });

type Step = LLMProviderResult | Error | (() => Promise<LLMProviderResult>);
type Script = Record<string, Step[]>;

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

function chain(script: Script, links: LlmLink[] = [A, B, C], clock = new ManualClock(), extra: Partial<ConstructorParameters<typeof LlmChain>[0]> = {}) {
  const s = scripted(script);
  const governor = new LlmGovernor(clock, () => 0.5);
  const c = new LlmChain({ links, clock, runId: 42, simulationId: "sim", governor, prices: PRICES, env: ENV, makeProvider: s.make, ...extra });
  const p = c.provider(BASE, "duda");
  const call = (estimate?: number) => p.generateIntent(undefined as never, undefined as never, prompt(estimate));
  return { c, clock, call, ...s };
}

const QUOTA = () => new LLMHttpError(429, '{"type":"error","error":{"type":"GoUsageLimitError","message":"Go usage limit exceeded"}}', { "retry-after": "155092" });

describe("a half-open trial that ends in a spent quota or a refused key", () => {
  it("does not leave the breaker half-open for the rest of the run: the link is tried again after its cooldown", async () => {
    const { c, call, calls, clock } = chain({ [A.model]: [new LLMHttpError(500, "down"), new LLMHttpError(500, "down"), new LLMHttpError(500, "down"), QUOTA(), ok()] }, [A, C]);
    for (let i = 0; i < 3; i++) await call();
    expect(c.snapshot().links[0]).toMatchObject({ breaker: "open", failures: 3 });
    // The first half-open trial lands on the provider's quota 429: the link goes into its cooldown.
    await clock.advance(15_000);
    const trial = await call();
    expect(trial.routedModel).toBe("lunaris");
    expect(c.snapshot().links[0]?.cooldownMsLeft).toBeGreaterThan(0);
    expect(c.snapshot().links[0]?.breaker).not.toBe("half_open");
    // Past the cooldown the link must get a trial again (it used to be skipped as breaker_open from here on).
    await clock.advance(60 * 60_000);
    calls.length = 0;
    const back = await call();
    expect(calls[0]).toBe(A.model);
    expect(back.routedModel).toBe("opencode-deepseek");
    expect(c.snapshot().links[0]?.breaker).toBe("closed");
  });

  it("does the same for a refused key (401)", async () => {
    const { c, call, calls, clock } = chain({ [A.model]: [new LLMHttpError(500, "down"), new LLMHttpError(500, "down"), new LLMHttpError(500, "down"), new LLMHttpError(401, "bad key"), ok()] }, [A, C]);
    for (let i = 0; i < 3; i++) await call();
    await clock.advance(15_000);
    await call();
    await clock.advance(10 * 60_000 + 60_000);
    calls.length = 0;
    await call();
    expect(calls[0]).toBe(A.model);
    expect(c.snapshot().links[0]?.breaker).toBe("closed");
  });
});

/** What a fake provider endpoint answers for one request. `hang` never answers; the caller's abort ends it, as a real fetch would. */
type Reply = { status?: number; content?: string; body?: string; hang?: boolean; headers?: Record<string, string> };

/** A fetch with no network: replies are routed by the model in the request body, each model takes its next reply (the last repeats). */
function fakeFetch(routes: Record<string, Reply[]>): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const model = (JSON.parse(String(init?.body)) as { model: string }).model;
    calls.push(model);
    const replies = routes[model] ?? [{ content: "{}" }];
    const reply = replies.length > 1 ? replies.shift()! : replies[0]!;
    if (reply.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")), { once: true });
      });
    }
    const body = reply.body ?? JSON.stringify({ choices: [{ message: { content: reply.content ?? "{}" } }], usage: { prompt_tokens: 1200, completion_tokens: 60 }, model });
    return new Response(body, { status: reply.status ?? 200, headers: { "content-type": "application/json", ...reply.headers } });
  };
  return { fetchImpl, calls };
}

/** Settles a call whose governor sleeps on the manual clock: the clock moves on in small steps while real ticks let the transport run. */
async function drive<T>(pending: Promise<T>, clock: ManualClock, stepMs = 500, maxSteps = 100): Promise<T> {
  let done = false;
  void pending.then(() => (done = true), () => (done = true));
  for (let i = 0; i < maxSteps && !done; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await clock.advance(stepMs);
  }
  return pending;
}

function httpChain(routes: Record<string, Reply[]>, links: LlmLink[] = [A, B, C], clock = new ManualClock()) {
  const f = fakeFetch(routes);
  const c = new LlmChain({ links, clock, runId: 42, simulationId: "sim", governor: new LlmGovernor(clock, () => 0.5), prices: PRICES, env: ENV, fetchImpl: f.fetchImpl });
  const call = (estimate?: number) => c.provider(BASE, "duda").generateIntent({} as never, undefined as never, prompt(estimate));
  return { c, clock, call, ...f };
}

describe("a failing link, through the real transport with a fake fetch", () => {
  it("fails over on a 502, answers from the next link and says why the first was passed over", async () => {
    const { c, call, calls } = httpChain({ [A.model]: [{ status: 502, body: '{"error":{"message":"upstream"}}' }] });
    const r = await call();
    expect(calls).toEqual([A.model, B.model]);
    expect(r).toMatchObject({ routedModel: "opencode-glm", model: B.model, fallbackAttempts: 1 });
    expect(c.snapshot().links.map((l) => l.failReasons)).toEqual([{ http_502: 1 }, {}, {}]);
    expect(c.served[0]).toMatchObject({ link: "opencode-glm", model: B.model, passedOver: 1, passed: ["opencode-deepseek:http_502"] });
    expect(c.counters()).toMatchObject({ "llm_failreason_opencode-deepseek_http_502": 1, "llm_served_opencode-glm": 1 });
  });

  it("retries a plain 429 once on a short wait, then fails over, and never parks the link for it", async () => {
    const { c, call, calls, clock } = httpChain({ [A.model]: [{ status: 429, body: '{"error":{"message":"slow down"}}', headers: { "retry-after": "1" } }] });
    const r = await drive(call(), clock);
    expect(calls).toEqual([A.model, A.model, B.model]);
    expect(r.routedModel).toBe("opencode-glm");
    expect(c.snapshot().links[0]).toMatchObject({ failReasons: { http_429: 1 }, cooldownMsLeft: 0, breaker: "closed" });
  });

  it("takes a spent quota out for its cooldown on the first 429, with no retry", async () => {
    const quota = { status: 429, body: '{"type":"error","error":{"type":"GoUsageLimitError","message":"Go usage limit exceeded"}}', headers: { "retry-after": "155092" } };
    const { c, call, calls } = httpChain({ [A.model]: [quota] });
    await call();
    expect(calls).toEqual([A.model, B.model]);
    expect(c.snapshot().links[0]).toMatchObject({ failReasons: { quota: 1 }, cooldownMsLeft: 60 * 60_000 });
  });

  it("treats an empty reply as a failure of that link and goes on to the next", async () => {
    const { c, call, calls } = httpChain({ [A.model]: [{ content: "" }] });
    const r = await call();
    expect(calls[0]).toBe(A.model);
    expect(r.routedModel).not.toBe("opencode-deepseek");
    expect(c.snapshot().links[0]?.failReasons).toHaveProperty("empty");
    expect(c.served[0]?.passed[0]).toBe("opencode-deepseek:empty");
  });

  it("asks once more, on the same link, for a body that was not JSON, then fails over and counts both", async () => {
    const { c, call, calls } = httpChain({ [A.model]: [{ body: "<html>bad gateway</html>" }] });
    const r = await call();
    expect(calls).toEqual([A.model, A.model, B.model]);
    expect(r.routedModel).toBe("opencode-glm");
    expect(c.snapshot().links[0]?.failReasons).toEqual({ invalid_json: 2 });
    // the blip retry is not a failover of its own: one link passed over, not two
    expect(r.fallbackAttempts).toBe(1);
  });

  it("times out a hung link at its timeoutMs and serves from the next", async () => {
    const hung: LlmLink = { ...A, timeoutMs: 60 };
    const { c, call, calls } = httpChain({ [A.model]: [{ hang: true }] }, [hung, B, C]);
    const started = Date.now();
    const r = await call();
    expect(Date.now() - started).toBeLessThan(2000);
    expect(calls).toEqual([A.model, B.model]);
    expect(r.routedModel).toBe("opencode-glm");
    expect(c.snapshot().links[0]?.failReasons).toEqual({ timeout: 1 });
    expect(c.served[0]?.passed).toEqual(["opencode-deepseek:timeout"]);
  });

  it("serves from the last link when every earlier one failed, each reason recorded", async () => {
    const { c, call } = httpChain({ [A.model]: [{ status: 502 }], [B.model]: [{ content: "" }, { content: "" }], [C.model]: [{ content: "{}" }] });
    const r = await call();
    expect(r.routedModel).toBe("lunaris");
    expect(c.served[0]?.passed).toEqual(["opencode-deepseek:http_502", "opencode-glm:empty"]);
    expect(r.fallbackAttempts).toBe(2);
  });

  it("throws one error naming every link's reason when none answers, and counts the call as exhausted", async () => {
    const { c, call } = httpChain({ [A.model]: [{ status: 500 }], [B.model]: [{ status: 502 }], [C.model]: [{ status: 504 }] });
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChainExhaustedError);
    expect((err as Error).message).toMatch(/opencode-deepseek=http 500, opencode-glm=http 502, lunaris=http 504/);
    expect(c.snapshot().exhausted).toBe(1);
  });
});

describe("failure classes", () => {
  it.each([
    [new LLMHttpError(503, "x"), "http_503"],
    [new LLMHttpError(429, "x"), "http_429"],
    [new LLMHttpError(400, "This model's maximum context length is 4096 tokens"), "context"],
    [new LLMTimeoutError("Request timed out after 5000ms."), "timeout"],
    [new Error("Invalid JSON response from provider"), "invalid_json"],
    [new Error("Empty or missing content in OpenAI completion choices."), "empty"],
    [new TypeError("fetch failed"), "network"],
    [new Error("something else"), "error"],
    ["a string", "error"],
  ])("%s is %s", (err, cls) => {
    expect(failureClass(err)).toBe(cls);
  });
});

describe("a breaker needs consecutive failures and a link recovers", () => {
  it("does not open on failures a success interrupts, however many in all", async () => {
    // fail, fail, ok, fail, fail, ok, ...: never 3 in a row
    const steps: Reply[] = [];
    for (let i = 0; i < 6; i++) steps.push({ status: 502 }, { status: 502 }, { content: "{}" });
    const { c, call } = httpChain({ [A.model]: steps });
    for (let i = 0; i < 18; i++) await call();
    const a = c.snapshot().links[0]!;
    expect(a.breaker).toBe("closed");
    expect(a.failures).toBe(12);
    expect(a.served).toBe(6);
    expect(a.skipped.breaker_open ?? 0).toBe(0);
  });

  it("opens on 3 in a row, skips the link without a call while open, and one good trial after 15 s brings it back", async () => {
    const { c, call, calls, clock } = httpChain({ [A.model]: [{ status: 502 }, { status: 502 }, { status: 502 }, { content: "{}" }] });
    for (let i = 0; i < 3; i++) await call();
    expect(c.snapshot().links[0]?.breaker).toBe("open");
    calls.length = 0;
    await call();
    expect(calls).toEqual([B.model]);
    await clock.advance(15_000);
    calls.length = 0;
    const back = await call();
    expect(calls).toEqual([A.model]);
    expect(back.routedModel).toBe("opencode-deepseek");
    expect(c.snapshot().links[0]?.breaker).toBe("closed");
  });
});

describe("the deadline bounds every attempt", () => {
  const slowTimeout = (ms: number, clockRef: ManualClock) => async (): Promise<LLMProviderResult> => {
    await clockRef.advance(ms);
    throw new LLMTimeoutError(`Request timed out after ${ms}ms.`);
  };

  it("gives a link behind two slow ones only what is left of the 13 s, and never more than its own timeout", async () => {
    const clock = new ManualClock();
    const { call, configs } = chain({ [A.model]: [slowTimeout(5000, clock)], [B.model]: [slowTimeout(5000, clock)] }, [A, B, C], clock);
    await call();
    expect(configs.map((x) => [x.modelName, x.timeoutMs])).toEqual([[A.model, 5000], [B.model, 5000], [C.model, 3000]]);
  });

  it("cuts a link's long explicit timeout to the deadline", async () => {
    const { call, configs } = chain({}, [{ ...A, timeoutMs: 60_000 }, B]);
    await call();
    expect(configs[0]?.timeoutMs).toBe(13_000);
  });

  it("skips the next link for the deadline once under 1.5 s is left, and throws naming it", async () => {
    const clock = new ManualClock();
    const { c, call, calls } = chain({ [A.model]: [slowTimeout(6000, clock)], [B.model]: [slowTimeout(6000, clock)] }, [{ ...A, timeoutMs: 6000 }, { ...B, timeoutMs: 6000 }, C], clock);
    const err = await call().catch((e: unknown) => e);
    expect(calls).toEqual([A.model, B.model]);
    expect(err).toBeInstanceOf(ChainExhaustedError);
    expect((err as Error).message).toMatch(/lunaris=skipped\(deadline\)/);
    expect(c.snapshot().links[2]?.skipped.deadline).toBe(1);
  });

  it("bounds the narrator's chain deadline the same way", async () => {
    const clock = new ManualClock();
    const { configs, call } = chain({ [A.model]: [slowTimeout(4000, clock)] }, [{ ...A, timeoutMs: 4000 }, { ...B, timeoutMs: 4000 }, C], clock, { deadlineMs: 8000 });
    await call();
    expect(configs.map((x) => [x.modelName, x.timeoutMs])).toEqual([[A.model, 4000], [B.model, 4000]]);
  });
});

describe("a link's timeout follows its own latency when the config does not set one", () => {
  const fast = (latencyMs: number) => ok({ latencyMs });

  it("stays at the 5 s default until the link has 10 successful calls, then waits 1.5 times their p95", async () => {
    const { call, configs } = chain({ [A.model]: [fast(5900)] }, [A, B]);
    for (let i = 0; i < 10; i++) await call();
    expect(new Set(configs.slice(0, 10).map((x) => x.timeoutMs))).toEqual(new Set([5000]));
    await call();
    expect(configs[10]?.timeoutMs).toBe(8850);
  });

  it("never moves a timeoutMs that the config sets", async () => {
    const { call, configs } = chain({ [A.model]: [fast(5900)] }, [{ ...A, timeoutMs: 5000 }, B]);
    for (let i = 0; i < 12; i++) await call();
    expect(new Set(configs.map((x) => x.timeoutMs))).toEqual(new Set([5000]));
  });

  it("is capped at 9 s and bounded by what is left of the deadline", async () => {
    const clock = new ManualClock();
    const { call, configs } = chain({ [A.model]: [fast(12_000)] }, [A, B], clock);
    for (let i = 0; i < 11; i++) await call();
    expect(configs.at(-1)?.timeoutMs).toBe(9000);
    // a fresh chain deadline is 13 s, so 9 s fits; an 8 s deadline leaves less
    const short = chain({ [A.model]: [fast(12_000)] }, [A, B], new ManualClock(), { deadlineMs: 7000 });
    for (let i = 0; i < 11; i++) await short.call();
    expect(short.configs.at(-1)?.timeoutMs).toBe(7000);
  });

  it("does not let failures raise it: only successful calls make the p95", async () => {
    const clock = new ManualClock();
    const { call, configs } = chain({ [A.model]: [async () => { await clock.advance(5000); throw new LLMTimeoutError("t"); }] }, [A, B], clock);
    for (let i = 0; i < 12; i++) await call();
    expect(new Set(configs.filter((x) => x.modelName === A.model).map((x) => x.timeoutMs))).toEqual(new Set([5000]));
  });
});

describe("a model the admin picked", () => {
  const PICK_MODEL = { id: "sao10k/l3-lunaris-8b", context: 8192 };
  const links = (): LlmLink[] => withPickedModel([A, C], PICK_MODEL);

  it("is link 1, named pick, with its tier", () => {
    const [pick] = links();
    expect(pick).toMatchObject({ name: "pick", model: PICK_MODEL.id, tier: "experimental" });
    const { c } = httpChain({}, links());
    expect(c.snapshot().links.map((l) => [l.name, l.tier])).toEqual([["pick", "experimental"], ["opencode-deepseek", "recommended"]]);
  });

  it.each([
    ["a body that was not JSON", { body: "not json at all" }, "invalid_json"],
    ["a 502", { status: 502 }, "http_502"],
    ["a 401", { status: 401, body: '{"error":{"message":"bad key"}}' }, "auth"],
    ["an empty reply", { content: "" }, "empty"],
  ] as Array<[string, Reply, string]>)("fails over to the configured chain on %s, records why, and the run keeps going", async (_name, reply, cls) => {
    const { c, call, calls } = httpChain({ [PICK_MODEL.id]: [reply] }, links());
    const first = await call();
    expect(first.routedModel).toBe("opencode-deepseek");
    expect(calls[0]).toBe(PICK_MODEL.id);
    expect(c.snapshot().links[0]?.failReasons).toHaveProperty(cls);
    expect(c.served[0]?.passed[0]).toBe(`pick:${cls}`);
    const second = await call();
    expect(second.model).toBe(A.model);
    expect(c.counters()).toMatchObject({ "llm_served_opencode-deepseek": 2, llm_served_pick: 0, llm_failovers: expect.any(Number) });
  });

  it("fails over when the pick hangs past its timeout", async () => {
    const pick: LlmLink = { ...links()[0]!, timeoutMs: 60 };
    const { c, call } = httpChain({ [PICK_MODEL.id]: [{ hang: true }] }, [pick, A, C]);
    const r = await call();
    expect(r.routedModel).toBe("opencode-deepseek");
    expect(c.snapshot().links[0]?.failReasons).toEqual({ timeout: 1 });
  });

  it("serves from the pick when it answers, and the run's per-link mix says which model that was", async () => {
    const { c, call } = httpChain({}, links());
    for (let i = 0; i < 3; i++) await call();
    expect(c.snapshot().links.map((l) => [l.name, l.model, l.served])).toEqual([["pick", PICK_MODEL.id, 3], ["opencode-deepseek", A.model, 0]]);
  });
});
