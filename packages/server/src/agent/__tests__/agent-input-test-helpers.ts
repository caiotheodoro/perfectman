import type { AgentRuntimeInput, CommittedEvent, Memory } from "@perfectman/shared";

/**
 * Shared heavy-input fixtures for the agent-runtime prompt suites. The trim
 * and step suites compute caps relative to PromptBuilder estimates over this
 * same persona/context arrangement, so it is defined here once (Q5) instead
 * of cloned per file with drifting sizes.
 */

export function makeContextEvent(index: number, simulationId = "sim-1"): CommittedEvent {
  return {
    id: `evt-${String(index).padStart(3, "0")}`,
    simulationId,
    channelId: "general",
    actorId: `agent-${index % 3}`,
    type: "message_sent",
    payload: { content: `event-${index}-marker ${"x".repeat(140)}` },
    createdAt: 1000 + index,
    pulseIndex: index,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public message",
    },
  };
}

export function makeContextMemory(index: number, simulationId = "sim-1"): Memory {
  return {
    id: `mem-${String(index).padStart(3, "0")}`,
    agentId: "example-friend",
    simulationId,
    type: "episodic",
    subjectAgentIds: ["agent-1"],
    sourceEventIds: [],
    summary: `memory-${index}-marker ${"m".repeat(180)}`,
    emotionalTone: "neutral",
    confidence: (index + 1) / 100,
    unresolved: false,
    createdAt: 5000 + index,
    lastReinforcedAt: 5000 + index,
  };
}

export type AgentInputFixtureOptions = {
  simulationId?: string;
  triggeringEvent?: CommittedEvent | null;
  visibleContextEvents?: CommittedEvent[];
  ownRecentUtterances?: string[];
  relevantMemories?: Memory[];
};

export function makeAgentRuntimeInput(options: AgentInputFixtureOptions = {}): AgentRuntimeInput {
  const agentId = "example-friend";
  return {
    simulationId: options.simulationId ?? "sim-1",
    agentId,
    personaConfig: {
      id: agentId,
      name: "Example Friend",
      archetype: "careful-observer",
      writingStyle: "lowercase blunt",
      styleExamples: [],
      baselineValence: 0,
      baselineArousal: 0,
      baselineStability: 0.5,
      baselineEnergy: 0.5,
      emotionalReactivity: 1,
      moodInertia: 0.5,
      maxMoodRotation: 0.5,
      energyRegen: 0.05,
      exclusionSensitivity: 1,
      praiseSensitivity: 1,
      conflictSensitivity: 1,
      boredomSensitivity: 1,
      intimacySensitivity: 1,
      socialSensitivities: {},
    },
    perceptionPacket: {
      agentId,
      triggeringEvent: options.triggeringEvent ?? null,
      visibleContextEvents: options.visibleContextEvents ?? [],
      // Same numbering the perception builder emits: e1 = triggering event
      // (when present), then context events in order.
      eventHandles: Object.fromEntries(
        (options.triggeringEvent
          ? [options.triggeringEvent, ...(options.visibleContextEvents ?? [])]
          : (options.visibleContextEvents ?? [])
        ).map((e, i) => [`e${i + 1}`, e.id]),
      ),
      ownRecentUtterances: options.ownRecentUtterances ?? [],
      involvedPeople: [],
      relevantChannels: ["general"],
      relevantMemories: options.relevantMemories ?? [],
      translatedEmotionalState: {
        moodDescription: "You feel steady.",
        socialContext: "The room is active.",
        relationalFlavors: [],
        pressureDescriptions: [],
        inhibitionDescriptions: [],
      },
      availableActions: [
        { intentType: "send_message", channelTargets: ["general"], personTargets: [], blocked: false },
      ],
    },
    emotionalState: {
      coreMood: {
        valence: 0, arousal: 0, stability: 0.5, energy: 0.5,
        circumplexAngle: 0, circumplexRadius: 0, momentumValence: 0, momentumArousal: 0,
      },
      socialEmotions: {
        jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
        affection: 0, resentment: 0, suspicion: 0, admiration: 0,
        contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
        desireForStatus: 0, desireForIntimacy: 0,
      },
      relationalStates: new Map(),
    },
    activeMotivations: [],
    activePressures: [],
    activeInhibitions: [],
    relevantMemories: [],
    availableActions: [
      { intentType: "send_message", channelTargets: ["general"], personTargets: [], blocked: false },
    ],
    budgetPriority: "normal",
    triggeringReason: "attention_event",
  };
}
