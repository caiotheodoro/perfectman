/**
 * buildNoOpInhibitionScenario
 * Dario witnesses Vasco mock him publicly (high humiliation event).
 * Shame + fear + high social anxiety produce overwhelming inhibition.
 * Engine should yield no_op with a meaningful private motive seed.
 *
 * Expected engine signals:
 * - dario.socialEmotions.shame > 0.7
 * - dario.socialEmotions.humiliation elevated
 * - decision.outcome = "no_op"
 * - decision.noOpReason involves shame/inhibition
 * - decision.privateMotiveSeed is non-empty (tells story of why silent)
 */

import type {
  Simulation,
  Channel,
  ChannelMembership,
  AgentState,
  PersonaConfig,
  CommittedEvent,
} from "../index.js";
import { DARIO, VASCO, TOMAS } from "../constants/personas.js";
import {
  makeSimulation,
  makePublicChannel,
  membershipFor,
  makeAgentState,
  makeRelationalState,
  makeCommittedEvent,
} from "./helpers.js";

export type NoOpInhibitionScenario = {
  simulation: Simulation;
  channels: Channel[];
  memberships: ChannelMembership[];
  personas: { dario: PersonaConfig; vasco: PersonaConfig; tomas: PersonaConfig };
  agentStates: { dario: AgentState; vasco: AgentState; tomas: AgentState };
  /** The humiliating exchange dario witnessed */
  committedEvents: CommittedEvent[];
  expectedSignals: {
    darioShouldNoOp: boolean;
    shameIsOverwhelming: boolean;
    privateMotiveSeedIsNonEmpty: boolean;
  };
};

export function buildNoOpInhibitionScenario(): NoOpInhibitionScenario {
  const simulationId = "sim_noop_inhibition";
  const channelId = "ch_geral";

  const simulation = makeSimulation(
    simulationId,
    "No-Op Inhibition",
    ["vasco", "dario", "tomas"],
    [channelId],
  );

  const channel = makePublicChannel(channelId, simulationId, "#geral", ["vasco", "dario", "tomas"]);
  const memberships = membershipFor(channelId, ["vasco", "dario", "tomas"]);

  const vascoState = makeAgentState("vasco", simulationId, "vasco");
  const tomasState = makeAgentState("tomas", simulationId, "tomas");

  // Dario: overwhelmed after public humiliation
  const darioState = makeAgentState(
    "dario",
    simulationId,
    "dario",
    { valence: -0.8, arousal: 0.7, stability: 0.2, energy: 0.3 },
    {
      shame: 0.85,            // dominant
      humiliation: 0.75,
      fearOfExclusion: 0.6,
      socialAnxiety: 0.7,
      resentment: 0.3,
    },
    new Map([
      [
        "vasco",
        makeRelationalState("vasco", {
          trust: -0.3,
          resentment: 0.6,
          threat: 0.5,
          desireForDistance: 0.8,
          interactionCount: 12,
        }),
      ],
      [
        "tomas",
        makeRelationalState("tomas", { trust: 0.3, affection: 0.3, comfort: 0.4 }),
      ],
    ]),
  );

  // Vasco mocked Dario publicly; Tomas laughed/reacted
  const e1 = makeCommittedEvent(
    simulationId, channelId, "vasco", "message_sent",
    { content: "kkkk dario você não manda nem em você mesmo" },
    3,
    { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public_channel" },
  );
  e1.emotionalSalience = "high";

  const e2 = makeCommittedEvent(
    simulationId, channelId, "tomas", "reaction_sent",
    { emoji: "😂", targetEventId: e1.id },
    3,
  );

  return {
    simulation,
    channels: [channel],
    memberships,
    personas: { dario: DARIO, vasco: VASCO, tomas: TOMAS },
    agentStates: { dario: darioState, vasco: vascoState, tomas: tomasState },
    committedEvents: [e1, e2],
    expectedSignals: {
      darioShouldNoOp: true,
      shameIsOverwhelming: true,
      privateMotiveSeedIsNonEmpty: true,
    },
  };
}
