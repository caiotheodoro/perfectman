export type EventType = "message_sent" | "reply_sent" | "reaction_sent" | "typing_started" | "typing_cancelled" | "channel_created" | "agent_invited" | "agent_left" | "presence_changed" | "intent_delayed" | "intent_blocked" | "memory_written" | "no_op_recorded" | "private_motive_summary" | "operator_warning" | "llm_failure" | "simulation_started" | "simulation_paused" | "simulation_resumed" | "simulation_stopped" | "recap_generated" | "reflection_completed" | "stagnation_detected";
export type EmotionalSalience = "low" | "medium" | "high" | "critical";
export type EventVisibility = {
    visibleToAgents: string[];
    visibleToSpectators: boolean;
    visibleToOperators: boolean;
    visibilityReason: string;
};
export type SimulationEvent = {
    id?: string;
    simulationId: string;
    channelId: string;
    actorId: string;
    type: EventType;
    payload: Record<string, unknown>;
    createdAt?: number;
    pulseIndex?: number;
    sourceIntentId?: string;
    sourceEventIds: string[];
    emotionalSalience: EmotionalSalience;
    visibility: EventVisibility;
};
/** A committed event always has id, createdAt, and pulseIndex */
export type CommittedEvent = SimulationEvent & {
    id: string;
    createdAt: number;
    pulseIndex: number;
};
//# sourceMappingURL=event.types.d.ts.map