/**
 * Goal-layer calibration scenario recipes — six 4-persona seed setups
 * (ana/bruno/carla/diego per the e2e fixture shape) that drive the six
 * documented goal-layer arcs through the harness. Personas are seed
 * identities only: the no-op agent runtime never authors organic content.
 *
 * Two injection hooks keep cells axis-independent:
 *   - beforePulse: per-pulse room chatter (visible, signal-free dilution —
 *     the scheduler commits one invisible no_op_recorded per agent per pulse,
 *     so terminating arcs need visible events to keep the log divergence
 *     under the 0.33 meaning-made gate at the flip review).
 *   - inject: per-review scenario beats, committed right before the pulse
 *     that runs review #n (n 1-based), so reviewEveryPulses cells land on
 *     the same review indices.
 */

import type {
  AgentState,
  EventPayload,
  PersonaConfig,
  SimulationEvent,
  SimulationSettings,
} from "@perfectman/shared";
import type {
  AgentContext,
  ConfiguredInitialChannel,
} from "@perfectman/server";

export const GOAL_SCENARIO_IDS = [
  "healthy-achiever",
  "deluded-achiever",
  "premature-closer",
  "contested-consensus",
  "hollow-completion",
  "world-briefly-wrong",
] as const;

export type GoalScenarioId = (typeof GOAL_SCENARIO_IDS)[number];

export type GoalScenarioRecipe = {
  id: GoalScenarioId;
  /** Deterministic synthesis vs the canned reached-claim goal leg (llm). */
  mode: "deterministic" | "llm";
  agents: AgentContext[];
  channels: ConfiguredInitialChannel[];
  settings: SimulationSettings;
  seedEvents: SimulationEvent[];
  beforePulse?: (pulseIndex: number) => SimulationEvent[];
  inject?: (reviewIndex: number) => SimulationEvent[];
};

const AGENT_IDS = ["ana", "bruno", "carla", "diego"] as const;

const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 30,
  llmCallBudgetPerMinute: 100,
  pulseIntervalMs: 1000,
  tokenBudgetPerHour: 1_000_000,
};

const GENERAL_CHANNEL: ConfiguredInitialChannel = {
  id: "general",
  type: "public_channel",
  name: "general",
  default: true,
  memberAgentIds: [...AGENT_IDS],
};

const SIDELINE_CHANNEL: ConfiguredInitialChannel = {
  id: "sideline",
  type: "public_channel",
  name: "sideline",
  default: false,
  memberAgentIds: ["bruno", "carla", "diego"],
};

const PUBLIC_VISIBILITY: SimulationEvent["visibility"] = {
  visibleToAgents: [],
  visibleToSpectators: true,
  visibleToOperators: true,
  visibilityReason: "public",
};

function baseEvent(overrides: {
  channelId: string;
  actorId: string;
  type: string;
  payload: EventPayload;
  emotionalSalience?: SimulationEvent["emotionalSalience"];
  visibility?: SimulationEvent["visibility"];
}): SimulationEvent {
  return {
    simulationId: "sim_goal_recipe",
    channelId: overrides.channelId,
    actorId: overrides.actorId,
    type: overrides.type as SimulationEvent["type"],
    payload: overrides.payload,
    sourceEventIds: [],
    emotionalSalience: overrides.emotionalSalience ?? "low",
    visibility: overrides.visibility ?? PUBLIC_VISIBILITY,
  };
}

/** Seeded blocked intent — the crystallizer's resolve trigger (2+ required). */
function blockedEvent(index: number): SimulationEvent {
  return baseEvent({
    channelId: "general",
    actorId: "ana",
    type: "intent_blocked",
    payload: {
      intentType: "send_message",
      violations: [{ type: "rate_limited" }],
      intentId: `intent_${index}`,
    },
  });
}

/**
 * Per-review witnessed event — crystallizes a legacy proposal for ana only
 * (visibleToAgents scopes the crystallizer's witnessed-by check), keeping
 * nextGoalAvailable true so the plateau branch never arms on non-terminating
 * arcs. The channel has no members, so the event stays invisible to ana's
 * engine view.
 */
function witnessEvent(index: number): SimulationEvent {
  return baseEvent({
    channelId: `ch_w${index}`,
    actorId: "bruno",
    type: "message_sent",
    payload: { content: "the storm passed quickly" },
    emotionalSalience: "high",
    visibility: {
      visibleToAgents: ["ana"],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public",
    },
  });
}

