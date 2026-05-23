/**
 * Internal helpers for fixture construction.
 * Not exported from the package root — only used by fixture builders.
 */

import type {
  AgentState,
  CoreMood,
  SocialEmotions,
  RelationalState,
  CommittedEvent,
  EventVisibility,
  Channel,
  ChannelMembership,
  Simulation,
  SimulationSettings,
  Memory,
  InitiativeAccumulator,
} from "../index.js";

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 10,
  llmCallBudgetPerMinute: 20,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 50000,
};

export const NEUTRAL_MOOD: CoreMood = {
  valence: 0.0,
  arousal: 0.3,
  stability: 0.7,
  energy: 0.6,
  circumplexAngle: 0.0,
  circumplexRadius: 0.3,
  momentumValence: 0,
  momentumArousal: 0,
};

export const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0,
  envy: 0,
  humiliation: 0,
  pride: 0,
  shame: 0,
  affection: 0,
  resentment: 0,
  suspicion: 0,
  admiration: 0,
  contempt: 0,
  neediness: 0,
  socialAnxiety: 0,
  fearOfExclusion: 0,
  desireForStatus: 0,
  desireForIntimacy: 0,
};

// ── Agent state builder ───────────────────────────────────────────────────────

export function makeAgentState(
  agentId: string,
  simulationId: string,
  personaId: string,
  moodOverride?: Partial<CoreMood>,
  socialOverride?: Partial<SocialEmotions>,
  relationalStates?: Map<string, RelationalState>,
): AgentState {
  return {
    agentId,
    simulationId,
    personaId,
    presence: "active",
    coreMood: { ...NEUTRAL_MOOD, ...moodOverride },
    socialEmotions: { ...ZERO_SOCIAL, ...socialOverride },
    relationalStates: relationalStates ?? new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Relational state builder ──────────────────────────────────────────────────

export function makeRelationalState(
  targetAgentId: string,
  overrides?: Partial<RelationalState>,
): RelationalState {
  return {
    targetAgentId,
    trust: 0.5,
    affection: 0.3,
    resentment: 0,
    attraction: 0.2,
    suspicion: 0.1,
    admiration: 0.2,
    envy: 0,
    comfort: 0.5,
    threat: 0,
    curiosity: 0.3,
    desireForCloseness: 0.3,
    desireForDistance: 0.1,
    interactionCount: 0,
    lastInteractionAt: null,
    lastPositiveAt: null,
    lastNegativeAt: null,
    ...overrides,
  };
}

// ── Event builder ─────────────────────────────────────────────────────────────

let _eventCounter = 0;

export function makeCommittedEvent(
  simulationId: string,
  channelId: string,
  actorId: string,
  type: CommittedEvent["type"],
  payload: Record<string, unknown> = {},
  pulseIndex = 1,
  visibilityOverride?: Partial<EventVisibility>,
): CommittedEvent {
  const id = `evt_fixture_${++_eventCounter}`;
  return {
    id,
    simulationId,
    channelId,
    actorId,
    type,
    payload,
    createdAt: Date.now() + _eventCounter,
    pulseIndex,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public_channel",
      ...visibilityOverride,
    },
  };
}

// ── Channel builder ───────────────────────────────────────────────────────────

export function makePublicChannel(
  id: string,
  simulationId: string,
  name: string,
  memberAgentIds: string[],
): Channel {
  return {
    id,
    simulationId,
    type: "public_channel",
    name,
    createdBy: "system",
    memberAgentIds,
    spectatorVisible: true,
    operatorVisible: true,
    createdForMotives: [],
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function makePrivateChannel(
  id: string,
  simulationId: string,
  name: string,
  createdBy: string,
  memberAgentIds: string[],
  motives: string[] = [],
): Channel {
  return {
    id,
    simulationId,
    type: "private_channel",
    name,
    createdBy,
    memberAgentIds,
    spectatorVisible: false,
    operatorVisible: true,
    createdForMotives: motives,
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Membership helper ─────────────────────────────────────────────────────────

export function membershipFor(channelId: string, agentIds: string[]): ChannelMembership[] {
  const now = Date.now();
  return agentIds.map(agentId => ({ channelId, agentId, joinedAt: now }));
}

// ── Simulation builder ────────────────────────────────────────────────────────

export function makeSimulation(
  id: string,
  name: string,
  agentIds: string[],
  channelIds: string[],
  settingsOverride?: Partial<SimulationSettings>,
): Simulation {
  return {
    id,
    name,
    status: "running",
    agentIds,
    channelIds,
    settings: { ...DEFAULT_SETTINGS, ...settingsOverride },
    seed: 12345,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// ── Memory builder ────────────────────────────────────────────────────────────

export function makeMemory(
  id: string,
  agentId: string,
  simulationId: string,
  type: Memory["type"],
  subjectAgentIds: string[],
  summary: string,
  emotionalTone: Memory["emotionalTone"] = "neutral",
  confidence = 0.8,
): Memory {
  return {
    id,
    agentId,
    simulationId,
    type,
    subjectAgentIds,
    sourceEventIds: [],
    summary,
    emotionalTone,
    confidence,
    unresolved: false,
    createdAt: Date.now(),
    lastReinforcedAt: Date.now(),
  };
}
