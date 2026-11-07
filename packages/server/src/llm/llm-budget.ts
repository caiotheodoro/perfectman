import type { LLMUsage, BudgetPriority, OperatorEvent } from "@perfectman/shared";
import type {
  BudgetMode,
  BudgetSoftLimits,
  GetPriorityOptions,
  LlmUsageGetter,
  RunUsage,
} from "../simulation/hotel-runtime-api.js";

export type LLMBudgetRequest = {
  simulationId: string;
  agentId: string;
  priority: BudgetPriority;
  inputTokensEstimate?: number;
};

export type LLMBudgetDecision = {
  allowed: boolean;
  reason?: string;
};

export type LLMBudgetStatus = {
  simulationId: string;
  callsThisMinute: number;
  tokensThisHour: number;
  agentUsage: Record<string, { calls: number; tokens: number }>;
};

export interface SimulationBudgetLimits {
  llmCallBudgetPerMinute: number;
  tokenBudgetPerHour: number;
  /**
   * ADR-0025: `enforce` (default, every existing path) denies calls past the
   * hard limits. `warn` never denies: it only emits one `llm_budget_warning`
   * per window when 80% of the soft limits is crossed.
   */
  mode?: BudgetMode;
  /** Warn-mode thresholds. Falls back to the hard limits when absent. */
  softLimits?: BudgetSoftLimits;
}

/** Called with the `llm_budget_warning` operator event; the hotel bridges it to its notice path. */
export type BudgetWarningListener = (event: OperatorEvent) => void;

export type LatencyStats = { count: number; p50: number; p95: number; max: number };

const WARN_FRACTION = 0.8;
const LATENCY_SAMPLE_CAP = 500;

/** Nearest-rank percentile over an ascending-sorted array (0 when empty). */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

/** Builds the `llm_budget_warning` operator event (the one emission site for the type). */
export function budgetWarningEvent(params: {
  simulationId: string;
  kind: "calls" | "tokens";
  used: number;
  limit: number;
  pulseIndex?: number;
}): OperatorEvent {
  const unit = params.kind === "calls" ? "calls this minute" : "tokens this hour";
  return {
    type: "llm_budget_warning",
    simulationId: params.simulationId,
    pulseIndex: params.pulseIndex ?? 0,
    detail: `LLM usage is at ${params.used}/${params.limit} ${unit} (soft limit, still allowed)`,
    data: { kind: params.kind, used: params.used, limit: params.limit },
    createdAt: Date.now(),
  };
}

/**
 * Budget registration for hotel runs (D11): the hard limits are effectively
 * unbounded and the tracker runs in `warn` mode, so a busy room can never go
 * mute because of the budget. Soft limits only drive the warning; the hotel
 * passes env-derived values (`PERFECTMAN_LLM_SOFT_*`).
 */
export const HOTEL_HARD_CALLS_PER_MINUTE = 1_000_000;
export const HOTEL_HARD_TOKENS_PER_HOUR = 1_000_000_000;
export const HOTEL_DEFAULT_SOFT_LIMITS: BudgetSoftLimits = { callsPerMinute: 120, tokensPerHour: 6_000_000 };

export function hotelBudgetRegistration(soft?: Partial<BudgetSoftLimits>): SimulationBudgetLimits {
  return {
    llmCallBudgetPerMinute: HOTEL_HARD_CALLS_PER_MINUTE,
    tokenBudgetPerHour: HOTEL_HARD_TOKENS_PER_HOUR,
    mode: "warn",
    softLimits: { ...HOTEL_DEFAULT_SOFT_LIMITS, ...soft },
  };
}