/** Carla's public challenge of ana's claim — a challenge deference signal. */
function challengeEvent(index: number): SimulationEvent {
  return baseEvent({
    channelId: "general",
    actorId: "carla",
    type: "message_sent",
    payload: { content: "ana, this is not the win — the goal is not met yet" },
    emotionalSalience: "medium",
  });
}

function ridiculeEvent(): SimulationEvent {
  return baseEvent({
    channelId: "general",
    actorId: "diego",
    type: "reaction_sent",
    payload: { emoji: "👎", targetEventId: "seed-1" },
  });
}

/** Bruno's in-group deferral — the collective challenges while bruno backs it. */
function deferMessageEvent(index: number): SimulationEvent {
  return baseEvent({
    channelId: "general",
    actorId: "bruno",
    type: "message_sent",
    payload: { content: "ana is doing well with this one" },
  });
}

function deferReactionEvent(actorId: string): SimulationEvent {
  return baseEvent({
    channelId: "general",
    actorId,
    type: "reaction_sent",
    payload: { emoji: "👍", targetEventId: "seed-1" },
  });
}

/** Ana's completion beat — the "successful follow-up" criterion and beat. */
function followUpEvent(index: number): SimulationEvent {
  return baseEvent({
    channelId: "general",
    actorId: "ana",
    type: "message_sent",
    payload: { content: "everything is calm on my side" },
  });
}

/** Invisible chatter on a channel ana does not belong to — log-divergence fuel. */
function sidelineEvent(actorId: string, index: number): SimulationEvent {
  return baseEvent({
    channelId: "sideline",
    actorId,
    type: "message_sent",
    payload: { content: "the plan is ready for the evening" },
  });
}

const AMBIENT_LINES = [
  "the storm passed quickly",
  "the market was calm today",
  "the coffee tastes different",
  "the train arrived on time",
  "the garden needs watering",
  "the book was better than expected",
  "the report reads well today",
  "the window faces the park",
  "the soup simmered this afternoon",
  "the walk cleared my head",
  "the radio played old songs",
  "the clouds stayed away",
] as const;

const AMBIENT_SENDERS = ["bruno", "carla", "diego"] as const;

/** Visible, signal-free room chatter: 3 messages per non-ana agent per pulse. */
const AMBIENT_PER_PULSE = AMBIENT_SENDERS.length * 3;

function ambientEvents(pulseIndex: number, offset = 0): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  for (let i = 0; i < AMBIENT_PER_PULSE; i += 1) {
    const sender = AMBIENT_SENDERS[i % AMBIENT_SENDERS.length]!;
    events.push(
      baseEvent({
        channelId: "general",
        actorId: sender,
        type: "message_sent",
        payload: {
          content: AMBIENT_LINES[(pulseIndex * AMBIENT_PER_PULSE + i + offset) % AMBIENT_LINES.length]!,
        },
      }),
    );
  }
  return events;
}

/** Visible saturation burst at the flip review; dilutes the no-op noise. */
function burstEvents(reviewIndex: number): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  for (let i = 0; i < 15; i += 1) {
    const sender = AMBIENT_SENDERS[i % AMBIENT_SENDERS.length]!;
    events.push(
      baseEvent({
        channelId: "general",
        actorId: sender,
        type: "message_sent",
        payload: { content: AMBIENT_LINES[(reviewIndex * 7 + i * 5) % AMBIENT_LINES.length]! },
      }),
    );
  }
  return events;
}

function sidelineBurst(): SimulationEvent[] {
  const events: SimulationEvent[] = [];
  for (let i = 0; i < 10; i += 1) {
    events.push(sidelineEvent(AMBIENT_SENDERS[i % AMBIENT_SENDERS.length]!, i));
  }
  return events;
}

