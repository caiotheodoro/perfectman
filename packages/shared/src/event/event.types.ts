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
  /**
   * A turn the repetition guard blocked structurally — the model produced a
   * near-duplicate of something the agent already said and could not fix it on
   * retry. Deliberately NOT `no_op_recorded`: a no-op is a social act ("silence
   * is a social signal"), while this is the generator degenerating. Folding the
   * two together made both unmeasurable — offline runs showed 72-98% "silence"
   * that was really the guard firing, and probes read it as chosen lurking.
   */
  | "repetition_blocked"
  | "private_motive_summary"
  | "operator_warning"
  | "llm_failure"
  | "simulation_started"
  | "simulation_paused"
  | "simulation_resumed"
  | "simulation_stopped"
  | "reflection_completed"
  | "stagnation_detected"
  | "goal_proposed"
  | "goal_accepted"
  | "goal_declined"
  | "world_verdict"
  | "delusion_gap_sampled"
  | "ending_offered";

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
