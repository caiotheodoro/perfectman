export type AttentionReason =
  | "direct_mention"
  | "reply_to_self"
  | "high_salience_event"
  | "relational_involvement"
  | "initiative_cadence"
  | "arousal_contagion"
  | "boredom_threshold"
  | "objective_urgency";

export type TriggeringReason =
  | "attention_event"
  | "initiative_cadence"
  | "operator_injection"
  | "cold_start";

export type AttentionResult = {
  noticed: boolean;
  dueScore: number;
  reasons: AttentionReason[];
  needsLLM: boolean;
  triggeringReason: TriggeringReason;
  triggeringEventId?: string;
};
