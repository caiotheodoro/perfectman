export type OperatorEventType = "llm_failure" | "llm_budget_exceeded" | "intent_blocked" | "intent_delayed" | "rate_limit_hit" | "stagnation_warning" | "scheduler_error" | "pulse_metrics" | "agent_state_snapshot";
export type OperatorEvent = {
    type: OperatorEventType;
    simulationId: string;
    agentId?: string;
    pulseIndex: number;
    detail: string;
    data?: Record<string, unknown>;
    createdAt: number;
};
export type LlmUsage = {
    simulationId: string;
    agentId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    callType: "cognition" | "reflection" | "recap" | "interpretation";
    pulseIndex: number;
    createdAt: number;
};
export type StagnationMetrics = {
    simulationId: string;
    pulseIndex: number;
    bdi: number;
    rdv: number;
    ige: number;
    cue: number;
    eri: number;
    isd: number;
    cns: number;
    compositeScore: number;
    level: "normal" | "yellow" | "red" | "critical";
};
export type OperatorMetrics = {
    pulseIndex: number;
    pulseDurationMs: number;
    agentsCalled: number;
    eventsCommitted: number;
    llmCallsMade: number;
    budgetUsedPercent: number;
    stagnation?: StagnationMetrics;
};
//# sourceMappingURL=operator.types.d.ts.map