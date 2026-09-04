import type { LLMUsage, BudgetPriority } from "@perfectman/shared";

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
}

const CALL_WINDOW_MS = 60 * 1000; // 1 minute
const TOKEN_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export class LLMBudgetTracker {
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
    } else {
      this.calls.clear();
      this.tokens.clear();
      this.agentCalls.clear();
      this.agentTokens.clear();
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

  getPriority(simulationId: string, agentId: string): BudgetPriority {
    const now = Date.now();
    this.cleanup(simulationId, now);

    const limits = this.getLimits(simulationId);
    const simCalls = this.calls.get(simulationId) || [];
    const simTokens = this.tokens.get(simulationId) || [];

    const currentCalls = simCalls.length;
    const currentTokens = simTokens.reduce((sum, item) => sum + item.tokens, 0);

    if (currentCalls >= limits.llmCallBudgetPerMinute || currentTokens >= limits.tokenBudgetPerHour) {
      return "blocked";
    }

    if (currentCalls >= limits.llmCallBudgetPerMinute * 0.8 || currentTokens >= limits.tokenBudgetPerHour * 0.8) {
      return "low";
    }

    if (currentCalls >= limits.llmCallBudgetPerMinute * 0.5 || currentTokens >= limits.tokenBudgetPerHour * 0.5) {
      return "normal";
    }

    return "high";
  }
}

// Export a singleton instance for global in-memory tracking
export const llmBudget = new LLMBudgetTracker();
