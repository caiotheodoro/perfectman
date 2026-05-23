import type { MemoryWriteProposal } from "../memory/memory.types.js";

export type IntentType =
  | "send_message"
  | "reply_to_message"
  | "react"
  | "create_channel"
  | "invite_agent"
  | "leave_channel"
  | "typing_start"
  | "typing_cancel"
  | "write_memory"
  | "delay_response"
  | "no_op";

export type ActionIntent = {
  id: string;
  actorId: string;
  intentType: IntentType;
  channelTarget?: string;
  personTargets: string[];
  visibleContent?: string;
  privateMotiveSummary: string; // required, never empty
  emotionDrivers: string[];
  motivationDrivers: string[];
  preferredDelay?: number; // ms
  fallbackIfBlocked?: IntentType;
  memoryWrites: MemoryWriteProposal[];
  spectatorSummary?: string;
};

export type IntentViolation = {
  type:
    | "schema_invalid"
    | "unsupported_intent_type"
    | "hidden_channel_target"
    | "hidden_person_target"
    | "missing_motive_summary"
    | "invalid_delay"
    | "rate_limited"
    | "not_member"
    | "policy_blocked";
  detail?: string;
};

export type IntentValidationResult = {
  valid: boolean;
  violations: IntentViolation[];
};

export type ResolvedIntentOutcome =
  | "committed"
  | "delayed"
  | "blocked"
  | "fallback_committed"
  | "operator_review";
