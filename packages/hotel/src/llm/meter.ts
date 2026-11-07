import type { ModelPrice } from "../config.js";
import { percentile } from "../util/stats.js";
import { LLM_P95_BUDGET_MS } from "./env.js";

export type MeterSnapshot = {
  calls: number;
  failures: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  p50Ms: number | undefined;
  p95Ms: number | undefined;
  /** D53: the live p95 has drifted above the allowlist budget. */
  p95Drift: boolean;
};

const WINDOW = 200;
const MIN_SAMPLES_FOR_DRIFT = 10;

/**
 * Per-run LLM usage: calls, tokens, cost from the env price table, and live
 * p50/p95 over the last 200 successful calls (D53). Warn-only (D11): nothing
 * here blocks a call.
 */
export class LlmMeter {
  private calls = 0;
  private failures = 0;
  private tokensIn = 0;
  private tokensOut = 0;
  private costUsd = 0;
  private readonly latencies: number[] = [];

  constructor(private readonly prices: Readonly<Record<string, ModelPrice>>) {}

  /** `reportedCostUsd` is what the provider billed for the call (OpenRouter's `usage.cost`); it beats the price table. */
  recordSuccess(model: string, inputTokens: number, outputTokens: number, latencyMs: number, reportedCostUsd?: number): void {
    this.calls++;
    this.tokensIn += inputTokens;
    this.tokensOut += outputTokens;
    const price = this.prices[model];
    if (reportedCostUsd !== undefined && Number.isFinite(reportedCostUsd) && reportedCostUsd >= 0) this.costUsd += reportedCostUsd;
    else if (price) this.costUsd += (inputTokens * price.inUsdPerMTok + outputTokens * price.outUsdPerMTok) / 1_000_000;
    this.latencies.push(latencyMs);
    if (this.latencies.length > WINDOW) this.latencies.shift();
  }

  recordFailure(): void {
    this.calls++;
    this.failures++;
  }

  snapshot(): MeterSnapshot {
    const p95 = percentile(this.latencies, 95);
    return {
      calls: this.calls,
      failures: this.failures,
      tokensIn: this.tokensIn,
      tokensOut: this.tokensOut,
      costUsd: Math.round(this.costUsd * 1e6) / 1e6,
      p50Ms: percentile(this.latencies, 50),
      p95Ms: p95,
      p95Drift: this.latencies.length >= MIN_SAMPLES_FOR_DRIFT && p95 !== undefined && p95 > LLM_P95_BUDGET_MS,
    };
  }
}
