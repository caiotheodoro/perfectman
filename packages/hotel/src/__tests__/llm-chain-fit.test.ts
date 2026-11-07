import { LLMHttpError } from "@perfectman/server/hotel";
import type { BuiltPrompt, LLMConfig, LLMProvider, LLMProviderResult } from "@perfectman/server/hotel";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../testing/manual-clock.js";
import { ChainExhaustedError, LlmChain } from "../llm/chain.js";
import type { MakeProvider } from "../llm/chain.js";
import type { LlmLink } from "../llm/chain-config.js";
import { hostLlmConfig } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";

const MYTHO: LlmLink = { name: "mythomax", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "gryphe/mythomax-l2-13b", maxContextTokens: 4096 };
const LUNARIS: LlmLink = { name: "lunaris", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "sao10k/l3-lunaris-8b", maxContextTokens: 8192 };
const GO: LlmLink = { name: "opencode", baseUrl: "https://opencode.ai/zen/go/v1", apiKeyEnv: "OC_KEY", model: "glm-5.3-flash", sessionHeader: "x-opencode-session" };
const PRICES = { "gryphe/mythomax-l2-13b": { inUsdPerMTok: 0.08, outUsdPerMTok: 0.11 }, "sao10k/l3-lunaris-8b": { inUsdPerMTok: 0.04, outUsdPerMTok: 0.05 }, "glm-5.3-flash": { inUsdPerMTok: 0, outUsdPerMTok: 0 } };
const ENV = { OR_KEY: "or-test", OC_KEY: "oc-test" } as NodeJS.ProcessEnv;

const BASE: LLMConfig = hostLlmConfig({ provider: "openai-compatible", baseUrl: MYTHO.baseUrl, apiKeyEnv: "OR_KEY", models: [MYTHO.model], chain: [MYTHO, LUNARIS, GO], prices: PRICES, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 });
const ok = (over: Partial<LLMProviderResult> = {}): LLMProviderResult => ({ content: "{}", usage: { inputTokens: 2400, outputTokens: 100 }, latencyMs: 1500, model: "x", ...over });

type Script = Record<string, Array<LLMProviderResult | Error | (() => Promise<LLMProviderResult>)>>;

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

function chain(script: Script, links: LlmLink[]) {
  const clock = new ManualClock();
  const s = scripted(script);
  const c = new LlmChain({ links, clock, runId: 42, simulationId: "sim", governor: new LlmGovernor(clock, () => 0.5), prices: PRICES, env: ENV, makeProvider: s.make });
  const p = c.provider(BASE, "duda");
  const prompt: BuiltPrompt = { system: "s", user: "u", inputTokensEstimate: 2000, purpose: "action_intent", version: "v", templateVersion: "t" };
  return { c, clock, call: () => p.generateIntent(undefined as never, undefined as never, prompt), ...s };
}

describe("a link that is out for good", () => {
  it("parks a link for a 429 that asks for more than 5 minutes, even when the SDK kept only the plain message (OpenCode Go's weekly cap)", async () => {
    // What the real transport hands over: the message alone ("Go usage limit exceeded"), not the body's error type.
    const weekly = new LLMHttpError(429, "Go usage limit exceeded", { "retry-after": "109869" });
    // MythoMax is out of the way (a 500), so the call reaches the last link.
    const first = chain({ [MYTHO.model]: [new LLMHttpError(500, "x")], [GO.model]: [weekly] }, [MYTHO, GO]);
    await expect(first.call()).rejects.toBeInstanceOf(ChainExhaustedError);
    expect(first.c.snapshot().links[1]).toMatchObject({ cooldownMsLeft: 60 * 60_000, calls: 1 });
    // And the next call does not touch it, nor wait on a penalty window.
    first.calls.length = 0;
    await expect(first.call()).rejects.toBeInstanceOf(ChainExhaustedError);
    expect(first.calls).not.toContain(GO.model);
    expect(first.c.snapshot().links[1]?.skipped.cooldown).toBe(1);
  });
});

