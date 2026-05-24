export type EventType =
  | "message_sent"
  | "reply_sent"
  | "reaction_sent"
  | "typing_started"
  | "typing_cancelled"
  | "channel_created"
  | "agent_invited"
  | "agent_left"
  | "presence_changed"
  | "intent_delayed"
  | "intent_blocked"
  | "memory_written"
  | "no_op_recorded"
  | "private_motive_summary"
  | "operator_warning"
  | "llm_failure"
  | "simulation_started"
  | "simulation_paused"
  | "simulation_resumed"
  | "simulation_stopped"
  | "recap_generated"
  | "reflection_completed"
  | "stagnation_detected";

export type EmotionalSalience = "low" | "medium" | "high" | "critical";

export type EventPayloadPrimitive = string | number | boolean | null;
export type EventPayloadValue = EventPayloadPrimitive | EventPayloadValue[] | { [key: string]: EventPayloadValue };
export type EventPayload = Record<string, EventPayloadValue>;

export type EventVisibility = {
  visibleToAgents: string[]; // agent IDs, empty = all in channel
  visibleToSpectators: boolean;
  visibleToOperators: boolean; // always true
  visibilityReason: string;
};

export type SimulationEvent = {
  id?: string; // assigned on commit
  simulationId: string;
  channelId: string;
  actorId: string;
  type: EventType;
  payload: EventPayload;
  createdAt?: number; // assigned on commit
  pulseIndex?: number; // assigned on commit
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
