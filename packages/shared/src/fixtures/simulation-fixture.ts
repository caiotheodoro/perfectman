/**
 * buildSimulationFixture
 * Basic 5-agent simulation with one public #geral channel.
 * Suitable as a starting canvas for most test scenarios.
 */

import type {
  Simulation,
  Channel,
  ChannelMembership,
  AgentState,
  PersonaConfig,
} from "../index.js";
import { ALL_PERSONAS } from "../constants/personas.js";
import {
  makeSimulation,
  makePublicChannel,
  membershipFor,
  makeAgentState,
} from "./helpers.js";

export type SimulationFixture = {
  simulation: Simulation;
  channels: Channel[];
  memberships: ChannelMembership[];
  personas: PersonaConfig[];
  agentStates: AgentState[];
};

/**
 * 5 agents in a single public channel.
 * All agents are active with near-neutral baseline moods.
 */
export function buildSimulationFixture(): SimulationFixture {
  const simulationId = "sim_fixture";
  const agentIds = ALL_PERSONAS.map(p => p.id);
  const channelId = "ch_geral";

  const simulation = makeSimulation(
    simulationId,
    "Perfectman Fixture",
    agentIds,
    [channelId],
  );

  const channel = makePublicChannel(channelId, simulationId, "#geral", agentIds);
  const memberships = membershipFor(channelId, agentIds);

  const agentStates = ALL_PERSONAS.map(persona =>
    makeAgentState(persona.id, simulationId, persona.id, {
      valence: persona.baselineValence,
      arousal: persona.baselineArousal,
      stability: persona.baselineStability,
      energy: persona.baselineEnergy,
    }),
  );

  return {
    simulation,
    channels: [channel],
    memberships,
    personas: [...ALL_PERSONAS],
    agentStates,
  };
}