describe("a failover link gets a prompt written for it", () => {
  /** What the picked model (8K, compact) would be sent, and what each link is sent when it fails over. */
  const PICK: LlmLink = { name: "pick", baseUrl: MYTHO.baseUrl, apiKeyEnv: "OR_KEY", model: "sao10k/l3-lunaris-8b", maxContextTokens: 8192, promptStyle: "compact", tokenRatio: 1.1 };
  const BLIP = new Error("Invalid JSON response");
  /** MythoMax as the chain parser gives it: with its measured tokenizer ratio, so a 2720-token budget. */
  const M4K: LlmLink = { ...MYTHO, tokenRatio: 1.25 };

  function setup(script: Script, links: LlmLink[], pickPromptTokens = 4200) {
    const clock = new ManualClock();
    const sent: Array<{ model: string; system: string; user: string; est: number; style: string | undefined }> = [];
    const rebuilds: Array<{ cap: number | undefined; style: string }> = [];
    const s = scripted(script);
    const make: MakeProvider = (config, deps) => {
      const inner = s.make(config, deps);
      return { generateIntent: async (a, b, p) => (sent.push({ model: config.modelName, system: p.system, user: p.user, est: p.inputTokensEstimate, style: p.promptStyle }), inner.generateIntent(a, b, p)) };
    };
    const c = new LlmChain({
      links,
      clock,
      runId: 7,
      simulationId: "sim",
      governor: new LlmGovernor(clock, () => 0.5),
      prices: PRICES,
      env: ENV,
      makeProvider: make,
      rebuild: ({ maxInputTokens, style }) => {
        rebuilds.push({ cap: maxInputTokens, style });
        // A compact render that grows with the cap it is given, up to 2.4K, and a full one of 4.6K that a small cap trims down.
        const want = style === "compact" ? 2400 : 4600;
        // Persona, contract and decision are irreducible: nothing renders under 900.
        const est = maxInputTokens === undefined ? want : Math.max(900, Math.min(want, maxInputTokens));
        const system = `${style} base`;
        return { system, user: "u".repeat(est * 4 - system.length), inputTokensEstimate: est, purpose: "action_intent", version: "v", templateVersion: "t", ...(style === "compact" ? { promptStyle: "compact" as const } : {}) };
      },
    });
    const picked: BuiltPrompt = { system: "compact base", user: "u".repeat(pickPromptTokens * 4 - 12), inputTokensEstimate: pickPromptTokens, purpose: "action_intent", version: "v", templateVersion: "t", promptStyle: "compact" };
    return { c, sent, rebuilds, call: (over: Partial<BuiltPrompt> = {}) => c.provider(BASE, "duda").generateIntent(undefined as never, undefined as never, { ...picked, ...over }) };
  }

  it("renders the prompt again for MythoMax's 4K window instead of skipping it, when the pick fails", async () => {
    // The pick's compact prompt is 4.2K, which MythoMax (budget 2720) could never take as is: it used to be skipped for context.
    const { c, sent, rebuilds, call } = setup({ [PICK.model]: [new LLMHttpError(500, "x")] }, [PICK, M4K, GO]);
    const r = await call();
    expect(r.routedModel).toBe("mythomax");
    expect(sent.map((x) => x.model)).toEqual([PICK.model, MYTHO.model]);
    expect(rebuilds).toEqual([{ cap: expect.any(Number), style: "compact" }]);
    expect(rebuilds[0]!.cap).toBeLessThanOrEqual(2720);
    expect(sent[1]!.est).toBeLessThanOrEqual(2720);
    expect(c.snapshot().links[1]).toMatchObject({ served: 1, skipped: {} });
  });

  it("keeps the runtime's own prompt for a link that takes its style and holds it, and never rebuilds for it", async () => {
    const { sent, rebuilds, call } = setup({ [PICK.model]: [new LLMHttpError(500, "x")] }, [PICK, { ...GO, promptStyle: "compact" }]);
    await call({ inputTokensEstimate: 3000 });
    expect(rebuilds).toEqual([]);
    expect(sent[1]!.system.startsWith("compact base")).toBe(true);
  });

  it("writes the full prompt for a failover link with a bigger window, and still skips a link nothing fits", async () => {
    const { sent, rebuilds, call } = setup({ [PICK.model]: [new LLMHttpError(500, "x")] }, [PICK, GO]);
    const r = await call();
    expect(r.routedModel).toBe("opencode");
    expect(rebuilds).toEqual([{ cap: expect.any(Number), style: "full" }]);
    expect(sent[1]!.system.startsWith("full base")).toBe(true);
    // A render that stays over the link's budget (irreducible) is still a skip, not a doomed call.
    const tiny = setup({ [PICK.model]: [new LLMHttpError(500, "x")] }, [PICK, { ...MYTHO, maxContextTokens: 1024 }]);
    await expect(tiny.call()).rejects.toBeInstanceOf(ChainExhaustedError);
    expect(tiny.sent.some((x) => x.model === MYTHO.model)).toBe(false);
  });

  it("puts the retry correction back on the end of the re-rendered prompt", async () => {
    const { sent, call } = setup({ [PICK.model]: [new LLMHttpError(500, "x")] }, [PICK, M4K]);
    // The runtime's retry prompt is the compact render plus the correction note.
    await call({ system: "compact base\n\nNão repita a frase anterior.", retry: "correction" });
    expect(sent.map((x) => x.model)).toEqual([PICK.model, MYTHO.model]);
    expect(sent[1]!.system.startsWith("compact base\n\nNão repita a frase anterior.")).toBe(true);
  });

  it("covers the failover gap from the run: the pick returns a body that is not JSON twice and then MythoMax answers, with no call lost", async () => {
    const { c, sent, call } = setup({ [PICK.model]: [BLIP, BLIP], [GO.model]: [new LLMHttpError(429, "slow down")] }, [PICK, M4K, GO]);
    const r = await call();
    expect(r.routedModel).toBe("mythomax");
    expect(sent.map((x) => x.model)).toEqual([PICK.model, PICK.model, MYTHO.model]);
    expect(c.snapshot().exhausted).toBe(0);
  });

  it("does not ask a link again for a body that was not JSON when it took the attempt's whole timeout to arrive", async () => {
    const clock = new ManualClock();
    const slowBlip = async (): Promise<LLMProviderResult> => {
      await clock.advance(5000);
      throw BLIP;
    };
    const s = scripted({ [PICK.model]: [slowBlip] });
    const c = new LlmChain({ links: [PICK, M4K], clock, runId: 7, simulationId: "sim", governor: new LlmGovernor(clock, () => 0.5), prices: PRICES, env: ENV, makeProvider: s.make });
    const r = await c.provider(BASE, "duda").generateIntent(undefined as never, undefined as never, { system: "s", user: "u", inputTokensEstimate: 1500, purpose: "action_intent", version: "v", templateVersion: "t" });
    expect(r.routedModel).toBe("mythomax");
    expect(s.calls).toEqual([PICK.model, M4K.model]);
  });

  it("asks the pick once more on a body that was not JSON, and serves from it without a failover", async () => {
    const { c, sent, call } = setup({ [PICK.model]: [BLIP, ok()] }, [PICK, M4K]);
    const r = await call();
    expect(r.routedModel).toBe("pick");
    expect(sent.map((x) => x.model)).toEqual([PICK.model, PICK.model]);
    expect(r.fallbackAttempts).toBe(0);
    expect(c.snapshot().failovers).toBe(0);
  });
});
