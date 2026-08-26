/**
 * Shared replay contract for the HTML snapshot artifact: produced by the
 * e2e SimulationRecorder (parity reference) and the production
 * HtmlSnapshotGateway receiver (stream-fed), consumed by the generator.
 * Maps are replaced with plain objects for JSON serializability.
 */
import type { CommittedEvent, EndingOffer, EndReason, GoalKind, OperatorEvent } from "@perfectman/shared";
import type { SerializedAgentState } from "../agent/agent-state-serializer.js";
import type { PulseResult } from "../simulation/pulse-scheduler.js";

export type AgentThinking = {
  agentId: string;
  intentType: string;
  visibleContent: string | undefined;
  privateMotiveSummary: string;
  emotionDrivers: string[];
  motivationDrivers: string[];
};

export type PulseFrame = {
  pulseIndex: number;
  result: PulseResult;
  committedEvents: CommittedEvent[];
  agentStates: Record<string, SerializedAgentState>;
  /** Thinking data from the LLM intent — only set if agent had an LLM call this pulse */
  agentThinking: Record<string, AgentThinking>;
  operatorEvents: OperatorEvent[];
};

/** Self-vs-world verdict of one goal, as of the latest `world_verdict` event. */
export type GoalPanelVerdict = {
  distanceToTarget: number;
  progressRate: number;
  plateaued: boolean;
  consensus: string;
  determination: string;
  confidence: number;
};

/** One `delusion_gap_sampled` sample, keyed by the review pulse it was taken on. */
export type GoalPanelGapSample = {
  pulseIndex: number;
  magnitude: number;
  divergenceFromLog: number;
  divergenceFromWorld: number;
};

/**
 * Run-level goal panel entry, derived by the receiver from delivered
 * goal-layer operator events (whole-payload passthrough, D-26).
 */
export type GoalPanel = {
  goalId: string;
  agentId: string;
  title: string;
  kind: GoalKind;
  targetStateDescription: string;
  narrativeFraming: string;
  synthesizer: string;
  confidence: number;
  status: "proposed" | "accepted" | "declined" | "ended";
  proposalPulse: number;
  acceptedPulse?: number;
  latestVerdict?: GoalPanelVerdict;
  gapSamples: GoalPanelGapSample[];
  ending?: EndingOffer;
};

export type SimulationReplay = {
  simulationId: string;
  simulationName: string;
  agentIds: string[];
  agentNames: Record<string, string>;
  agentArchetypes: Record<string, string>;
  channels: Array<{
    id: string;
    name: string;
    type: string;
    memberAgentIds: string[];
  }>;
  pulses: PulseFrame[];
  /** Present only when the run had goals — recorder-produced replays omit it. */
  goals?: GoalPanel[];
  /** Stop-payload fields, delivered via `onSimulationStopped` (D-24). */
  endReason?: EndReason;
  endingOffer?: EndingOffer;
};