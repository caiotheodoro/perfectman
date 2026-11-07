import { LLMHttpError } from "@perfectman/server/hotel";
import type { LLMProvider, LLMProviderResult } from "@perfectman/server/hotel";
import type { OperatorEvent } from "@perfectman/shared";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../testing/manual-clock.js";
import { BreakerDriver } from "../llm/breaker.js";
import { hostLlmConfig, ModelNotAllowedError } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";
import { LlmMeter } from "../llm/meter.js";

const OK: LLMProviderResult = { content: "{}", usage: { inputTokens: 1000, outputTokens: 100 }, latencyMs: 50, model: "m" };
const call = (p: LLMProvider) => p.generateIntent(undefined as never, undefined as never, undefined as never);
const SIM = "hotel-run-1";

/** What the scheduler emits for one resolved intent: the motive says whether the provider answered. */
const intentEvent = (motive: string): OperatorEvent => ({ type: "action_intent", simulationId: SIM, pulseIndex: 1, detail: "x", data: { privateMotiveSummary: motive }, createdAt: 0 });
const failed = () => intentEvent("Provider failed: HTTP 503");
const answered = () => intentEvent("quero falar com ele");
/** A generateIntent that threw before the step ran: the scheduler's own marker. */
const threw = (): OperatorEvent => ({ type: "llm_failure", simulationId: SIM, pulseIndex: 1, detail: "boom", data: { reason: "boom", stage: "generate", providerFailure: true }, createdAt: 0 });

describe("LLM circuit breaker driver (ADR-0025, D49)", () => {
  function breaker(probes: boolean[], over: { onOpen?: boolean } = {}) {
    const clock = new ManualClock();
    const events: string[] = [];
    const b = new BreakerDriver({
      clock,
      simulationId: SIM,
      probe: async () => probes.shift() ?? true,
      onOpen: () => {
        events.push("open");
        return over.onOpen ?? true;
      },
      onClose: (paused) => events.push(`close:${paused}`),
      notice: (code) => events.push(`notice:${code}`),
    });
    const feed = (e: OperatorEvent): void => b.gateway.observe(e);
    return { clock, events, b, feed };
  }

  it("opens after 5 consecutive provider failures and pauses the run once", () => {
    const { events, b, feed } = breaker([]);
    for (let i = 0; i < 4; i++) feed(failed());
    expect(b.getState().phase).toBe("closed");
    feed(answered());
    for (let i = 0; i < 4; i++) feed(failed());
    expect(events).toEqual([]);
    feed(failed());
    expect(events).toEqual(["open", "notice:llm_circuit_open"]);
    expect(b.getState()).toMatchObject({ phase: "open", pausedRun: true, backoffMs: 15_000 });
    b.dispose();
  });

  it("counts a generateIntent that threw before the step ran (no action_intent follows)", () => {
    const { events, b, feed } = breaker([]);
    for (let i = 0; i < 3; i++) feed(threw());
    feed(failed());
    feed(threw());
    expect(events).toContain("open");
    expect(b.getState().phase).toBe("open");
    b.dispose();
  });

  it("half-opens after 15 s, and ONE good probe closes it and resumes the run", async () => {
    const { clock, events, b, feed } = breaker([true]);
    for (let i = 0; i < 5; i++) feed(failed());
    await clock.advance(14_999);
    expect(b.getState().phase).toBe("open");
    await clock.advance(1);
    expect(events).toEqual(["open", "notice:llm_circuit_open", "notice:llm_circuit_closed", "close:true"]);
    expect(b.getState()).toMatchObject({ phase: "closed", consecutiveFailures: 0, pausedRun: false });
  });

  it("doubles the backoff on failed probes up to 5 min without re-announcing the pause", async () => {
    const { clock, events, b, feed } = breaker([false, false, false, false, false, false]);
    for (let i = 0; i < 5; i++) feed(failed());
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) {
      await clock.advance(b.getState().backoffMs);
      seen.push(b.getState().backoffMs);
    }
    expect(seen).toEqual([30_000, 60_000, 120_000, 240_000, 300_000, 300_000]);
    expect(events).toEqual(["open", "notice:llm_circuit_open"]);
    b.dispose();
  });

  it("does not claim a pause an admin already holds, so it never resumes the run", async () => {
    const { clock, events, b, feed } = breaker([true], { onOpen: false });
    for (let i = 0; i < 5; i++) feed(failed());
    expect(b.getState().pausedRun).toBe(false);
    await clock.advance(15_000);
    expect(events).toEqual(["open", "notice:llm_circuit_open", "notice:llm_circuit_closed", "close:false"]);
  });
});

describe("LLM governor (server governProvider on the hotel clock)", () => {
  it("honors Retry-After from the error headers, shares the penalty window and adds the wait to latency", async () => {
    const clock = new ManualClock();
    const gov = new LlmGovernor(clock, () => 0.5);
    let n = 0;
    const flaky: LLMProvider = {
      generateIntent: async () => {
        if (n++ < 1) throw new LLMHttpError(429, "slow down", { "retry-after": "2" });
        return OK;
      },
    };
    const wrapped = gov.wrap(flaky, { onSuccess: () => undefined, onFailure: () => undefined });
    const first = call(wrapped);
    await clock.advance(0);
    expect(gov.penaltyMsLeft).toBe(2000);
    // Another run's provider waits out the same window.
    const other = call(gov.wrap({ generateIntent: async () => OK }, { onSuccess: () => undefined, onFailure: () => undefined }));
    await clock.advance(1999);
    expect(n).toBe(1);
    await clock.advance(1);
    expect((await first).latencyMs).toBe(OK.latencyMs + 2000);
    expect((await other).latencyMs).toBe(OK.latencyMs + 2000);
    expect(gov.penaltyMsLeft).toBe(0);
  });

  it("backs off with jitter when there is no Retry-After, and caps a long Retry-After under the generate deadline", async () => {
    const clock = new ManualClock();
    const gov = new LlmGovernor(clock, () => 0.5);
    let n = 0;
    const flaky: LLMProvider = {
      generateIntent: async () => {
        if (n++ === 0) throw new LLMHttpError(429, "slow", { "retry-after": "120" });
        return OK;
      },
    };
    const p = call(gov.wrap(flaky, { onSuccess: () => undefined, onFailure: () => undefined }));
    await clock.advance(0);
    expect(gov.penaltyMsLeft).toBe(10_000);
    await clock.advance(10_000);
    expect(await p).toMatchObject({ latencyMs: OK.latencyMs + 10_000 });
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
