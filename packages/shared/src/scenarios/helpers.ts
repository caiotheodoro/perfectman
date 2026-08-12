/**
 * Compact builders for scenario data.
 * Keeps the library readable: `scene(...)` + `agent(...)` + `msg(...)`.
 */

import type {
  AgentSeedSpec,
  ChannelSeedSpec,
  EventSeedSpec,
  ExpectedSignal,
  JudgeRubric,
  RoleplayScenario,
  ScenarioCategory,
} from "../index.js";
import { ROLEPLAY_V1_RUBRIC } from "./rubrics.js";

export function channel(
  id: string,
  name: string,
  memberAgentIds: string[],
  type: "public_channel" | "private_channel" = "public_channel",
): ChannelSeedSpec {
  return { id, type, name, memberAgentIds, createdBy: "system" };
}

export function agent(
  agentId: string,
  personaId: string,
  opts: Omit<AgentSeedSpec, "agentId" | "personaId"> = {},
): AgentSeedSpec {
  return { agentId, personaId, ...opts };
}

export function msg(
  type: EventSeedSpec["type"],
  actorId: string,
  channelId: string,
  content: string,
  pulseIndex = 1,
  minutesAgo = 0,
  mentionedAgentIds?: string[],
): EventSeedSpec {
  return {
    type,
    actorId,
    channelId,
    payload: mentionedAgentIds
      ? { content, mentionedAgentIds }
      : { content },
    pulseIndex,
    minutesAgo: minutesAgo || undefined,
  };
}

export function react(
  actorId: string,
  channelId: string,
  reaction: string,
  pulseIndex = 1,
): EventSeedSpec {
  return { type: "reaction_sent", actorId, channelId, payload: { reaction }, pulseIndex };
}

export type SceneOpts = {
  id: string;
  category: ScenarioCategory;
  name: string;
  description: string;
  targetBehaviors?: string[];
  agents: AgentSeedSpec[];
  priorEvents?: EventSeedSpec[];
  expectedSignals: ExpectedSignal[];
  rubric?: JudgeRubric;
  seedVariants?: number;
  pulseCount?: number;
  seed?: number;
  channels?: ChannelSeedSpec[];
};

const DEFAULT_CHANNEL_SPEC = {
  id: "ch_geral",
  name: "#geral",
  type: "public_channel" as const,
  createdBy: "system",
};

export function scene(opts: SceneOpts): RoleplayScenario {
  const agentIds = opts.agents.map(a => a.agentId);
  return {
    id: opts.id,
    category: opts.category,
    name: opts.name,
    description: opts.description,
    targetBehaviors: opts.targetBehaviors ?? [],
    seedVariants: opts.seedVariants ?? 3,
    pulseCount: opts.pulseCount ?? 24,
    seed: opts.seed ?? 7,
    channels:
      opts.channels ??
      [{ ...DEFAULT_CHANNEL_SPEC, memberAgentIds: agentIds }],
    agents: opts.agents,
    priorEvents: opts.priorEvents ?? [],
    expectedSignals: opts.expectedSignals,
    rubric: opts.rubric ?? ROLEPLAY_V1_RUBRIC,
  };
}

/** Base neutral mood/social override used across scenes. */
export const NEUTRAL: { mood: Record<string, number>; social: Record<string, number> } = {
  mood: { valence: 0.1, arousal: 0.4, stability: 0.6, energy: 0.6 },
  social: {},
};


