/**
 * Shared replay contract for the HTML snapshot artifact: produced by the
 * e2e SimulationRecorder (parity reference) and the production
 * HtmlSnapshotGateway receiver (stream-fed), consumed by the generator.
 * Maps are replaced with plain objects for JSON serializability.
 */
import type { CommittedEvent, OperatorEvent } from "@perfectman/shared";
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
};