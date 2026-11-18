/**
 * buildPrivateChannelMotiveScenario
 * Lara has high affection + admiration for Tomas, but public shame/anxiety
 * inhibits direct public approach. A private channel becomes the only comfortable path.
 *
 * Expected engine signals:
 * - lara.socialEmotions.affection high
 * - lara.socialEmotions.socialAnxiety blocking public interaction
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
import { LARA, TOMAS } from "../constants/personas.js";
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
  personas: { lara: PersonaConfig; tomas: PersonaConfig };
  agentStates: { lara: AgentState; tomas: AgentState };
  committedEvents: CommittedEvent[];
  expectedSignals: {
    laraWantsPrivateChannelWithTomas: boolean;
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
    ["lara", "tomas"],
    [channelId],
  );

  const channel = makePublicChannel(channelId, simulationId, "#geral", ["lara", "tomas"]);
  const memberships = membershipFor(channelId, ["lara", "tomas"]);

  // Tomas: normal state, friendly
  const tomasState = makeAgentState("tomas", simulationId, "tomas");

  // Lara: high affection+attraction for Tomas, shame + social anxiety blocking public move
  const laraState = makeAgentState(
    "lara",
    simulationId,
    "lara",
    { valence: 0.1, arousal: 0.6, energy: 0.7 },
    {
      affection: 0.8,
      shame: 0.5,               // fear of being seen pursuing
      socialAnxiety: 0.6,        // public exposure feels risky
      desireForIntimacy: 0.9,
    },
    new Map([
      [
        "tomas",
        makeRelationalState("tomas", {
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

  // Tomas posted something publicly — Lara wants to respond privately
  const e1 = makeCommittedEvent(
    simulationId, channelId, "tomas", "message_sent",
    { content: "alguém tem planos pro fim de semana?" },
    1,
  );

  return {
    simulation,
    channels: [channel],
    memberships,
    personas: { lara: LARA, tomas: TOMAS },
    agentStates: { lara: laraState, tomas: tomasState },
    committedEvents: [e1],
    expectedSignals: {
      laraWantsPrivateChannelWithTomas: true,
      shameBlocksPublicApproach: true,
      createChannelActionAvailable: true,
    },
  };
}
