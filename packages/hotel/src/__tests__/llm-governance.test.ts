import { LLMHttpError } from "@perfectman/server/hotel";
import type { LLMProvider, LLMProviderResult } from "@perfectman/server/hotel";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../clock/manual-clock.js";
import { LlmCircuitBreaker } from "../llm/breaker.js";
import { hostLlmConfig, ModelNotAllowedError } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";
import { LlmMeter } from "../llm/meter.js";

const OK: LLMProviderResult = { content: "{}", usage: { inputTokens: 1000, outputTokens: 100 }, latencyMs: 50, model: "m" };
const call = (p: LLMProvider) => p.generateIntent(undefined as never, undefined as never, undefined as never);

describe("LLM circuit breaker (ADR-0025, D49)", () => {
  function breaker(probes: boolean[]) {
    const clock = new ManualClock();
    const events: string[] = [];
    const b = new LlmCircuitBreaker({
      clock,
      probe: async () => probes.shift() ?? true,
      onOpen: () => events.push("open"),
      onClose: () => events.push("close"),
    });
    return { clock, events, b };
  }

  it("opens after 5 consecutive provider failures and pauses the run once", async () => {
    const { events, b } = breaker([]);
    for (let i = 0; i < 4; i++) b.recordFailure();
    expect(b.getState().phase).toBe("closed");
    b.recordSuccess();
    for (let i = 0; i < 4; i++) b.recordFailure();
    expect(events).toEqual([]);
    b.recordFailure();
    expect(events).toEqual(["open"]);
    expect(b.getState()).toMatchObject({ phase: "open", pausedRun: true, backoffMs: 15_000 });
    b.dispose();
  });

  it("half-opens after 15 s, and ONE good probe closes it and resumes the run", async () => {
    const { clock, events, b } = breaker([true]);
    for (let i = 0; i < 5; i++) b.recordFailure();
    await clock.advance(14_999);
    expect(b.getState().phase).toBe("open");
    await clock.advance(1);
    expect(events).toEqual(["open", "close"]);
    expect(b.getState()).toMatchObject({ phase: "closed", consecutiveFailures: 0, pausedRun: false });
  });

  it("doubles the backoff on failed probes up to 5 min without re-announcing the pause", async () => {
    const { clock, events, b } = breaker([false, false, false, false, false, false]);
    for (let i = 0; i < 5; i++) b.recordFailure();
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      await clock.advance(b.getState().backoffMs);
      seen.push(b.getState().backoffMs);
    }
    expect(seen).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    expect(events).toEqual(["open"]);
    b.dispose();
  });
});

describe("LLM governor", () => {
  it("shares a 429 penalty window across callers, with jittered exponential backoff", async () => {
    const clock = new ManualClock();
    const gov = new LlmGovernor(clock, () => 0.5, { baseMs: 1000 });
    let n = 0;
    const flaky: LLMProvider = {
      generateIntent: async () => {
        if (n++ < 2) throw new LLMHttpError(429, "slow down");
        return OK;
      },
    };
    const wrapped = gov.wrap(flaky, { onSuccess: () => undefined, onFailure: () => undefined });
    await expect(call(wrapped)).rejects.toThrow(/429/);
    expect(gov.penaltyMsLeft).toBe(1000);
    const second = call(wrapped).catch((e: unknown) => e);
    await clock.advance(1000);
    expect(await second).toBeInstanceOf(LLMHttpError);
    expect(gov.penaltyMsLeft).toBe(2000);
    const third = call(wrapped);
    await clock.advance(2000);
    expect(await third).toBe(OK);
    expect(gov.penaltyMsLeft).toBe(0);
  });

  it("reports successes and failures to the hooks, and does not penalize non-429 errors", async () => {
    const clock = new ManualClock();
    const gov = new LlmGovernor(clock);
    const seen: string[] = [];
    const bad: LLMProvider = { generateIntent: async () => Promise.reject(new LLMHttpError(500, "boom")) };
    await expect(call(gov.wrap(bad, { onSuccess: () => seen.push("ok"), onFailure: () => seen.push("fail") }))).rejects.toThrow();
    await call(gov.wrap({ generateIntent: async () => OK }, { onSuccess: () => seen.push("ok"), onFailure: () => seen.push("fail") }));
    expect(seen).toEqual(["fail", "ok"]);
    expect(gov.penaltyMsLeft).toBe(0);
  });
});

describe("LLM meter and env config", () => {
  it("prices tokens from the env table and reports live p50/p95, flagging p95 drift above 6 s", () => {
    const m = new LlmMeter({ m: { inUsdPerMTok: 2, outUsdPerMTok: 10 } });
    for (let i = 0; i < 20; i++) m.recordSuccess("m", 1000, 100, 1000 + i * 100);
    m.recordFailure();
    expect(m.snapshot()).toMatchObject({ calls: 21, failures: 1, tokensIn: 20_000, tokensOut: 2000, costUsd: 0.06, p50Ms: 1900, p95Ms: 2800, p95Drift: false });
    for (let i = 0; i < 20; i++) m.recordSuccess("m", 1, 1, 9000);
    expect(m.snapshot().p95Drift).toBe(true);
  });

  it("builds every actor's config from the host env and refuses a model outside the allowlist", () => {
    const env = { provider: "openai-compatible" as const, baseUrl: "https://llm.example/v1", apiKeyEnv: "PERFECTMAN_LLM_API_KEY" as const, models: ["fast", "slow"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 };
    expect(hostLlmConfig(env)).toMatchObject({ providerType: "openai-compatible", modelName: "fast", apiKeyEnv: "PERFECTMAN_LLM_API_KEY", baseUrl: "https://llm.example/v1", responseFormatJsonSchema: true });
    expect(hostLlmConfig(env, "slow").modelName).toBe("slow");
    expect(() => hostLlmConfig(env, "rogue")).toThrow(ModelNotAllowedError);
  });
});