const CALL_WINDOW_MS = 60 * 1000; // 1 minute
const TOKEN_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export class LLMBudgetTracker implements LlmUsageGetter {
  private warningListeners = new Set<BudgetWarningListener>();
  // simulationId -> per-kind timestamp of the last warning (one per window)
  private lastWarnAt = new Map<string, { calls?: number; tokens?: number }>();
  // simulationId -> cumulative totals (survive the sliding-window cleanup)
  private totals = new Map<string, { calls: number; inputTokens: number; outputTokens: number }>();
  private agentTotals = new Map<string, Map<string, { calls: number; tokens: number }>>();
  // simulationId -> last LATENCY_SAMPLE_CAP call latencies (ms)
  private latencies = new Map<string, number[]>();

  // In-memory records
  private limits = new Map<string, SimulationBudgetLimits>();
  
  // simulationId -> timestamps of calls
  private calls = new Map<string, number[]>();
  // simulationId -> { timestamp, tokens }
  private tokens = new Map<string, { timestamp: number; tokens: number }[]>();
  
  // simulationId -> agentId -> timestamps of calls
  private agentCalls = new Map<string, Map<string, number[]>>();
  // simulationId -> agentId -> { timestamp, tokens }
  private agentTokens = new Map<string, Map<string, { timestamp: number; tokens: number }[]>>();

  private defaultLimits: SimulationBudgetLimits = {
    llmCallBudgetPerMinute: 20,
    tokenBudgetPerHour: 50000,
  };

  /**
   * Register or update limits for a simulation.
   */
  registerLimits(simulationId: string, limits: Partial<SimulationBudgetLimits>): void {
    const existing = this.limits.get(simulationId) || { ...this.defaultLimits };
    this.limits.set(simulationId, {
      ...existing,
      ...limits,
    });
  }

  /**
   * Get limits for a simulation (falls back to defaults if not registered).
   */
  getLimits(simulationId: string): SimulationBudgetLimits {
    return this.limits.get(simulationId) || this.defaultLimits;
  }

  /**
   * Clear all usage data for a simulation (useful for testing).
   */
  reset(simulationId?: string): void {
    if (simulationId) {
      this.calls.delete(simulationId);
      this.tokens.delete(simulationId);
      this.agentCalls.delete(simulationId);
      this.agentTokens.delete(simulationId);
      this.lastWarnAt.delete(simulationId);
      this.totals.delete(simulationId);
      this.agentTotals.delete(simulationId);
      this.latencies.delete(simulationId);
    } else {
      this.calls.clear();
      this.tokens.clear();
      this.agentCalls.clear();
      this.agentTokens.clear();
      this.lastWarnAt.clear();
      this.totals.clear();
      this.agentTotals.clear();
      this.latencies.clear();
    }
  }

  /**
   * Cleans up expired records for a simulation based on sliding windows.
   */
  private cleanup(simulationId: string, now: number): void {
    const minCallTime = now - CALL_WINDOW_MS;
    const minTokenTime = now - TOKEN_WINDOW_MS;

    // Clean simulation-level calls
    const simCalls = this.calls.get(simulationId);
    if (simCalls) {
      this.calls.set(simulationId, simCalls.filter(t => t >= minCallTime));
    }

    // Clean simulation-level tokens
    const simTokens = this.tokens.get(simulationId);
    if (simTokens) {
      this.tokens.set(simulationId, simTokens.filter(item => item.timestamp >= minTokenTime));
    }

    // Clean agent-level calls
    const simAgentCalls = this.agentCalls.get(simulationId);
    if (simAgentCalls) {
      for (const [agentId, timestamps] of simAgentCalls.entries()) {
        simAgentCalls.set(agentId, timestamps.filter(t => t >= minCallTime));
      }
    }

    // Clean agent-level tokens
    const simAgentTokens = this.agentTokens.get(simulationId);
    if (simAgentTokens) {
      for (const [agentId, items] of simAgentTokens.entries()) {
        simAgentTokens.set(agentId, items.filter(item => item.timestamp >= minTokenTime));
      }
    }
  }

  canCall(request: LLMBudgetRequest): LLMBudgetDecision {
    const { simulationId, agentId, priority, inputTokensEstimate = 0 } = request;
    const now = Date.now();
    this.cleanup(simulationId, now);

    // Warn mode (ADR-0025, D11): the budget is a warning, never a denial.
    if (this.getLimits(simulationId).mode === "warn") return { allowed: true };

    if (priority === "blocked") {
      return { allowed: false, reason: "Budget priority is set to blocked" };
    }

    const limits = this.getLimits(simulationId);
    const simCalls = this.calls.get(simulationId) || [];
    const simTokens = this.tokens.get(simulationId) || [];

    const currentCalls = simCalls.length;
    const currentTokens = simTokens.reduce((sum, item) => sum + item.tokens, 0);

    // Completely exhausted check
    if (currentCalls >= limits.llmCallBudgetPerMinute) {
      return { allowed: false, reason: `Call budget exhausted (${currentCalls}/${limits.llmCallBudgetPerMinute} calls per minute)` };
    }

    if (currentTokens + inputTokensEstimate > limits.tokenBudgetPerHour) {
      return { 
        allowed: false, 
        reason: `Token budget exhausted (current: ${currentTokens}, estimated: ${inputTokensEstimate}, limit: ${limits.tokenBudgetPerHour} tokens per hour)` 
      };
    }

    // Priority-based gating near exhaustion
    // If call budget is >= 80% used:
    if (currentCalls >= limits.llmCallBudgetPerMinute * 0.8) {
      if (priority === "low") {
        return { allowed: false, reason: "Low priority call blocked due to high budget consumption (>80%)" };
      }
    }

    // If call budget is >= 95% used:
    if (currentCalls >= limits.llmCallBudgetPerMinute * 0.95) {
      if (priority === "normal") {
        return { allowed: false, reason: "Normal priority call blocked due to critical budget consumption (>95%)" };
      }
    }

    return { allowed: true };
  }

  recordUsage(usage: LLMUsage): void {
    const { simulationId, agentId, inputTokens, outputTokens } = usage;
    // Rate windows are wall-clock sliding windows, so stamp them with
    // Date.now() taken here — never with usage.createdAt, which carries the
    // pulse-relative sim clock (~10^3-10^6). Storing sim-time stamps made
    // cleanup()'s wall-clock filter prune every record on the next call,
    // silently disabling both rate limits (#147). createdAt stays on the sim
    // clock for deterministic replay attribution and never feeds anything
    // the replay fingerprint covers.
    const timestamp = Date.now();

    // Simulation level calls
    if (!this.calls.has(simulationId)) {
      this.calls.set(simulationId, []);
    }
    this.calls.get(simulationId)!.push(timestamp);

    // Simulation level tokens
    if (!this.tokens.has(simulationId)) {
      this.tokens.set(simulationId, []);
    }
    this.tokens.get(simulationId)!.push({ timestamp, tokens: inputTokens + outputTokens });

    // Agent level calls
    if (!this.agentCalls.has(simulationId)) {
      this.agentCalls.set(simulationId, new Map());
    }
    const simAgentCalls = this.agentCalls.get(simulationId)!;
    if (!simAgentCalls.has(agentId)) {
      simAgentCalls.set(agentId, []);
    }
    simAgentCalls.get(agentId)!.push(timestamp);

    // Agent level tokens
    if (!this.agentTokens.has(simulationId)) {
      this.agentTokens.set(simulationId, new Map());
    }
    const simAgentTokens = this.agentTokens.get(simulationId)!;
    if (!simAgentTokens.has(agentId)) {
      simAgentTokens.set(agentId, []);
    }
    simAgentTokens.get(agentId)!.push({ timestamp, tokens: inputTokens + outputTokens });

    const total = this.totals.get(simulationId) ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
    total.calls += 1;
    total.inputTokens += inputTokens;
    total.outputTokens += outputTokens;
    this.totals.set(simulationId, total);
    const perAgent = this.agentTotals.get(simulationId) ?? new Map<string, { calls: number; tokens: number }>();
    const agentTotal = perAgent.get(agentId) ?? { calls: 0, tokens: 0 };
    agentTotal.calls += 1;
    agentTotal.tokens += inputTokens + outputTokens;
    perAgent.set(agentId, agentTotal);
    this.agentTotals.set(simulationId, perAgent);

    if (Number.isFinite(usage.latencyMs) && usage.latencyMs >= 0) {
      const samples = this.latencies.get(simulationId) ?? [];
      samples.push(usage.latencyMs);
      if (samples.length > LATENCY_SAMPLE_CAP) samples.shift();
      this.latencies.set(simulationId, samples);
    }

    this.maybeWarn(simulationId, usage.pulseIndex, timestamp);
  }

  /** Registers a listener for `llm_budget_warning` events; returns an unsubscribe. */
  onWarning(listener: BudgetWarningListener): () => void {
    this.warningListeners.add(listener);
    return () => this.warningListeners.delete(listener);
  }

  /** One warning per kind per window once 80% of the soft limit is used (warn mode only). */
  private maybeWarn(simulationId: string, pulseIndex: number, now: number): void {
    const limits = this.getLimits(simulationId);
    if (limits.mode !== "warn") return;
    this.cleanup(simulationId, now);
    const soft = limits.softLimits ?? {
      callsPerMinute: limits.llmCallBudgetPerMinute,
      tokensPerHour: limits.tokenBudgetPerHour,
    };
    const calls = (this.calls.get(simulationId) ?? []).length;
    const tokens = (this.tokens.get(simulationId) ?? []).reduce((sum, item) => sum + item.tokens, 0);
    const last = this.lastWarnAt.get(simulationId) ?? {};
    const emit = (kind: "calls" | "tokens", used: number, limit: number, windowMs: number): void => {
      if (used < limit * WARN_FRACTION) return;
      const prev = last[kind];
      if (prev !== undefined && now - prev < windowMs) return;
      last[kind] = now;
      this.lastWarnAt.set(simulationId, last);
      const event = budgetWarningEvent({ simulationId, kind, used, limit, pulseIndex });
      for (const listener of this.warningListeners) {
        try {
          listener(event);
        } catch {
          // A broken listener must not break a pulse.
        }
      }
    };
    emit("calls", calls, soft.callsPerMinute, CALL_WINDOW_MS);
    emit("tokens", tokens, soft.tokensPerHour, TOKEN_WINDOW_MS);
  }

  /** Run-level call latency percentiles over the last 500 calls (D53: the run panel's live p95). */
  getLatencyStats(simulationId: string): LatencyStats {
    const samples = [...(this.latencies.get(simulationId) ?? [])].sort((a, b) => a - b);
    return {
      count: samples.length,
      p50: percentile(samples, 0.5),
      p95: percentile(samples, 0.95),
      max: samples.length > 0 ? samples[samples.length - 1]! : 0,
    };
  }

  getUsage(simulationId: string): RunUsage {
    const now = Date.now();
    this.cleanup(simulationId, now);
    const limits = this.getLimits(simulationId);
    const soft = limits.softLimits ?? {
      callsPerMinute: limits.llmCallBudgetPerMinute,
      tokensPerHour: limits.tokenBudgetPerHour,
    };
    const callsThisMinute = (this.calls.get(simulationId) ?? []).length;
    const tokensThisHour = (this.tokens.get(simulationId) ?? []).reduce((sum, item) => sum + item.tokens, 0);
    const total = this.totals.get(simulationId) ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
    const perAgent: RunUsage["perAgent"] = {};
    for (const [agentId, value] of this.agentTotals.get(simulationId) ?? []) perAgent[agentId] = { ...value };
    const warn = this.lastWarnAt.get(simulationId);
    const mode = limits.mode ?? "enforce";
    const base = mode === "warn" ? soft : { callsPerMinute: limits.llmCallBudgetPerMinute, tokensPerHour: limits.tokenBudgetPerHour };
    return {
      simulationId,
      mode,
      calls: total.calls,
      callsThisMinute,
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      tokensThisHour,
      callsFraction: base.callsPerMinute > 0 ? callsThisMinute / base.callsPerMinute : 0,
      tokensFraction: base.tokensPerHour > 0 ? tokensThisHour / base.tokensPerHour : 0,
      priority: this.getPriority(simulationId, ""),
      warned:
        (warn?.calls !== undefined && now - warn.calls < CALL_WINDOW_MS) ||
        (warn?.tokens !== undefined && now - warn.tokens < TOKEN_WINDOW_MS),
      perAgent,
    };
  }

  getStatus(simulationId: string): LLMBudgetStatus {
    const now = Date.now();
    this.cleanup(simulationId, now);

    const simCalls = this.calls.get(simulationId) || [];
    const simTokens = this.tokens.get(simulationId) || [];

    const callsThisMinute = simCalls.length;
    const tokensThisHour = simTokens.reduce((sum, item) => sum + item.tokens, 0);

    const agentUsage: Record<string, { calls: number; tokens: number }> = {};

    const simAgentCalls = this.agentCalls.get(simulationId);
    const simAgentTokens = this.agentTokens.get(simulationId);

    const allAgentIds = new Set<string>();
    if (simAgentCalls) {
      for (const agentId of simAgentCalls.keys()) {
        allAgentIds.add(agentId);
      }
    }
    if (simAgentTokens) {
      for (const agentId of simAgentTokens.keys()) {
        allAgentIds.add(agentId);
      }
    }

    for (const agentId of allAgentIds) {
      const aCalls = simAgentCalls?.get(agentId) || [];
      const aTokens = simAgentTokens?.get(agentId) || [];
      agentUsage[agentId] = {
        calls: aCalls.length,
        tokens: aTokens.reduce((sum, item) => sum + item.tokens, 0),
      };
    }

    return {
      simulationId,
      callsThisMinute,
      tokensThisHour,
      agentUsage,
    };
  }

  /**
   * Priority class for an agent's next call.
   *
   * - `addressed` (ADR-0025 D-94): always `high`, whatever has been consumed.
   *   In enforce mode `canCall` still denies a hard-exhausted budget.
   * - `warn` mode: the same ladder against the SOFT limits (>=50% normal,
   *   >=80% low) but capped at `low`, never `blocked`.
   * - `enforce` mode (default): unchanged ladder against the hard limits.
   */
  getPriority(simulationId: string, _agentId: string, opts?: GetPriorityOptions): BudgetPriority {
    if (opts?.addressed) return "high";
    const now = Date.now();
    this.cleanup(simulationId, now);

    const limits = this.getLimits(simulationId);
    const simCalls = this.calls.get(simulationId) || [];
    const simTokens = this.tokens.get(simulationId) || [];

    const currentCalls = simCalls.length;
    const currentTokens = simTokens.reduce((sum, item) => sum + item.tokens, 0);

    const warn = limits.mode === "warn";
    const callLimit = warn ? (limits.softLimits?.callsPerMinute ?? limits.llmCallBudgetPerMinute) : limits.llmCallBudgetPerMinute;
    const tokenLimit = warn ? (limits.softLimits?.tokensPerHour ?? limits.tokenBudgetPerHour) : limits.tokenBudgetPerHour;

    if (!warn && (currentCalls >= callLimit || currentTokens >= tokenLimit)) {
      return "blocked";
    }

    if (currentCalls >= callLimit * 0.8 || currentTokens >= tokenLimit * 0.8) {
      return "low";
    }

    if (currentCalls >= callLimit * 0.5 || currentTokens >= tokenLimit * 0.5) {
      return "normal";
    }

    return "high";
  }
}

// Export a singleton instance for global in-memory tracking
export const llmBudget = new LLMBudgetTracker();
