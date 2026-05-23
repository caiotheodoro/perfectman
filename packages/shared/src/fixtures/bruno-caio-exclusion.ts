/**
 * buildBrunoCaioExclusionScenario
 * Caio replies to Goulart's message, ignoring Bruno's previous message.
 * Bruno experiences exclusion cascade: fearOfExclusion rises, resentment builds.
 *
 * Expected engine signals:
 * - bruno.socialEmotions.fearOfExclusion elevated
 * - bruno.socialEmotions.resentment rising
 * - bruno.relationalStates["caio"].trust decreasing
 * - Bruno's available actions include reply_to_message (to continue bidding)
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
import { BRUNO, CAIO, GOULART } from "../constants/personas.js";
import {
  makeSimulation,
  makePublicChannel,
  membershipFor,
  makeAgentState,
  makeRelationalState,
  makeCommittedEvent,
} from "./helpers.js";

export type BrunoCaioExclusionScenario = {
  simulation: Simulation;
  channels: Channel[];
  memberships: ChannelMembership[];
  personas: { bruno: PersonaConfig; caio: PersonaConfig; goulart: PersonaConfig };
  agentStates: { bruno: AgentState; caio: AgentState; goulart: AgentState };
  /** The key events: Bruno's message → Caio ignores and replies to Goulart */
  committedEvents: CommittedEvent[];
  expectedSignals: {
    brunoFearOfExclusionShouldRise: boolean;
    brunoResentmentTowardCaioShouldRise: boolean;
    brunoVisibleEventShouldShowIgnore: boolean;
  };
};

export function buildBrunoCaioExclusionScenario(): BrunoCaioExclusionScenario {
  const simulationId = "sim_exclusion";
  const channelId = "ch_geral";

  const simulation = makeSimulation(
    simulationId,
    "Bruno-Caio Exclusion",
    ["goulart", "bruno", "caio"],
    [channelId],
  );

  const channel = makePublicChannel(
    channelId,
    simulationId,
    "#geral",
    ["goulart", "bruno", "caio"],
  );
  const memberships = membershipFor(channelId, ["goulart", "bruno", "caio"]);

  // Goulart neutral
  const goulartState = makeAgentState("goulart", simulationId, "goulart");

  // Caio: warm toward Goulart, cold toward Bruno (nascent)
  const caioState = makeAgentState(
    "caio",
    simulationId,
    "caio",
    { valence: 0.3, arousal: 0.5 },
    {},
    new Map([
      ["goulart", makeRelationalState("goulart", { affection: 0.6, comfort: 0.7 })],
      ["bruno",   makeRelationalState("bruno",   { affection: 0.2, comfort: 0.3 })],
    ]),
  );

  // Bruno: already slightly anxious, desiring connection
  const brunoState = makeAgentState(
    "bruno",
    simulationId,
    "bruno",
    { valence: -0.1, arousal: 0.4 },
    {
      socialAnxiety: 0.3,
      fearOfExclusion: 0.2,
      desireForIntimacy: 0.5,
    },
    new Map([
      ["caio",    makeRelationalState("caio",    { trust: 0.5, affection: 0.4, curiosity: 0.6 })],
      ["goulart", makeRelationalState("goulart", { trust: 0.4, affection: 0.3 })],
    ]),
  );

  // Events sequence:
  // 1. Goulart opens with a message
  // 2. Bruno replies to Goulart (seeking inclusion)
  // 3. Caio replies directly to Goulart — ignoring Bruno

  const e1 = makeCommittedEvent(
    simulationId, channelId, "goulart", "message_sent",
    { content: "alguém ai ainda?" },
    1,
  );

  const e2 = makeCommittedEvent(
    simulationId, channelId, "bruno", "reply_sent",
    { content: "to aqui sim", replyToId: e1.id },
    1,
  );

  const e3 = makeCommittedEvent(
    simulationId, channelId, "caio", "reply_sent",
    { content: "opa goulart, tudo bom?", replyToId: e1.id },
    2,
  );

  return {
    simulation,
    channels: [channel],
    memberships,
    personas: { bruno: BRUNO, caio: CAIO, goulart: GOULART },
    agentStates: { bruno: brunoState, caio: caioState, goulart: goulartState },
    committedEvents: [e1, e2, e3],
    expectedSignals: {
      brunoFearOfExclusionShouldRise: true,
      brunoResentmentTowardCaioShouldRise: true,
      brunoVisibleEventShouldShowIgnore: true,
    },
  };
}