function makeAgentState(agentId: string): AgentState {
  return {
    agentId,
    simulationId: "sim_goal_recipe",
    personaId: agentId,
    presence: "active",
    coreMood: {
      valence: 0,
      arousal: 0.5,
      stability: 0.8,
      energy: 0.6,
      circumplexAngle: 0,
      circumplexRadius: 0.5,
      momentumValence: 0,
      momentumArousal: 0,
    },
    socialEmotions: {
      jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0,
      resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0,
      socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0,
    },
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makePersona(id: string, name: string): PersonaConfig {
  return {
    id,
    name,
    archetype: "observer",
    writingStyle: "brief and careful",
    styleExamples: [],
    baselineValence: 0,
    baselineArousal: 0.5,
    baselineStability: 0.8,
    baselineEnergy: 0.6,
    emotionalReactivity: 0.5,
    moodInertia: 0.5,
    maxMoodRotation: 0.5,
    energyRegen: 0.05,
    exclusionSensitivity: 0.5,
    praiseSensitivity: 0.5,
    conflictSensitivity: 0.5,
    boredomSensitivity: 0.5,
    intimacySensitivity: 0.5,
    socialSensitivities: {},
  };
}

const PERSONA_NAMES: Record<(typeof AGENT_IDS)[number], string> = {
  ana: "Ana",
  bruno: "Bruno",
  carla: "Carla",
  diego: "Diego",
};

function makeAgents(): AgentContext[] {
  return AGENT_IDS.map((id) => ({
    id,
    state: makeAgentState(id),
    persona: makePersona(id, PERSONA_NAMES[id]),
  }));
}

const RESOLVE_SEEDS: SimulationEvent[] = [1, 2, 3].map(blockedEvent);

const RECIPES: Record<GoalScenarioId, GoalScenarioRecipe> = {
  "healthy-achiever": {
    id: "healthy-achiever",
    mode: "deterministic",
    agents: makeAgents(),
    channels: [GENERAL_CHANNEL],
    settings: SETTINGS,
    seedEvents: RESOLVE_SEEDS,
    beforePulse: (pulse) => ambientEvents(pulse),
    inject: (review) =>
      review === 3 ? [followUpEvent(3), ...burstEvents(review)] : [],
  },

  "deluded-achiever": {
    id: "deluded-achiever",
    mode: "llm",
    agents: makeAgents(),
    channels: [GENERAL_CHANNEL],
    settings: SETTINGS,
    seedEvents: [...RESOLVE_SEEDS, ridiculeEvent()],
    inject: (review) => [witnessEvent(review)],
  },

  "premature-closer": {
    id: "premature-closer",
    mode: "llm",
    agents: makeAgents(),
    channels: [GENERAL_CHANNEL],
    settings: SETTINGS,
    seedEvents: [...RESOLVE_SEEDS, ridiculeEvent()],
    inject: (review) =>
      review === 1
        ? [witnessEvent(review)]
        : [witnessEvent(review), challengeEvent(review), ridiculeEvent()],
  },

  "contested-consensus": {
    id: "contested-consensus",
    mode: "llm",
    agents: makeAgents(),
    channels: [GENERAL_CHANNEL],
    settings: SETTINGS,
    seedEvents: RESOLVE_SEEDS,
    inject: (review) =>
      review === 1
        ? [witnessEvent(review)]
        : [witnessEvent(review), deferMessageEvent(review), challengeEvent(review)],
  },

  "hollow-completion": {
    id: "hollow-completion",
    mode: "deterministic",
    agents: makeAgents(),
    channels: [GENERAL_CHANNEL],
    settings: SETTINGS,
    // The seeded follow-up commits in the same batch as the blocks, so its
    // createdAt equals goal.createdAt — the completion-beat gate needs a
    // strictly later message, so the seed alone never fires the beat.
    seedEvents: [...RESOLVE_SEEDS, followUpEvent(0)],
    inject: (review) => [witnessEvent(review), followUpEvent(review)],
  },

  "world-briefly-wrong": {
    id: "world-briefly-wrong",
    mode: "deterministic",
    agents: makeAgents(),
    channels: [GENERAL_CHANNEL, SIDELINE_CHANNEL],
    settings: SETTINGS,
    seedEvents: RESOLVE_SEEDS,
    beforePulse: (pulse) => ambientEvents(pulse),
    inject: (review) => {
      if (review === 3) {
        // Ratified-consensus window while the objective is still unmet:
        // defer signals + fresh blocks in the review window + sideline
        // chatter ana cannot see → contested verdict with a log-divergence
        // spike.
        return [
          blockedEvent(4),
          blockedEvent(5),
          deferMessageEvent(30),
          deferMessageEvent(31),
          ...sidelineBurst(),
        ];
      }
      if (review === 4) {
        // The world corrects: follow-up + ratified reactions + a visible
        // burst that settles the divergence under the meaning gate.
        return [
          followUpEvent(4),
          ...burstEvents(review),
          deferReactionEvent("bruno"),
          deferReactionEvent("carla"),
        ];
      }
      return [];
    },
  },
};

export function getGoalRecipe(id: GoalScenarioId): GoalScenarioRecipe {
  const recipe = RECIPES[id];
  if (!recipe) throw new Error(`Unknown goal scenario recipe "${id}"`);
  return recipe;
}

export function allGoalRecipes(): GoalScenarioRecipe[] {
  return GOAL_SCENARIO_IDS.map(getGoalRecipe);
}