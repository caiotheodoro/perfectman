/**
 * buildBiasedMemoryScenario
 * Vasco is in a negative mood. He has both positive and negative memories of Tomas.
 * Mood-congruent retrieval bias: negative memories should rank higher in the perception packet.
 *
 * Expected engine signals:
 * - perceptionPacket.relevantMemories: negative memories appear before positive ones
 *   when Vasco is in negative valence state
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
import { VASCO, TOMAS } from "../constants/personas.js";
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
  personas: { vasco: PersonaConfig; tomas: PersonaConfig };
  agentStates: { vasco: AgentState; tomas: AgentState };
  /** Vasco's mixed memories of Tomas */
  vascoMemories: Memory[];
  /** Tomas said something to Vasco — triggers memory retrieval */
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
    ["vasco", "tomas"],
    [channelId],
  );

  const channel = makePublicChannel(channelId, simulationId, "#geral", ["vasco", "tomas"]);
  const memberships = membershipFor(channelId, ["vasco", "tomas"]);

  // Vasco: negative mood (should bias toward negative memories)
  const vascoNegative = makeAgentState(
    "vasco",
    simulationId,
    "vasco",
    { valence: -0.6, arousal: 0.4 },
    { resentment: 0.3, suspicion: 0.4 },
    new Map([
      ["tomas", makeRelationalState("tomas", { trust: 0.2, resentment: 0.4 })],
    ]),
  );

  const tomasState = makeAgentState("tomas", simulationId, "tomas");

  // Mixed memories of Tomas (both positive and negative, same age)
  // Simulated-clock epoch: memory age is counted in pulses off
  // PulseScheduler.simTime (starts at 0), never wall-clock time.
  const baseTime = 0;

  const memories: Memory[] = [
    makeMemory(
      "mem_pos_1", "vasco", simulationId,
      "episodic", ["tomas"],
      "tomas me ajudou quando eu precisei",
      "positive", 0.85,
    ),
    makeMemory(
      "mem_pos_2", "vasco", simulationId,
      "episodic", ["tomas"],
      "tomas falou bem de mim na frente de todo mundo",
      "positive", 0.80,
    ),
    makeMemory(
      "mem_neg_1", "vasco", simulationId,
      "emotional_residue", ["tomas"],
      "tomas me ignorou numa conversa importante",
      "negative", 0.75,
    ),
    makeMemory(
      "mem_neg_2", "vasco", simulationId,
      "social_theory", ["tomas"],
      "tomas sempre parece condescendente comigo",
      "negative", 0.70,
    ),
    makeMemory(
      "mem_neu_1", "vasco", simulationId,
      "social_theory", ["tomas"],
      "tomas costuma demorar pra responder",
      "neutral", 0.65,
    ),
  ];

  // Set same createdAt/lastReinforcedAt so recency doesn't dominate
  for (const m of memories) {
    m.createdAt = baseTime;
    m.lastReinforcedAt = baseTime;
  }

  vascoNegative.memories = memories;

  // Tomas just sent a message — triggers Vasco's memory retrieval
  const e1 = makeCommittedEvent(
    simulationId, channelId, "tomas", "message_sent",
    { content: "hey vasco, tudo bem?" },
    2,
  );

  return {
    simulation,
    channels: [channel],
    memberships,
    personas: { vasco: VASCO, tomas: TOMAS },
    agentStates: { vasco: vascoNegative, tomas: tomasState },
    vascoMemories: memories,
    committedEvents: [e1],
    expectedSignals: {
      negativeMemoriesShouldRankHigherInNegativeMood: true,
      positiveMemoriesShouldRankHigherInPositiveMood: true, // for contrast test
    },
  };
}
