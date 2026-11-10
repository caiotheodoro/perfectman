import { LLMHttpError } from "@perfectman/server/hotel";
import type { BuiltPrompt, LLMConfig, LLMProvider, LLMProviderResult } from "@perfectman/server/hotel";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../testing/manual-clock.js";
import { LlmChain } from "../llm/chain.js";
import type { MakeProvider } from "../llm/chain.js";
import type { LlmLink } from "../llm/chain-config.js";
import { hostLlmConfig } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";

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
