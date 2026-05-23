export type InterpretationSignalType =
  | "mention_ignored"
  | "reply_latency"
  | "public_silence"
  | "public_private_asymmetry"
  | "reaction_instead_of_text"
  | "topic_shift";

export type InterpretationConfidence = "uncertain" | "plausible" | "likely";

export type Interpretation = {
  signalType: InterpretationSignalType;
  description: string; // natural language, preserved ambiguity
  confidence: InterpretationConfidence;
  involvedAgentIds: string[];
  sourceEventIds: string[];
};
