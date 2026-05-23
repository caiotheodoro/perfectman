/**
 * buildPrivateChannelMotiveScenario
 * Mariana has high affection + admiration for Caio, but public shame/anxiety
 * inhibits direct public approach. A private channel becomes the only comfortable path.
 *
 * Expected engine signals:
 * - mariana.socialEmotions.affection high
 * - mariana.socialEmotions.socialAnxiety blocking public interaction
 * - motivation: "attraction" or "comfort" ranked high
 * - availableActions includes create_channel with private_channel type
 * - decision.outcome = "act" with create_channel intent
 */

import type {
  Simulation,
  Channel,
  ChannelMembership,
  AgentState,
  PersonaConfig,
  CommittedEvent,
} from "../index.js";
import { MARIANA, CAIO } from "../constants/personas.js";
import {
  makeSimulation,
  makePublicChannel,
  membershipFor,
  makeAgentState,
  makeRelationalState,
  makeCommittedEvent,
} from "./helpers.js";

export type PrivateChannelMotiveScenario = {
  simulation: Simulation;
  channels: Channel[];
  memberships: ChannelMembership[];
  personas: { mariana: PersonaConfig; caio: PersonaConfig };
  agentStates: { mariana: AgentState; caio: AgentState };
  committedEvents: CommittedEvent[];
  expectedSignals: {
    marianaWantsPrivateChannelWithCaio: boolean;
    shameBlocksPublicApproach: boolean;
    createChannelActionAvailable: boolean;
  };
};

export function buildPrivateChannelMotiveScenario(): PrivateChannelMotiveScenario {
  const simulationId = "sim_private_motive";
  const channelId = "ch_geral";

  const simulation = makeSimulation(
    simulationId,
    "Private Channel Motive",
    ["mariana", "caio"],
    [channelId],
  );

  const channel = makePublicChannel(channelId, simulationId, "#geral", ["mariana", "caio"]);
  const memberships = membershipFor(channelId, ["mariana", "caio"]);

  // Caio: normal state, friendly
  const caioState = makeAgentState("caio", simulationId, "caio");

  // Mariana: high affection+attraction for Caio, shame + social anxiety blocking public move
  const marianaState = makeAgentState(
    "mariana",
    simulationId,
    "mariana",
    { valence: 0.1, arousal: 0.6, energy: 0.7 },
    {
      affection: 0.8,
      shame: 0.5,               // fear of being seen pursuing
      socialAnxiety: 0.6,        // public exposure feels risky
      desireForIntimacy: 0.9,
    },
    new Map([
      [
        "caio",
        makeRelationalState("caio", {
          affection: 0.85,
          attraction: 0.75,
          curiosity: 0.8,
          comfort: 0.3,          // low public comfort
          desireForCloseness: 0.9,
          interactionCount: 8,
        }),
      ],
    ]),
  );

  // Caio posted something publicly — Mariana wants to respond privately
  const e1 = makeCommittedEvent(
    simulationId, channelId, "caio", "message_sent",
    { content: "alguém tem planos pro fim de semana?" },
    1,
  );

  return {
    simulation,
    channels: [channel],
    memberships,
    personas: { mariana: MARIANA, caio: CAIO },
    agentStates: { mariana: marianaState, caio: caioState },
    committedEvents: [e1],
    expectedSignals: {
      marianaWantsPrivateChannelWithCaio: true,
      shameBlocksPublicApproach: true,
      createChannelActionAvailable: true,
    },
  };
}
