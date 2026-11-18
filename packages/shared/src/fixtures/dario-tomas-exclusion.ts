/**
 * buildDarioTomasExclusionScenario
 * Tomas replies to Vasco's message, ignoring Dario's previous message.
 * Dario experiences exclusion cascade: fearOfExclusion rises, resentment builds.
 *
 * Expected engine signals:
 * - dario.socialEmotions.fearOfExclusion elevated
 * - dario.socialEmotions.resentment rising
 * - dario.relationalStates["tomas"].trust decreasing
 * - Dario's available actions include reply_to_message (to continue bidding)
 * - Decision might yield delay or act depending on inhibition
 */

import type {
  Simulation,
  Channel,
  ChannelMembership,
  AgentState,
  PersonaConfig,
  CommittedEvent,
} from "../index.js";
import { DARIO, TOMAS, VASCO } from "../constants/personas.js";
import {
  makeSimulation,
  makePublicChannel,
  membershipFor,
  makeAgentState,
  makeRelationalState,
  makeCommittedEvent,
} from "./helpers.js";

export type DarioTomasExclusionScenario = {
  simulation: Simulation;
  channels: Channel[];
  memberships: ChannelMembership[];
  personas: { dario: PersonaConfig; tomas: PersonaConfig; vasco: PersonaConfig };
  agentStates: { dario: AgentState; tomas: AgentState; vasco: AgentState };
  /** The key events: Dario's message → Tomas ignores and replies to Vasco */
  committedEvents: CommittedEvent[];
  expectedSignals: {
    darioFearOfExclusionShouldRise: boolean;
    darioResentmentTowardTomasShouldRise: boolean;
    darioVisibleEventShouldShowIgnore: boolean;
  };
};

export function buildDarioTomasExclusionScenario(): DarioTomasExclusionScenario {
  const simulationId = "sim_exclusion";
  const channelId = "ch_geral";

  const simulation = makeSimulation(
    simulationId,
    "Dario-Tomas Exclusion",
    ["vasco", "dario", "tomas"],
    [channelId],
  );

  const channel = makePublicChannel(
    channelId,
    simulationId,
    "#geral",
    ["vasco", "dario", "tomas"],
  );
  const memberships = membershipFor(channelId, ["vasco", "dario", "tomas"]);

  // Vasco neutral
  const vascoState = makeAgentState("vasco", simulationId, "vasco");

  // Tomas: warm toward Vasco, cold toward Dario (nascent)
  const tomasState = makeAgentState(
    "tomas",
    simulationId,
    "tomas",
    { valence: 0.3, arousal: 0.5 },
    {},
    new Map([
      ["vasco", makeRelationalState("vasco", { affection: 0.6, comfort: 0.7 })],
      ["dario",   makeRelationalState("dario",   { affection: 0.2, comfort: 0.3 })],
    ]),
  );

  // Dario: already slightly anxious, desiring connection
  const darioState = makeAgentState(
    "dario",
    simulationId,
    "dario",
    { valence: -0.1, arousal: 0.4 },
    {
      socialAnxiety: 0.3,
      fearOfExclusion: 0.2,
      desireForIntimacy: 0.5,
    },
    new Map([
      ["tomas",    makeRelationalState("tomas",    { trust: 0.5, affection: 0.4, curiosity: 0.6 })],
      ["vasco", makeRelationalState("vasco", { trust: 0.4, affection: 0.3 })],
    ]),
  );

  // Events sequence:
  // 1. Vasco opens with a message
  // 2. Dario replies to Vasco (seeking inclusion)
  // 3. Tomas replies directly to Vasco — ignoring Dario

  const e1 = makeCommittedEvent(
    simulationId, channelId, "vasco", "message_sent",
    { content: "alguém ai ainda?" },
    1,
  );

  const e2 = makeCommittedEvent(
    simulationId, channelId, "dario", "reply_sent",
    { content: "to aqui sim", replyToId: e1.id },
    1,
  );

  const e3 = makeCommittedEvent(
    simulationId, channelId, "tomas", "reply_sent",
    { content: "opa vasco, tudo bom?", replyToId: e1.id },
    2,
  );

  return {
    simulation,
    channels: [channel],
    memberships,
    personas: { dario: DARIO, tomas: TOMAS, vasco: VASCO },
    agentStates: { dario: darioState, tomas: tomasState, vasco: vascoState },
    committedEvents: [e1, e2, e3],
    expectedSignals: {
      darioFearOfExclusionShouldRise: true,
      darioResentmentTowardTomasShouldRise: true,
      darioVisibleEventShouldShowIgnore: true,
    },
  };
}
