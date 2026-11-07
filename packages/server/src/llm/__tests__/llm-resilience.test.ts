import { describe, it, expect, vi, afterEach } from "vitest";
import type { LLMUsage, OperatorEvent } from "@perfectman/shared";
import { LLMBudgetTracker, hotelBudgetRegistration } from "../llm-budget.js";
import { LlmCircuitBreaker, classifyLlmCall } from "../llm-circuit-breaker.js";
import {
  GovernorShared,
  governProvider,
  isRateLimitError,
  parseRetryAfter,
  type GovernorClock,
} from "../llm-governor.js";
import { LLMHttpError } from "../llm-errors.js";
import type { LLMProvider, LLMProviderResult } from "../llm-provider.js";

afterEach(() => vi.useRealTimers());

function usage(over: Partial<LLMUsage> = {}): LLMUsage {
  return {
    simulationId: "sim",
    agentId: "a1",
    model: "m",
    inputTokens: 10,
    outputTokens: 10,
    latencyMs: 100,
    callType: "cognition",
    pulseIndex: 0,
    createdAt: 0,
    ...over,
  };
}

describe("LLMBudgetTracker hotel modes", () => {
  it("enforce is the default and still denies past the hard limit", () => {
    const t = new LLMBudgetTracker();
    t.registerLimits("sim", { llmCallBudgetPerMinute: 2, tokenBudgetPerHour: 1_000_000 });
    t.recordUsage(usage());
    t.recordUsage(usage());
    expect(t.canCall({ simulationId: "sim", agentId: "a1", priority: "high" }).allowed).toBe(false);
    expect(t.getPriority("sim", "a1")).toBe("blocked");
    // addressed is `high` whatever has been consumed
    expect(t.getPriority("sim", "a1", { addressed: true })).toBe("high");
  });

  it("warn mode never denies, never reports blocked, and warns once per window at 80% of the soft limit", () => {
    const t = new LLMBudgetTracker();
    t.registerLimits("sim", { ...hotelBudgetRegistration({ callsPerMinute: 5 }) });
    const warnings: OperatorEvent[] = [];
    t.onWarning((e) => warnings.push(e));
    for (let i = 0; i < 10; i++) t.recordUsage(usage({ latencyMs: (i + 1) * 100 }));
    expect(t.canCall({ simulationId: "sim", agentId: "a1", priority: "blocked" }).allowed).toBe(true);
    expect(t.getPriority("sim", "a1")).toBe("low");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.type).toBe("llm_budget_warning");

    const u = t.getUsage("sim");
    expect(u).toMatchObject({ mode: "warn", calls: 10, callsThisMinute: 10, warned: true, priority: "low" });
    expect(u.callsFraction).toBe(2);
    expect(u.perAgent["a1"]).toEqual({ calls: 10, tokens: 200 });
    expect(t.getLatencyStats("sim")).toEqual({ count: 10, p50: 500, p95: 1000, max: 1000 });
  });

  it("a minute later the warning re-arms", () => {
    vi.useFakeTimers();
    const t = new LLMBudgetTracker();
    t.registerLimits("sim", hotelBudgetRegistration({ callsPerMinute: 2 }));
    const warnings: OperatorEvent[] = [];
    t.onWarning((e) => warnings.push(e));
    t.recordUsage(usage());
    t.recordUsage(usage());
    vi.advanceTimersByTime(61_000);
    t.recordUsage(usage());
    t.recordUsage(usage());
    expect(warnings).toHaveLength(2);
  });
});

