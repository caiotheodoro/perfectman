/**
 * buildDelayedReplyScenario
 * Leo sent a message 4 pulses ago. No one replied.
 * The interpretation module should detect reply_latency and offer multiple meanings
 * (indifference, busy, deliberate ignore). The delay itself changes Leo's social reading.
 *
 * Expected engine signals:
 * - Interpretation includes reply_latency signal for leo's last message
 * - Multiple plausible meanings preserved (not forced to "ignored")
 * - leo.socialEmotions.socialAnxiety or fearOfExclusion slightly elevated
 */

import type {
  Simulation,
  Channel,
  ChannelMembership,
  AgentState,
  PersonaConfig,
  CommittedEvent,
} from "../index.js";
import { LEO, CAIO, GOULART } from "../constants/personas.js";
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
  personas: { leo: PersonaConfig; caio: PersonaConfig; goulart: PersonaConfig };
  agentStates: { leo: AgentState; caio: AgentState; goulart: AgentState };
  /** Leo's unanswered message + 3 pulses of silence */
  committedEvents: CommittedEvent[];
  /** pulse index now — 4 pulses after leo's message */
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
    ["leo", "caio", "goulart"],
    [channelId],
  );

  const channel = makePublicChannel(channelId, simulationId, "#geral", ["leo", "caio", "goulart"]);
  const memberships = membershipFor(channelId, ["leo", "caio", "goulart"]);

  const leoState = makeAgentState(
    "leo",
    simulationId,
    "leo",
    { valence: -0.1, arousal: 0.35 },
    { socialAnxiety: 0.2, fearOfExclusion: 0.15 },
  );

  const caioState = makeAgentState("caio", simulationId, "caio");
  const goulartState = makeAgentState("goulart", simulationId, "goulart");

  // Leo posted at pulse 1, no replies at pulses 2, 3, 4
  const leoMsg = makeCommittedEvent(
    simulationId, channelId, "leo", "message_sent",
    { content: "e aí galera, o que estão fazendo?" },
    1,
  );
  // Override createdAt to be in the past (simulating time passed)
  leoMsg.createdAt = Date.now() - 60000 * 4;   // 4 minutes ago

  // No reply events — channel silent after leo's message
  // Caio and Goulart are online (presence=active) but haven't replied

  return {
    simulation,
    channels: [channel],
    memberships,
    personas: { leo: LEO, caio: CAIO, goulart: GOULART },
    agentStates: { leo: leoState, caio: caioState, goulart: goulartState },
    committedEvents: [leoMsg],
    currentPulseIndex: 5,
    expectedSignals: {
      replyLatencyDetected: true,
      ambiguityPreserved: true,
      leoAnxietyShouldBeMildlyElevated: true,
    },
  };
}
