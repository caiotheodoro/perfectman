/**
 * buildDelayedReplyScenario
 * Renan sent a message 4 pulses ago. No one replied.
 * The interpretation module should detect reply_latency and offer multiple meanings
 * (indifference, busy, deliberate ignore). The delay itself changes Renan's social reading.
 *
 * Expected engine signals:
 * - Interpretation includes reply_latency signal for renan's last message
 * - Multiple plausible meanings preserved (not forced to "ignored")
 * - renan.socialEmotions.socialAnxiety or fearOfExclusion slightly elevated
 */

import type {
  Simulation,
  Channel,
  ChannelMembership,
  AgentState,
  PersonaConfig,
  CommittedEvent,
} from "../index.js";
import { RENAN, TOMAS, VASCO } from "../constants/personas.js";
import {
  makeSimulation,
  makePublicChannel,
  membershipFor,
  makeAgentState,
  makeCommittedEvent,
} from "./helpers.js";

export type DelayedReplyScenario = {
  simulation: Simulation;
  channels: Channel[];
  memberships: ChannelMembership[];
  personas: { renan: PersonaConfig; tomas: PersonaConfig; vasco: PersonaConfig };
  agentStates: { renan: AgentState; tomas: AgentState; vasco: AgentState };
  /** Renan's unanswered message + 3 pulses of silence */
  committedEvents: CommittedEvent[];
  /** pulse index now — 4 pulses after renan's message */
  currentPulseIndex: number;
  expectedSignals: {
    replyLatencyDetected: boolean;
    ambiguityPreserved: boolean;        // interpretation has ≥2 meanings
    leoAnxietyShouldBeMildlyElevated: boolean;
  };
};

export function buildDelayedReplyScenario(): DelayedReplyScenario {
  const simulationId = "sim_delayed_reply";
  const channelId = "ch_geral";

  const simulation = makeSimulation(
    simulationId,
    "Delayed Reply",
    ["renan", "tomas", "vasco"],
    [channelId],
  );

  const channel = makePublicChannel(channelId, simulationId, "#geral", ["renan", "tomas", "vasco"]);
  const memberships = membershipFor(channelId, ["renan", "tomas", "vasco"]);

  const leoState = makeAgentState(
    "renan",
    simulationId,
    "renan",
    { valence: -0.1, arousal: 0.35 },
    { socialAnxiety: 0.2, fearOfExclusion: 0.15 },
  );

  const tomasState = makeAgentState("tomas", simulationId, "tomas");
  const vascoState = makeAgentState("vasco", simulationId, "vasco");

  // Renan posted at pulse 1, no replies at pulses 2, 3, 4
  const leoMsg = makeCommittedEvent(
    simulationId, channelId, "renan", "message_sent",
    { content: "e aí galera, o que estão fazendo?" },
    1,
  );
  // Override createdAt to be in the past (simulating time passed)
  leoMsg.createdAt = Date.now() - 60000 * 4;   // 4 minutes ago

  // No reply events — channel silent after renan's message
  // Tomas and Vasco are online (presence=active) but haven't replied

  return {
    simulation,
    channels: [channel],
    memberships,
    personas: { renan: RENAN, tomas: TOMAS, vasco: VASCO },
    agentStates: { renan: leoState, tomas: tomasState, vasco: vascoState },
    committedEvents: [leoMsg],
    currentPulseIndex: 5,
    expectedSignals: {
      replyLatencyDetected: true,
      ambiguityPreserved: true,
      leoAnxietyShouldBeMildlyElevated: true,
    },
  };
}
