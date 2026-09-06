import type { InitiativeCandidate } from "../initiative/initiative.types.js";
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
  /**
   * ADR-0017: this `act` is a consult on a hold — a delay-favoring
   * inhibition would have silenced the agent, something salient just
   * happened, and the model is asked to voice the hold (`no_op` with the
   * character's reason) or break it.
   */
  holdSuggested?: boolean;
};

/**
 * Everything the decision needs besides pressures and inhibitions. The
 * decision is the single owner of `needsLLM` (ADR-0015): attention feeds it
 * `addressed` and `salientForeignEvent` as inputs instead of overriding its
 * output afterwards.
 */
export type DecisionContext = {
  hasNewEvents: boolean;
  /** A direct mention or a reply to this agent arrived this pulse. */
  addressed: boolean;
  /** A high/critical-salience event from ANOTHER actor arrived this pulse. */
  salientForeignEvent: boolean;
  initiativeProceed: boolean;
  pulseIndex: number;
  initiativeCandidates: InitiativeCandidate[];
  /** The agent committed an outward act on the previous pulse. */
  justActed: boolean;
  /** A model-voiced hold by this agent landed within HOLD_VOICE_REFRACTORY_PULSES (ADR-0017); absent means no. */
  voicedHoldRecently?: boolean;
};

export type NoOpRecord = {
  agentId: string;
  reason: NoOpReason;
  privateMotiveSummary: string;
  pulseIndex: number;
};
