/**
 * 429 governor at the provider seam (ADR-0025 D-96).
 *
 * `governProvider` wraps an `LLMProvider` (use it from the `providerFactory`
 * parameter of `AgentRuntime`). On a 429 it honors `Retry-After`, otherwise
 * applies jittered exponential backoff, and holds a penalty window in a
 * `GovernorShared` that every run's providers share: a provider-wide rate limit
 * is provider-wide, so one run's 429 delays the others instead of each run
 * hammering the endpoint. Non-429 errors are never retried here (the
 * transport's own retry and the circuit breaker own those).
 *
 * It does not record usage: the action-intent step already calls
 * `recordUsage` with the result's `latencyMs`. The returned `latencyMs`
 * includes the time spent waiting, so the run's p95 (D53) is honest.
 */
import type { AgentRuntimeInput } from "@perfectman/shared";
import type { AgentRuntimeContext, BuiltPrompt } from "../agent/agent-runtime.types.js";
import type { LLMProvider, LLMProviderResult } from "./llm-provider.js";

export type GovernorClock = {
  now(): number;
  sleep(ms: number): Promise<void>;
};

export const systemGovernorClock: GovernorClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type GovernorOptions = {
  /** Retries after the first attempt, 429s only. Default 3. */
  maxRetries?: number;
  /** First backoff when the server gave no Retry-After. Default 1000 ms. */
  baseDelayMs?: number;
  /** Upper bound for any single wait, Retry-After included. Default 30 000 ms. */
  maxDelayMs?: number;
  /** 0..1 source for jitter. Default Math.random. */
  rng?: () => number;
  clock?: GovernorClock;
  /** Observability hook: each time a 429 sets or extends the penalty window. */
  onThrottle?: (info: { delayMs: number; attempt: number; retryAfterMs?: number }) => void;
};

/** Penalty window shared by every governed provider in the process. */
export class GovernorShared {
  /** Wall-clock ms before which no governed call should start. */
  penaltyUntil = 0;
  /** Consecutive 429s across all callers; reset by any success. */
  consecutive429 = 0;
  /** Counters for the run panel. */
  throttled = 0;
  waitedMs = 0;
}

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as Record<string, unknown>;
  for (const key of ["status", "statusCode", "status_code"]) {
    if (typeof e[key] === "number") return e[key] as number;
  }
  const cause = e["cause"];
  if (cause && cause !== error) return statusOf(cause);
  return undefined;
}

/**
 * True when the error is a rate limit: a 429 status on the error (or its cause),
 * or, failing that, a message that says so. A status that is present and not
 * 429 is never a rate limit, whatever the message says.
 */
export function isRateLimitError(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== undefined) return status === 429;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /\b429\b|rate[\s_-]?limit|too many requests/i.test(message);
}

function headerOf(headers: unknown, name: string): string | undefined {
  if (typeof headers !== "object" || headers === null) return undefined;
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() === name && (typeof value === "string" || typeof value === "number")) return String(value);
  }
  return undefined;
}

/** `Retry-After` as ms: delta-seconds or an HTTP-date; undefined when absent or unparseable. */
export function parseRetryAfter(value: string | undefined, nowMs: number): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 1000);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}

/** Looks for `retry-after` on the error, its `headers`/`responseHeaders`, and its cause chain. */
export function retryAfterMs(error: unknown, nowMs: number): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth++) {
    const e = current as Record<string, unknown>;
    const raw = headerOf(e["headers"], "retry-after") ?? headerOf(e["responseHeaders"], "retry-after");
    const parsed = parseRetryAfter(raw, nowMs);
    if (parsed !== undefined) return parsed;
    current = e["cause"];
  }
  return undefined;
}

export function governProvider(
  provider: LLMProvider,
  shared: GovernorShared,
  options: GovernorOptions = {},
): LLMProvider {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const rng = options.rng ?? Math.random;
  const clock = options.clock ?? systemGovernorClock;

  return {
    async generateIntent(
      input: AgentRuntimeInput,
      context: AgentRuntimeContext,
      prompt: BuiltPrompt,
    ): Promise<LLMProviderResult> {
      let waited = 0;
      for (let attempt = 0; ; attempt++) {
        const pause = shared.penaltyUntil - clock.now();
        if (pause > 0) {
          await clock.sleep(pause);
          waited += pause;
          shared.waitedMs += pause;
        }
        try {
          const result = await provider.generateIntent(input, context, prompt);
          shared.consecutive429 = 0;
          return waited > 0 ? { ...result, latencyMs: result.latencyMs + waited } : result;
        } catch (error) {
          if (!isRateLimitError(error) || attempt >= maxRetries) throw error;
          shared.consecutive429 += 1;
          shared.throttled += 1;
          const hinted = retryAfterMs(error, clock.now());
          // Full-range jitter on the upper half: 50%..100% of base * 2^(n-1).
          const exp = baseDelayMs * 2 ** Math.min(shared.consecutive429 - 1, 10);
          const backoff = exp * (0.5 + 0.5 * rng());
          const delayMs = Math.min(maxDelayMs, hinted ?? backoff);
          shared.penaltyUntil = Math.max(shared.penaltyUntil, clock.now() + delayMs);
          options.onThrottle?.({ delayMs, attempt, ...(hinted !== undefined ? { retryAfterMs: hinted } : {}) });
        }
      }
    },
  };
}