describe("LlmCircuitBreaker", () => {
  const motive = (m: string, simulationId = "sim"): OperatorEvent => ({
    type: "action_intent",
    simulationId,
    pulseIndex: 1,
    detail: "x",
    data: { privateMotiveSummary: m },
    createdAt: 0,
  });
  const fail = () => motive("Provider failed: HTTP 503");
  const ok = () => motive("quero falar com ele");

  function setup(onOpen?: () => boolean | void) {
    let now = 1_000;
    const emitted: OperatorEvent[] = [];
    const opened: string[] = [];
    const closed: boolean[] = [];
    const breaker = new LlmCircuitBreaker({
      clock: () => now,
      emit: (e) => emitted.push(e),
      onOpen: (id) => {
        opened.push(id);
        return onOpen?.();
      },
      onClose: (_id, state) => closed.push(state.pausedRun),
    });
    return { breaker, emitted, opened, closed, advance: (ms: number) => (now += ms) };
  }

  it("classifies provider failures only; parse fallbacks count as an answering provider", () => {
    expect(classifyLlmCall(fail())).toBe("provider_failure");
    expect(classifyLlmCall(motive("Retry call failed."))).toBe("provider_failure");
    expect(classifyLlmCall(motive("Fallback applied: No JSON object found"))).toBe("provider_ok");
    expect(classifyLlmCall(motive("LLM budget exceeded: x"))).toBe("ignore");
    expect(classifyLlmCall({ ...fail(), type: "pulse_metrics" })).toBe("ignore");
    // A call that threw out of generateIntent never reaches the step: only the scheduler's own marker counts.
    const threw: OperatorEvent = { ...fail(), type: "llm_failure", data: { reason: "boom", stage: "generate" } };
    expect(classifyLlmCall(threw)).toBe("provider_failure");
    expect(classifyLlmCall({ ...threw, data: { errorDetail: "bad json" } })).toBe("ignore");
  });

  it("opens after 5 consecutive provider failures; parse fallbacks and successes reset the count", async () => {
    const { breaker, opened } = setup();
    for (let i = 0; i < 4; i++) await breaker.sendOperatorEvent(fail());
    await breaker.sendOperatorEvent(motive("Fallback applied: bad json"));
    for (let i = 0; i < 4; i++) await breaker.sendOperatorEvent(fail());
    expect(breaker.getState("sim").phase).toBe("closed");
    await breaker.sendOperatorEvent(fail());
    expect(breaker.getState("sim")).toMatchObject({ phase: "open", pausedRun: true, backoffMs: 15_000, nextProbeAt: 16_000 });
    expect(opened).toEqual(["sim"]);
  });

  it("probes on 15s, 30s, 60s ... and closes after ONE good half-open call", async () => {
    const { breaker, emitted, closed, advance } = setup();
    for (let i = 0; i < 5; i++) await breaker.sendOperatorEvent(fail());
    expect(breaker.shouldProbe("sim")).toBe(false);
    advance(15_000);
    expect(breaker.shouldProbe("sim")).toBe(true);
    breaker.beginProbe("sim");
    await breaker.sendOperatorEvent(fail()); // probe fails: reopen, doubled
    expect(breaker.getState("sim")).toMatchObject({ phase: "open", backoffMs: 30_000 });
    advance(30_000);
    breaker.beginProbe("sim");
    await breaker.sendOperatorEvent(ok());
    expect(breaker.getState("sim")).toMatchObject({ phase: "closed", consecutiveFailures: 0, pausedRun: false, backoffMs: 15_000 });
    expect(closed).toEqual([true]);
    expect(emitted.map((e) => e.type)).toEqual(["llm_circuit_open", "llm_circuit_open", "llm_circuit_closed"]);
  });

  it("backoff caps at 5 minutes", async () => {
    const { breaker, advance } = setup();
    for (let i = 0; i < 5; i++) await breaker.sendOperatorEvent(fail());
    for (let i = 0; i < 8; i++) {
      advance(300_000);
      breaker.beginProbe("sim");
      await breaker.sendOperatorEvent(fail());
    }
    expect(breaker.getState("sim").backoffMs).toBe(300_000);
  });

  it("does not claim a pause an admin already holds", async () => {
    const { breaker, closed } = setup(() => false);
    for (let i = 0; i < 5; i++) await breaker.sendOperatorEvent(fail());
    expect(breaker.getState("sim").pausedRun).toBe(false);
    breaker.beginProbe("sim");
    await breaker.sendOperatorEvent(ok());
    expect(closed).toEqual([false]);
  });

  it("counts per run", async () => {
    const { breaker } = setup();
    for (let i = 0; i < 5; i++) await breaker.sendOperatorEvent(motive("Provider failed: x", "other"));
    expect(breaker.getState("other").phase).toBe("open");
    expect(breaker.getState("sim").phase).toBe("closed");
  });
});

