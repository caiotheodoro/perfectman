/**
 * buildBiasedMemoryScenario
 * Goulart is in a negative mood. He has both positive and negative memories of Caio.
 * Mood-congruent retrieval bias: negative memories should rank higher in the perception packet.
 *
 * Expected engine signals:
 * - perceptionPacket.relevantMemories: negative memories appear before positive ones
 *   when Goulart is in negative valence state
 * - The bias is purely from mood state, not from memory age/recency
 */

import type {
  Simulation,
  Channel,
  ChannelMembership,
  AgentState,
  PersonaConfig,
  CommittedEvent,
  Memory,
} from "../index.js";
import { GOULART, CAIO } from "../constants/personas.js";
import {
  makeSimulation,
  makePublicChannel,
  membershipFor,
  makeAgentState,
  makeRelationalState,
  makeCommittedEvent,
  makeMemory,
} from "./helpers.js";

export type BiasedMemoryScenario = {
  simulation: Simulation;
  channels: Channel[];
  memberships: ChannelMembership[];
  personas: { goulart: PersonaConfig; caio: PersonaConfig };
  agentStates: { goulart: AgentState; caio: AgentState };
  /** Goulart's mixed memories of Caio */
  goulartMemories: Memory[];
  /** Caio said something to Goulart — triggers memory retrieval */
  committedEvents: CommittedEvent[];
  expectedSignals: {
    negativeMemoriesShouldRankHigherInNegativeMood: boolean;
    positiveMemoriesShouldRankHigherInPositiveMood: boolean;
  };
};

export function buildBiasedMemoryScenario(): BiasedMemoryScenario {
  const simulationId = "sim_biased_memory";
  const channelId = "ch_geral";

  const simulation = makeSimulation(
    simulationId,
    "Biased Memory",
    ["goulart", "caio"],
    [channelId],
  );

  const channel = makePublicChannel(channelId, simulationId, "#geral", ["goulart", "caio"]);
  const memberships = membershipFor(channelId, ["goulart", "caio"]);

  // Goulart: negative mood (should bias toward negative memories)
  const goulartNegative = makeAgentState(
    "goulart",
    simulationId,
    "goulart",
    { valence: -0.6, arousal: 0.4 },
    { resentment: 0.3, suspicion: 0.4 },
    new Map([
      ["caio", makeRelationalState("caio", { trust: 0.2, resentment: 0.4 })],
    ]),
  );

  const caioState = makeAgentState("caio", simulationId, "caio");

  // Mixed memories of Caio (both positive and negative, same age)
  // Simulated-clock epoch: memory age is counted in pulses off
  // PulseScheduler.simTime (starts at 0), never wall-clock time.
  const baseTime = 0;

  const memories: Memory[] = [
    makeMemory(
      "mem_pos_1", "goulart", simulationId,
      "episodic", ["caio"],
      "caio me ajudou quando eu precisei",
      "positive", 0.85,
    ),
    makeMemory(
      "mem_pos_2", "goulart", simulationId,
      "episodic", ["caio"],
      "caio falou bem de mim na frente de todo mundo",
      "positive", 0.80,
    ),
    makeMemory(
      "mem_neg_1", "goulart", simulationId,
      "emotional_residue", ["caio"],
      "caio me ignorou numa conversa importante",
      "negative", 0.75,
    ),
    makeMemory(
      "mem_neg_2", "goulart", simulationId,
      "social_theory", ["caio"],
      "caio sempre parece condescendente comigo",
      "negative", 0.70,
    ),
    makeMemory(
      "mem_neu_1", "goulart", simulationId,
      "social_theory", ["caio"],
      "caio costuma demorar pra responder",
      "neutral", 0.65,
    ),
  ];

  // Set same createdAt/lastReinforcedAt so recency doesn't dominate
  for (const m of memories) {
    m.createdAt = baseTime;
    m.lastReinforcedAt = baseTime;
  }

  goulartNegative.memories = memories;

  // Caio just sent a message — triggers Goulart's memory retrieval
  const e1 = makeCommittedEvent(
    simulationId, channelId, "caio", "message_sent",
    { content: "hey goulart, tudo bem?" },
    2,
  );

  return {
    simulation,
    channels: [channel],
    memberships,
    personas: { goulart: GOULART, caio: CAIO },
    agentStates: { goulart: goulartNegative, caio: caioState },
    goulartMemories: memories,
    committedEvents: [e1],
    expectedSignals: {
      negativeMemoriesShouldRankHigherInNegativeMood: true,
      positiveMemoriesShouldRankHigherInPositiveMood: true, // for contrast test
    },
  };
}
