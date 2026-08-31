import { describe, it, expect } from "vitest";
import { PromptBuilder } from "../prompt-builder.js";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import type { AgentRuntimeInput, CommittedEvent, Memory } from "@perfectman/shared";

const TRIGGER_ID = "evt-trigger";
const TRIGGER_CONTENT = "TRIGGER_CONTENT_UNIQUE_MARKER";

function makeEvent(i: number): CommittedEvent {
  return {
    id: `evt-${String(i).padStart(3, "0")}`,
    simulationId: "sim-1",
    channelId: "general",
    actorId: `agent-${i % 3}`,
    type: "message_sent",
    payload: { content: `event-${i}-marker ${"x".repeat(140)}` },
    createdAt: 1000 + i,
    pulseIndex: i,
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

const triggeringEvent: CommittedEvent = {
  ...makeEvent(999),
  id: TRIGGER_ID,
  pulseIndex: 999,
  createdAt: 999999,
  payload: { content: TRIGGER_CONTENT },
};

function makeMemory(i: number): Memory {
  return {
    id: `mem-${String(i).padStart(3, "0")}`,
    agentId: "example-friend",
    simulationId: "sim-1",
    type: "episodic",
    subjectAgentIds: ["agent-1"],
    sourceEventIds: [],
    summary: `memory-${i}-marker ${"m".repeat(180)}`,
    emotionalTone: "neutral",
    confidence: (i + 1) / 100,
    unresolved: false,
    createdAt: 5000 + i,
    lastReinforcedAt: 5000 + i,
  };
}

const EVENT_COUNT = 24;
const MEMORY_COUNT = 8;

function makeInput(events: CommittedEvent[], memories: Memory[]): AgentRuntimeInput {
  return {
    simulationId: "sim-1",
    agentId: "example-friend",
    personaConfig: {
      id: "example-friend",
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
      agentId: "example-friend",
      triggeringEvent,
      visibleContextEvents: events,
      ownRecentUtterances: [],
      involvedPeople: [],
      relevantChannels: ["general"],
      relevantMemories: memories,
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

const allEvents = [triggeringEvent, ...Array.from({ length: EVENT_COUNT }, (_, i) => makeEvent(i))];
const allMemories = Array.from({ length: MEMORY_COUNT }, (_, i) => makeMemory(i));

const fullInput = makeInput(allEvents, allMemories);
const rawBuild = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent");
// Floor render: only the triggering event, no memories — the trimmer can never
// go below this, since it never drops the triggering event.
const floorBuild = PromptBuilder.build(
  makeInput([triggeringEvent], []),
  EXAMPLE_PROMPT_PROFILE,
  "action_intent",
);

describe("ActionIntentPromptBuilder maxInputTokens trim", () => {
  it("leaves the prompt untouched when it already fits (no trim record)", () => {
    const built = PromptBuilder.build(
      fullInput,
      EXAMPLE_PROMPT_PROFILE,
      "action_intent",
      rawBuild.inputTokensEstimate + 100,
    );
    expect(built.trim).toBeUndefined();
    expect(built.system).toBe(rawBuild.system);
    expect(built.user).toBe(rawBuild.user);
  });

  it("trims an over-cap assembly down to the cap and records the trim", () => {
    const cap = Math.floor((floorBuild.inputTokensEstimate + rawBuild.inputTokensEstimate) / 2);
    expect(cap).toBeLessThan(rawBuild.inputTokensEstimate);

    const built = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);

    expect(built.inputTokensEstimate).toBeLessThanOrEqual(cap);
    expect(built.trim).toBeDefined();
    expect(built.trim!.maxInputTokens).toBe(cap);
    expect(built.trim!.rawInputTokensEstimate).toBe(rawBuild.inputTokensEstimate);
    expect(built.trim!.finalInputTokensEstimate).toBe(built.inputTokensEstimate);
    expect(built.trim!.droppedInputTokensEstimate).toBe(
      rawBuild.inputTokensEstimate - built.inputTokensEstimate,
    );
    expect(built.trim!.droppedEvents + built.trim!.droppedMemories).toBeGreaterThan(0);
  });

  it("is deterministic: identical input and cap produce byte-identical output", () => {
    const cap = Math.floor((floorBuild.inputTokensEstimate + rawBuild.inputTokensEstimate) / 2);
    const a = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);
    const b = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);
    expect(a.system).toBe(b.system);
    expect(a.user).toBe(b.user);
    expect(a.version).toBe(b.version);
    expect(a.trim).toEqual(b.trim);
  });

  it("drops lowest-salience memories before any recent event", () => {
    // A cap just below the raw estimate: the small overflow is absorbed by
    // dropping memories alone, so no event is touched.
    const cap = rawBuild.inputTokensEstimate - 20;
    const built = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);

    expect(built.trim!.droppedMemories).toBeGreaterThan(0);
    expect(built.trim!.droppedEvents).toBe(0);
    // The lowest-confidence memory (mem-000) goes first; the highest stays.
    expect(built.user).not.toContain("memory-0-marker");
    expect(built.user).toContain(`memory-${MEMORY_COUNT - 1}-marker`);
  });

  it("drops oldest recent events first and always keeps the triggering event", () => {
    // Force every memory out plus a partial slice of the oldest events.
    const perEvent =
      PromptBuilder.build(makeInput([triggeringEvent, makeEvent(0)], []), EXAMPLE_PROMPT_PROFILE, "action_intent")
        .inputTokensEstimate - floorBuild.inputTokensEstimate;
    const keepEvents = 6;
    const cap = floorBuild.inputTokensEstimate + perEvent * keepEvents;

    const built = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);

    expect(built.inputTokensEstimate).toBeLessThanOrEqual(cap);
    expect(built.trim!.droppedMemories).toBe(MEMORY_COUNT);
    expect(built.trim!.droppedEvents).toBeGreaterThan(0);
    expect(built.trim!.droppedEvents).toBeLessThan(EVENT_COUNT);
    // Oldest (event-0) dropped; newest (event-23) and the trigger retained.
    expect(built.user).not.toContain("event-0-marker");
    expect(built.user).toContain(`event-${EVENT_COUNT - 1}-marker`);
    expect(built.user).toContain(TRIGGER_CONTENT);
  });

  it("honors the cap even when it forces every droppable context out", () => {
    const cap = floorBuild.inputTokensEstimate;
    const built = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);

    expect(built.inputTokensEstimate).toBeLessThanOrEqual(cap);
    expect(built.trim!.droppedMemories).toBe(MEMORY_COUNT);
    expect(built.trim!.droppedEvents).toBe(EVENT_COUNT);
    expect(built.user).toContain(TRIGGER_CONTENT);
    expect(built.trim!.withinCap).toBe(true);
    expect(built.trim!.phase).toBe("assembly");
  });

  it("flags an irreducible over-cap prompt with withinCap:false after shedding everything droppable", () => {
    // Cap below the floor render: the drop loop exhausts every memory and
    // event and the persona + contract + decision + triggering event alone
    // still blow the cap.
    const cap = Math.floor(floorBuild.inputTokensEstimate / 2);
    const built = PromptBuilder.build(fullInput, EXAMPLE_PROMPT_PROFILE, "action_intent", cap);

    expect(built.trim).toBeDefined();
    expect(built.trim!.withinCap).toBe(false);
    expect(built.trim!.droppedMemories).toBe(MEMORY_COUNT);
    expect(built.trim!.droppedEvents).toBe(EVENT_COUNT);
    expect(built.trim!.finalInputTokensEstimate).toBeGreaterThan(cap);
    expect(built.inputTokensEstimate).toBe(built.trim!.finalInputTokensEstimate);
    expect(built.user).toContain(TRIGGER_CONTENT);
  });

  it("records a trim even when the raw render is over-cap with nothing droppable", () => {
    // No context events and no memories to begin with — the trimmer has
    // nothing to shed, but the render is still over-cap and the send must be
    // logged rather than shipped silently.
    const cap = 10;
    const built = PromptBuilder.build(
      makeInput([triggeringEvent], []),
      EXAMPLE_PROMPT_PROFILE,
      "action_intent",
      cap,
    );

    expect(built.trim).toBeDefined();
    expect(built.trim!.withinCap).toBe(false);
    expect(built.trim!.droppedEvents).toBe(0);
    expect(built.trim!.droppedMemories).toBe(0);
    expect(built.trim!.rawInputTokensEstimate).toBe(built.trim!.finalInputTokensEstimate);
    expect(built.trim!.finalInputTokensEstimate).toBeGreaterThan(cap);
  });
});