describe("governProvider (429)", () => {
  function fakeClock() {
    let now = 10_000;
    const sleeps: number[] = [];
    const clock: GovernorClock = {
      now: () => now,
      sleep: (ms) => {
        sleeps.push(ms);
        now += ms;
        return Promise.resolve();
      },
    };
    return { clock, sleeps, at: () => now };
  }
  const okResult = (latencyMs = 50): LLMProviderResult => ({ content: "{}", usage: { inputTokens: 1, outputTokens: 1 }, latencyMs, model: "m" });
  const call = (p: LLMProvider) => p.generateIntent({} as never, {} as never, {} as never);

  it("pins the 429 classifier", () => {
    expect(isRateLimitError(new LLMHttpError(429, "slow down"))).toBe(true);
    expect(isRateLimitError(Object.assign(new Error("x"), { statusCode: 429 }))).toBe(true);
    expect(isRateLimitError(Object.assign(new Error("x"), { status_code: 429 }))).toBe(true);
    expect(isRateLimitError(new Error("Rate limit reached for model"))).toBe(true);
    expect(isRateLimitError(new Error("HTTP 429: too many"))).toBe(true);
    expect(isRateLimitError(new LLMHttpError(503, "rate limit upstream"))).toBe(false);
    expect(isRateLimitError(new LLMHttpError(500, "boom"))).toBe(false);
    expect(isRateLimitError(new Error("timed out"))).toBe(false);
  });

  it("parses Retry-After seconds and HTTP-dates", () => {
    expect(parseRetryAfter("3", 0)).toBe(3000);
    expect(parseRetryAfter("0.5", 0)).toBe(500);
    expect(parseRetryAfter(new Date(12_000).toUTCString(), 10_000)).toBe(2000);
    expect(parseRetryAfter("soon", 0)).toBeUndefined();
  });

  it("honors Retry-After, adds the wait to latency, and returns the retried result", async () => {
    const { clock, sleeps } = fakeClock();
    const errors = [new LLMHttpError(429, "slow", { "retry-after": "2" })];
    const inner: LLMProvider = {
      generateIntent: () => (errors.length ? Promise.reject(errors.shift()) : Promise.resolve(okResult(50))),
    };
    const out = await call(governProvider(inner, new GovernorShared(), { clock }));
    expect(sleeps).toEqual([2000]);
    expect(out.latencyMs).toBe(2050);
  });

  it("backs off exponentially with jitter when there is no Retry-After, and gives up after maxRetries", async () => {
    const { clock, sleeps } = fakeClock();
    const inner: LLMProvider = { generateIntent: vi.fn().mockRejectedValue(new LLMHttpError(429, "slow")) };
    await expect(call(governProvider(inner, new GovernorShared(), { clock, rng: () => 1, maxRetries: 3, baseDelayMs: 1000 }))).rejects.toThrow(/429/);
    expect(sleeps).toEqual([1000, 2000, 4000]);
    expect(inner.generateIntent).toHaveBeenCalledTimes(4);
  });

  it("never retries other errors", async () => {
    const { clock } = fakeClock();
    const inner: LLMProvider = { generateIntent: vi.fn().mockRejectedValue(new LLMHttpError(500, "boom")) };
    await expect(call(governProvider(inner, new GovernorShared(), { clock }))).rejects.toThrow(/500/);
    expect(inner.generateIntent).toHaveBeenCalledTimes(1);
  });

  it("one run's 429 delays another run's next call through the shared window", async () => {
    const { clock, sleeps } = fakeClock();
    const shared = new GovernorShared();
    const limited: LLMProvider = { generateIntent: vi.fn().mockRejectedValueOnce(new LLMHttpError(429, "slow", { "retry-after": "5" })).mockResolvedValue(okResult()) };
    const healthy: LLMProvider = { generateIntent: vi.fn().mockResolvedValue(okResult()) };
    // Run A is throttled and waits 5 s; run B starts inside that window and waits for the rest of it.
    const a = call(governProvider(limited, shared, { clock }));
    await a;
    shared.penaltyUntil = clock.now() + 3000;
    const b = await call(governProvider(healthy, shared, { clock }));
    expect(sleeps).toEqual([5000, 3000]);
    expect(b.latencyMs).toBe(3050);
  });
});
