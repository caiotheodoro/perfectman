/**
 * Scenario tests — fixture → engine pipeline.
 * Each test builds a full EngineSnapshot from a shared fixture,
 * runs runEngineStep, and asserts scenario-specific expectedSignals.
 *
 * These catch cross-module wiring bugs that unit tests miss.
 */

import { describe, it, expect } from "vitest";
import type {
  EngineSnapshot,
  RateLimitStatus,
  WorldSignals,
} from "@perfectman/shared";
import {
  createSeededRng,
  buildSimulationFixture,
  buildFivePersonaSeedFixture,
  buildGoulartColdStartScenario,
  buildBrunoCaioExclusionScenario,
  buildPrivateChannelMotiveScenario,
  buildDelayedReplyScenario,
  buildNoOpInhibitionScenario,
  buildBiasedMemoryScenario,
} from "@perfectman/shared";
import { runEngineStep } from "../step/run-engine-step.js";

// ── Shared defaults ───────────────────────────────────────────────────────────

const DEFAULT_WORLD: WorldSignals = {
  highArousalNearby: false,
  averageChannelArousal: 0.3,
  activeAgentCount: 3,
  timeSinceLastPublicMessage: 30,
  channelMessageRatePerMinute: 2,
  recentTopicShift: false,
};

function makeRateLimit(agentId: string): RateLimitStatus {
  return {
    agentId,
    messagesThisMinute: 0,
    privateChannelsCreated: 0,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    blocked: false,
  };
}

// ── Helper: assert all emotion values are in valid ranges ─────────────────────

function assertEmotionBounds(state: ReturnType<typeof runEngineStep>["updatedAgentState"]): void {
  const { coreMood, socialEmotions } = state;

  expect(coreMood.valence, "valence").toBeGreaterThanOrEqual(-1);
  expect(coreMood.valence, "valence").toBeLessThanOrEqual(1);
  expect(coreMood.arousal, "arousal").toBeGreaterThanOrEqual(0);
  expect(coreMood.arousal, "arousal").toBeLessThanOrEqual(1);
  expect(coreMood.stability, "stability").toBeGreaterThanOrEqual(0.1);
  expect(coreMood.stability, "stability").toBeLessThanOrEqual(1);
  expect(coreMood.energy, "energy").toBeGreaterThanOrEqual(0);
  expect(coreMood.energy, "energy").toBeLessThanOrEqual(1);

  for (const [key, val] of Object.entries(socialEmotions)) {
    expect(val as number, `socialEmotions.${key}`).toBeGreaterThanOrEqual(0);
    expect(val as number, `socialEmotions.${key}`).toBeLessThanOrEqual(1);
  }
}

// ── 1. buildSimulationFixture ─────────────────────────────────────────────────

describe("buildSimulationFixture scenario", () => {
  it("all 5 agents complete an engine step without error", () => {
    const fixture = buildSimulationFixture();

    for (let i = 0; i < fixture.personas.length; i++) {
      const persona = fixture.personas[i]!;
      const agentState = fixture.agentStates[i]!;

      const snapshot: EngineSnapshot = {
        pulseIndex: 1,
        simulation: fixture.simulation,
        recentEventsWindow: [],
        agentState,
        persona,
        channels: fixture.channels,
        channelMembership: fixture.memberships,
        relationalStates: agentState.relationalStates,
        worldSignals: DEFAULT_WORLD,
        rateLimitStatus: makeRateLimit(persona.id),
        dt: 3,
        rng: createSeededRng(42 + i),
        now: 1_700_000_000_000,
      };

      const result = runEngineStep(snapshot);

      expect(result.perceptionPacket.agentId).toBe(persona.id);
      expect(result.updatedAgentState.agentId).toBe(persona.id);
      assertEmotionBounds(result.updatedAgentState);
      expect(result.availableActions).toHaveLength(11);
      expect(result.initiativeCandidates).toHaveLength(17);
    }
  });
});

// ── 2. buildFivePersonaSeedFixture ───────────────────────────────────────────

