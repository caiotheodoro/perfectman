/**
 * buildVascoColdStartScenario
 * Vasco arrives in an empty #geral channel.
 * Boredom + initiative accumulates until he sends the first message.
 *
 * Expected engine signals:
 * - vasco.coreMood.arousal low (boredom)
 * - vasco.initiativeAccumulators: boredom source accumulating
 * - Other agents: offline or not yet arrived
 * - After engine step: decision.outcome = "act", triggeringReason = "initiative"
 */

import type {
  Simulation,
  Channel,
  ChannelMembership,
  AgentState,
  PersonaConfig,
  CommittedEvent,
} from "../index.js";
import { VASCO, ALL_PERSONAS } from "../constants/personas.js";
import {
  makeSimulation,
  makePublicChannel,
  membershipFor,
  makeAgentState,
  makeCommittedEvent,
} from "./helpers.js";

export type VascoColdStartScenario = {
  simulation: Simulation;
  channels: Channel[];
  memberships: ChannelMembership[];
  vascoPersona: PersonaConfig;
  vascoState: AgentState;
  otherPersonas: PersonaConfig[];
  otherStates: AgentState[];
  /** Empty — no messages yet. Channel just opened. */
  committedEvents: CommittedEvent[];
  /**
   * Expected signals from engine step:
   * - vasco initiative should accumulate (boredom source)
   * - decision.outcome will be "act" once threshold crossed
   * - triggeringReason = "initiative"
   */
  expectedSignals: {
    vascoHasHighBoredomInitiative: boolean;
    otherAgentsOffline: boolean;
    channelIsEmpty: boolean;
  };
};

export function buildVascoColdStartScenario(): VascoColdStartScenario {
  const simulationId = "sim_cold_start";
  const channelId = "ch_geral";

  const simulation = makeSimulation(
    simulationId,
    "Cold Start — Vasco First",
    ALL_PERSONAS.map(p => p.id),
    [channelId],
  );

  const channel = makePublicChannel(channelId, simulationId, "#geral", ["vasco"]);
  const memberships = membershipFor(channelId, ["vasco"]);

  // Vasco: low arousal (boredom), above-neutral energy — ready to initiate
  const vascoState = makeAgentState(
    "vasco",
    simulationId,
    "vasco",
    {
      valence: VASCO.baselineValence,
      arousal: 0.15,          // bored — below baseline
      stability: 0.8,
      energy: 0.7,
    },
    {},
    new Map(),
  );

  // Seed Vasco with a healthy boredom initiative accumulator
  vascoState.initiativeAccumulators = [
    {
      source: "boredom_accumulator",
      value: 0.75,        // above threshold (0.6)
      threshold: 0.6,
      growthRate: 0.08,
      decayRate: 0.02,
      lastFiredAt: null,
    },
  ];

  // Others not yet arrived
  const others = ALL_PERSONAS.filter(p => p.id !== "vasco");
  const otherStates = others.map(persona =>
    makeAgentState(persona.id, simulationId, persona.id, {}, {}, new Map()),
  );
  for (const s of otherStates) {
    s.presence = "offline";
  }

  return {
    simulation,
    channels: [channel],
    memberships,
    vascoPersona: VASCO,
    vascoState,
    otherPersonas: others,
    otherStates,
    committedEvents: [],
    expectedSignals: {
      vascoHasHighBoredomInitiative: true,
      otherAgentsOffline: true,
      channelIsEmpty: true,
    },
  };
}
