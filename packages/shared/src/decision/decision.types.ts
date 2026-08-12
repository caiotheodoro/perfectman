export type DecisionOutcome = "act" | "delay" | "no_op" | "memory_only";

export type NoOpReason =
  | "noticed_but_ignored"
  | "typing_cancelled"
  | "delayed_intention"
  | "silent_treatment"
  | "stored_memory_only"
  | "watched_private_channel_instead"
  | "waited_for_someone_else"
  | "pretended_not_to_care"
  | "felt_too_uncertain"
  | "lurking_observer";

export type DelayPreference = {
  durationMs: number;
  reason: string;
};

export type Decision = {
  outcome: DecisionOutcome;
  needsLLM: boolean;
  initiativeProceed: boolean;
  noOpReason?: NoOpReason;
  privateMotiveSeed: string;
};

export type NoOpRecord = {
  agentId: string;
  reason: NoOpReason;
  privateMotiveSummary: string;
  pulseIndex: number;
};