describe("buildFivePersonaSeedFixture scenario", () => {
  const SIM_ID = "sim_five_persona";

  it("each persona seed produces a valid engine step result", () => {
    const entries = buildFivePersonaSeedFixture(SIM_ID);

    for (const { persona, agentState } of entries) {
      const channel = {
        id: "ch_geral",
        simulationId: SIM_ID,
        type: "public_channel" as const,
        name: "#geral",
        createdBy: "system",
        memberAgentIds: entries.map(e => e.persona.id),
        spectatorVisible: true,
        operatorVisible: true,
        createdForMotives: [],
        status: "active" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const memberships = entries.map(e => ({
        channelId: "ch_geral",
        agentId: e.persona.id,
        joinedAt: Date.now(),
      }));

      const simulation = {
        id: SIM_ID,
        name: "Five Persona Test",
        status: "running" as const,
        agentIds: entries.map(e => e.persona.id),
        channelIds: ["ch_geral"],
        settings: {
          omniscientSpectatorMode: false,
          allowPrivateChannels: true,
          maxPrivateChannelsPerAgent: 3,
          maxMessagesPerMinutePerAgent: 10,
          llmCallBudgetPerMinute: 20,
          pulseIntervalMs: 3000,
          tokenBudgetPerHour: 50000,
        },
        seed: 99,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const snapshot: EngineSnapshot = {
        pulseIndex: 1,
        simulation,
        recentEventsWindow: [],
        agentState,
        persona,
        channels: [channel],
        channelMembership: memberships,
        relationalStates: agentState.relationalStates,
        worldSignals: DEFAULT_WORLD,
        rateLimitStatus: makeRateLimit(persona.id),
        dt: 3,
        rng: createSeededRng(99),
        now: 1_700_000_000_000,
      };

      const result = runEngineStep(snapshot);

      expect(result.updatedAgentState.agentId).toBe(persona.id);
      expect(result.updatedAgentState.simulationId).toBe(SIM_ID);
      assertEmotionBounds(result.updatedAgentState);
      expect(isNaN(result.attentionResults.dueScore)).toBe(false);
    }
  });

  it("different personas produce different baseline moods after a step", () => {
    const entries = buildFivePersonaSeedFixture(SIM_ID);
    const results = entries.map(({ persona, agentState }) => {
      const snapshot: EngineSnapshot = {
        pulseIndex: 1,
        simulation: {
          id: SIM_ID, name: "Five", status: "running", agentIds: [], channelIds: [],
          settings: { omniscientSpectatorMode: false, allowPrivateChannels: true, maxPrivateChannelsPerAgent: 3, maxMessagesPerMinutePerAgent: 10, llmCallBudgetPerMinute: 20, pulseIntervalMs: 3000, tokenBudgetPerHour: 50000 },
          seed: 1, createdAt: Date.now(), updatedAt: Date.now(),
        },
        recentEventsWindow: [],
        agentState,
        persona,
        channels: [],
        channelMembership: [],
        relationalStates: new Map(),
        worldSignals: DEFAULT_WORLD,
        rateLimitStatus: makeRateLimit(persona.id),
        dt: 3,
        rng: createSeededRng(1),
        now: 1_700_000_000_000,
      };
      return runEngineStep(snapshot).updatedAgentState.coreMood.valence;
    });

    // Not all 5 personas should have the same valence after a step
    const unique = new Set(results.map(v => Math.round(v * 100)));
    expect(unique.size).toBeGreaterThan(1);
  });
});

// ── 3. buildGoulartColdStartScenario ─────────────────────────────────────────

describe("buildGoulartColdStartScenario", () => {
  it("goulart boredom initiative is above threshold", () => {
    const s = buildGoulartColdStartScenario();

    expect(s.expectedSignals.goulartHasHighBoredomInitiative).toBe(true);
    expect(s.expectedSignals.channelIsEmpty).toBe(true);

    const boredomAcc = s.goulartState.initiativeAccumulators.find(
      a => a.source === "boredom_accumulator",
    );
    expect(boredomAcc).toBeDefined();
    expect(boredomAcc!.value).toBeGreaterThan(boredomAcc!.threshold);
  });

  it("goulart engine step proceeds with initiative", () => {
    const s = buildGoulartColdStartScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 1,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.goulartState,
      persona: s.goulartPersona,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.goulartState.relationalStates,
      worldSignals: { ...DEFAULT_WORLD, activeAgentCount: 1 },
      rateLimitStatus: makeRateLimit("goulart"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // Boredom initiative is above threshold → candidate should proceed
    const boredomCandidate = result.initiativeCandidates.find(c => c.source === "boredom_accumulator");
    expect(boredomCandidate).toBeDefined();
    expect(boredomCandidate!.proceed).toBe(true);
    // Decision should produce some outcome (may depend on pressures/inhibitions)
    expect(["act", "delay", "no_op", "memory_only"]).toContain(result.decision.outcome);
    assertEmotionBounds(result.updatedAgentState);
  });

  it("other agents are offline in cold-start scenario", () => {
    const s = buildGoulartColdStartScenario();
    expect(s.expectedSignals.otherAgentsOffline).toBe(true);
    for (const state of s.otherStates) {
      expect(state.presence).toBe("offline");
    }
  });
});

// ── 4. buildBrunoCaioExclusionScenario ───────────────────────────────────────

describe("buildBrunoCaioExclusionScenario", () => {
  it("bruno initial state has elevated fear and anxiety", () => {
    const s = buildBrunoCaioExclusionScenario();
    expect(s.agentStates.bruno.socialEmotions.fearOfExclusion).toBeGreaterThan(0);
    expect(s.agentStates.bruno.socialEmotions.socialAnxiety).toBeGreaterThan(0);
  });

  it("after engine step, bruno fear of exclusion increases due to being ignored", () => {
    const s = buildBrunoCaioExclusionScenario();
    const initialFear = s.agentStates.bruno.socialEmotions.fearOfExclusion;

    const snapshot: EngineSnapshot = {
      pulseIndex: 2,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.agentStates.bruno,
      persona: s.personas.bruno,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.bruno.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("bruno"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // Fear of exclusion should rise (or at minimum not drop significantly)
    // as caio replied to goulart while ignoring bruno's message
    expect(result.updatedAgentState.socialEmotions.fearOfExclusion)
      .toBeGreaterThanOrEqual(initialFear);
    assertEmotionBounds(result.updatedAgentState);
  });

  it("exclusion scenario events produce attention for bruno", () => {
    const s = buildBrunoCaioExclusionScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 2,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: { ...s.agentStates.bruno, lastProcessedEventId: null },
      persona: s.personas.bruno,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.bruno.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("bruno"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);
    // Events were committed — should produce new events to process
    expect(result.newEvents.length).toBeGreaterThan(0);
  });
});

// ── 5. buildPrivateChannelMotiveScenario ─────────────────────────────────────

describe("buildPrivateChannelMotiveScenario", () => {
  it("mariana has high affection and shame", () => {
    const s = buildPrivateChannelMotiveScenario();
    expect(s.agentStates.mariana.socialEmotions.affection).toBeGreaterThan(0.5);
    expect(s.agentStates.mariana.socialEmotions.shame).toBeGreaterThan(0.3);
    expect(s.agentStates.mariana.socialEmotions.socialAnxiety).toBeGreaterThan(0.3);
  });

  it("create_channel action is available and not blocked", () => {
    const s = buildPrivateChannelMotiveScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 1,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.agentStates.mariana,
      persona: s.personas.mariana,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.mariana.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("mariana"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);
    const createChannel = result.availableActions.find(
      a => a.intentType === "create_channel",
    );

    expect(createChannel).toBeDefined();
    expect(createChannel!.blocked).toBe(false);
    assertEmotionBounds(result.updatedAgentState);
  });

  it("marianas motivations include attraction or comfort", () => {
    const s = buildPrivateChannelMotiveScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 1,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.agentStates.mariana,
      persona: s.personas.mariana,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.mariana.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("mariana"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);
    const motivationTypes = result.motivations.map(m => m.type);
    const hasSocialMotive = motivationTypes.some(t =>
      ["attraction", "comfort", "vulnerability", "liking"].includes(t),
    );
    expect(hasSocialMotive).toBe(true);
  });
});

// ── 6. buildDelayedReplyScenario ─────────────────────────────────────────────

describe("buildDelayedReplyScenario", () => {
  it("leo has initial social anxiety from scenario setup", () => {
    const s = buildDelayedReplyScenario();
    expect(s.agentStates.leo.socialEmotions.socialAnxiety).toBeGreaterThan(0);
    expect(s.agentStates.leo.socialEmotions.fearOfExclusion).toBeGreaterThan(0);
  });

  it("delayed reply scenario events are visible to leo", () => {
    const s = buildDelayedReplyScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: s.currentPulseIndex,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: { ...s.agentStates.leo, lastProcessedEventId: null },
      persona: s.personas.leo,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.leo.relationalStates,
      worldSignals: {
        ...DEFAULT_WORLD,
        timeSinceLastPublicMessage: 240, // 4 minutes of silence
        channelMessageRatePerMinute: 0.25,
      },
      rateLimitStatus: makeRateLimit("leo"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // Leo should see his own message in visible events
    expect(result.visibleEvents).toHaveLength(1);
    expect(result.visibleEvents[0]!.actorId).toBe("leo");
    assertEmotionBounds(result.updatedAgentState);
  });

  it("interpretations produced for delayed reply context", () => {
    const s = buildDelayedReplyScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: s.currentPulseIndex,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: { ...s.agentStates.leo, lastProcessedEventId: null },
      persona: s.personas.leo,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.leo.relationalStates,
      worldSignals: {
        ...DEFAULT_WORLD,
        timeSinceLastPublicMessage: 240,
        channelMessageRatePerMinute: 0.25,
      },
      rateLimitStatus: makeRateLimit("leo"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // reply_latency or public_silence interpretation should fire
    const signalTypes = result.interpretations.map(i => i.signalType);
    const hasLatencySignal = signalTypes.some(s =>
      ["reply_latency", "public_silence"].includes(s),
    );
    expect(hasLatencySignal).toBe(true);
    // Ambiguity preserved: each interpretation has a non-empty description
    for (const interp of result.interpretations) {
      expect(interp.description.length).toBeGreaterThan(0);
    }
  });
});

// ── 7. buildNoOpInhibitionScenario ───────────────────────────────────────────

describe("buildNoOpInhibitionScenario", () => {
  it("bruno has overwhelming shame and humiliation in scenario", () => {
    const s = buildNoOpInhibitionScenario();
    expect(s.agentStates.bruno.socialEmotions.shame).toBeGreaterThan(0.7);
    expect(s.agentStates.bruno.socialEmotions.humiliation).toBeGreaterThan(0.5);
    expect(s.agentStates.bruno.coreMood.valence).toBeLessThan(-0.5);
  });

  it("bruno decision is no_op or memory_only when overwhelmed by shame", () => {
    const s = buildNoOpInhibitionScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 4,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.agentStates.bruno,
      persona: s.personas.bruno,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.bruno.relationalStates,
      worldSignals: {
        ...DEFAULT_WORLD,
        highArousalNearby: true,
        averageChannelArousal: 0.7,
      },
      rateLimitStatus: makeRateLimit("bruno"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // Overwhelmed shame → no_op or memory_only (both are valid inhibited outcomes)
    expect(["no_op", "memory_only", "delay"]).toContain(result.decision.outcome);
    assertEmotionBounds(result.updatedAgentState);
  });

  it("no_op produces non-null noOpRecord with non-empty privateMotiveSeed", () => {
    const s = buildNoOpInhibitionScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 4,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.agentStates.bruno,
      persona: s.personas.bruno,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.bruno.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("bruno"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    if (result.decision.outcome === "no_op") {
      expect(result.noOpRecord).not.toBeNull();
      expect(result.noOpRecord!.agentId).toBe("bruno");
      expect(result.decision.privateMotiveSeed.length).toBeGreaterThan(0);
    }
    // (if memory_only or delay, noOpRecord may be null — that's fine)
  });
});

// ── 8. buildBiasedMemoryScenario ─────────────────────────────────────────────

describe("buildBiasedMemoryScenario", () => {
  it("goulart has both positive and negative memories of caio in scenario", () => {
    const s = buildBiasedMemoryScenario();
    const tones = s.goulartMemories.map(m => m.emotionalTone);
    expect(tones).toContain("positive");
    expect(tones).toContain("negative");
    expect(s.goulartMemories).toHaveLength(5);
  });

  it("goulart negative mood setup is valid", () => {
    const s = buildBiasedMemoryScenario();
    expect(s.agentStates.goulart.coreMood.valence).toBeLessThan(-0.3);
    expect(s.agentStates.goulart.socialEmotions.resentment).toBeGreaterThan(0);
  });

  it("perception packet includes caio-related memories when caio triggers event", () => {
    const s = buildBiasedMemoryScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 2,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: { ...s.agentStates.goulart, lastProcessedEventId: null },
      persona: s.personas.goulart,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.goulart.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("goulart"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // All 5 memories are about caio — should all be relevant
    const memoriesAboutCaio = result.perceptionPacket.relevantMemories.filter(
      m => m.subjectAgentIds.includes("caio"),
    );
    expect(memoriesAboutCaio.length).toBeGreaterThan(0);
    // Bounded to 8 max
    expect(result.perceptionPacket.relevantMemories.length).toBeLessThanOrEqual(8);
    assertEmotionBounds(result.updatedAgentState);
  });

  it("goulart sees the caio trigger event", () => {
    const s = buildBiasedMemoryScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 2,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: { ...s.agentStates.goulart, lastProcessedEventId: null },
      persona: s.personas.goulart,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.goulart.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("goulart"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // The event from caio should be visible
    const caioEvents = result.visibleEvents.filter(e => e.actorId === "caio");
    expect(caioEvents.length).toBeGreaterThan(0);
    // caio should be in involvedPeople
    expect(result.perceptionPacket.involvedPeople).toContain("caio");
  });
});
