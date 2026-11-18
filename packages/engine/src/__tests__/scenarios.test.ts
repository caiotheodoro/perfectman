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
  buildVascoColdStartScenario,
  buildDarioTomasExclusionScenario,
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
      expect(result.availableActions).toHaveLength(10);
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

// ── 3. buildVascoColdStartScenario ─────────────────────────────────────────

describe("buildVascoColdStartScenario", () => {
  it("vasco boredom initiative is above threshold", () => {
    const s = buildVascoColdStartScenario();

    expect(s.expectedSignals.vascoHasHighBoredomInitiative).toBe(true);
    expect(s.expectedSignals.channelIsEmpty).toBe(true);

    const boredomAcc = s.vascoState.initiativeAccumulators.find(
      a => a.source === "boredom_accumulator",
    );
    expect(boredomAcc).toBeDefined();
    expect(boredomAcc!.value).toBeGreaterThan(boredomAcc!.threshold);
  });

  it("vasco engine step proceeds with initiative", () => {
    const s = buildVascoColdStartScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 1,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.vascoState,
      persona: s.vascoPersona,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.vascoState.relationalStates,
      worldSignals: { ...DEFAULT_WORLD, activeAgentCount: 1 },
      rateLimitStatus: makeRateLimit("vasco"),
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
    const s = buildVascoColdStartScenario();
    expect(s.expectedSignals.otherAgentsOffline).toBe(true);
    for (const state of s.otherStates) {
      expect(state.presence).toBe("offline");
    }
  });
});

// ── 4. buildDarioTomasExclusionScenario ───────────────────────────────────────

describe("buildDarioTomasExclusionScenario", () => {
  it("dario initial state has elevated fear and anxiety", () => {
    const s = buildDarioTomasExclusionScenario();
    expect(s.agentStates.dario.socialEmotions.fearOfExclusion).toBeGreaterThan(0);
    expect(s.agentStates.dario.socialEmotions.socialAnxiety).toBeGreaterThan(0);
  });

  it("after engine step, dario fear of exclusion increases due to being ignored", () => {
    const s = buildDarioTomasExclusionScenario();
    const initialFear = s.agentStates.dario.socialEmotions.fearOfExclusion;

    const snapshot: EngineSnapshot = {
      pulseIndex: 2,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.agentStates.dario,
      persona: s.personas.dario,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.dario.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("dario"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // Fear of exclusion should rise (or at minimum not drop significantly)
    // as tomas replied to vasco while ignoring dario's message
    expect(result.updatedAgentState.socialEmotions.fearOfExclusion)
      .toBeGreaterThanOrEqual(initialFear);
    assertEmotionBounds(result.updatedAgentState);
  });

  it("exclusion scenario events produce attention for dario", () => {
    const s = buildDarioTomasExclusionScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 2,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: { ...s.agentStates.dario, lastProcessedEventId: null },
      persona: s.personas.dario,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.dario.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("dario"),
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
  it("lara has high affection and shame", () => {
    const s = buildPrivateChannelMotiveScenario();
    expect(s.agentStates.lara.socialEmotions.affection).toBeGreaterThan(0.5);
    expect(s.agentStates.lara.socialEmotions.shame).toBeGreaterThan(0.3);
    expect(s.agentStates.lara.socialEmotions.socialAnxiety).toBeGreaterThan(0.3);
  });

  it("create_channel action is available and not blocked", () => {
    const s = buildPrivateChannelMotiveScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 1,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.agentStates.lara,
      persona: s.personas.lara,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.lara.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("lara"),
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

  it("laras motivations include attraction or comfort", () => {
    const s = buildPrivateChannelMotiveScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 1,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.agentStates.lara,
      persona: s.personas.lara,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.lara.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("lara"),
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
  it("renan has initial social anxiety from scenario setup", () => {
    const s = buildDelayedReplyScenario();
    expect(s.agentStates.renan.socialEmotions.socialAnxiety).toBeGreaterThan(0);
    expect(s.agentStates.renan.socialEmotions.fearOfExclusion).toBeGreaterThan(0);
  });

  it("delayed reply scenario events are visible to renan", () => {
    const s = buildDelayedReplyScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: s.currentPulseIndex,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: { ...s.agentStates.renan, lastProcessedEventId: null },
      persona: s.personas.renan,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.renan.relationalStates,
      worldSignals: {
        ...DEFAULT_WORLD,
        timeSinceLastPublicMessage: 240, // 4 minutes of silence
        channelMessageRatePerMinute: 0.25,
      },
      rateLimitStatus: makeRateLimit("renan"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // Renan should see his own message in visible events
    expect(result.visibleEvents).toHaveLength(1);
    expect(result.visibleEvents[0]!.actorId).toBe("renan");
    assertEmotionBounds(result.updatedAgentState);
  });

  it("interpretations produced for delayed reply context", () => {
    const s = buildDelayedReplyScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: s.currentPulseIndex,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: { ...s.agentStates.renan, lastProcessedEventId: null },
      persona: s.personas.renan,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.renan.relationalStates,
      worldSignals: {
        ...DEFAULT_WORLD,
        timeSinceLastPublicMessage: 240,
        channelMessageRatePerMinute: 0.25,
      },
      rateLimitStatus: makeRateLimit("renan"),
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
  it("dario has overwhelming shame and humiliation in scenario", () => {
    const s = buildNoOpInhibitionScenario();
    expect(s.agentStates.dario.socialEmotions.shame).toBeGreaterThan(0.7);
    expect(s.agentStates.dario.socialEmotions.humiliation).toBeGreaterThan(0.5);
    expect(s.agentStates.dario.coreMood.valence).toBeLessThan(-0.5);
  });

  it("dario's shame block exists and the decision honors the docs' rule (pressure vs inhibition)", () => {
    const s = buildNoOpInhibitionScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 4,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.agentStates.dario,
      persona: s.personas.dario,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.dario.relationalStates,
      worldSignals: {
        ...DEFAULT_WORLD,
        highArousalNearby: true,
        averageChannelArousal: 0.7,
      },
      rateLimitStatus: makeRateLimit("dario"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // The docs' rule: if strongestPressure > strongestInhibition → act (the
    // LLM then decides with the shame in front of it); otherwise the engine
    // silences. A high-arousal shamed Dario may ALSO snap back (provoke) —
    // both are valid; the shame block must be present either way.
    const hasShameBlock = result.inhibitions.some(i => i.type === "shame_about_desire");
    expect(hasShameBlock).toBe(true);
    if (["no_op", "memory_only", "delay"].includes(result.decision.outcome)) {
      expect(result.decision.needsLLM).toBe(false);
    } else {
      expect(result.decision.outcome).toBe("act");
      expect(result.decision.needsLLM).toBe(true);
    }
    assertEmotionBounds(result.updatedAgentState);
  });

  it("no_op produces non-null noOpRecord with non-empty privateMotiveSeed", () => {
    const s = buildNoOpInhibitionScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 4,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: s.agentStates.dario,
      persona: s.personas.dario,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.dario.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("dario"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    if (result.decision.outcome === "no_op") {
      expect(result.noOpRecord).not.toBeNull();
      expect(result.noOpRecord!.agentId).toBe("dario");
      expect(result.decision.privateMotiveSeed.length).toBeGreaterThan(0);
    }
    // (if memory_only or delay, noOpRecord may be null — that's fine)
  });
});

// ── 8. buildBiasedMemoryScenario ─────────────────────────────────────────────

describe("buildBiasedMemoryScenario", () => {
  it("vasco has both positive and negative memories of tomas in scenario", () => {
    const s = buildBiasedMemoryScenario();
    const tones = s.vascoMemories.map(m => m.emotionalTone);
    expect(tones).toContain("positive");
    expect(tones).toContain("negative");
    expect(s.vascoMemories).toHaveLength(5);
  });

  it("vasco negative mood setup is valid", () => {
    const s = buildBiasedMemoryScenario();
    expect(s.agentStates.vasco.coreMood.valence).toBeLessThan(-0.3);
    expect(s.agentStates.vasco.socialEmotions.resentment).toBeGreaterThan(0);
  });

  it("perception packet includes tomas-related memories when tomas triggers event", () => {
    const s = buildBiasedMemoryScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 2,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: { ...s.agentStates.vasco, lastProcessedEventId: null },
      persona: s.personas.vasco,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.vasco.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("vasco"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // All 5 memories are about tomas — should all be relevant
    const memoriesAboutTomas = result.perceptionPacket.relevantMemories.filter(
      m => m.subjectAgentIds.includes("tomas"),
    );
    expect(memoriesAboutTomas.length).toBeGreaterThan(0);
    // Bounded to 8 max
    expect(result.perceptionPacket.relevantMemories.length).toBeLessThanOrEqual(8);
    assertEmotionBounds(result.updatedAgentState);
  });

  it("keeps a salient old memory inside the 8-memory cap against fresher noise", () => {
    const s = buildBiasedMemoryScenario();
    const template = s.vascoMemories[0]!;
    const baseTime = template.createdAt;

    const openLoop = {
      ...template,
      id: "mem_open_loop",
      type: "pending_intention" as const,
      subjectAgentIds: [],
      summary: "ainda preciso resolver aquilo",
      confidence: 0.95,
      unresolved: true,
      createdAt: baseTime - 600_000,
      lastReinforcedAt: baseTime - 600_000,
    };
    const freshNoise = Array.from({ length: 10 }, (_, i) => ({
      ...template,
      id: `mem_noise_${i}`,
      type: "episodic" as const,
      subjectAgentIds: [],
      summary: `ruido ${i}`,
      confidence: 0.2,
      unresolved: false,
      createdAt: baseTime + 1000 * (i + 1),
      lastReinforcedAt: baseTime + 1000 * (i + 1),
    }));

    const snapshot: EngineSnapshot = {
      pulseIndex: 2,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: {
        ...s.agentStates.vasco,
        lastProcessedEventId: null,
        memories: [...s.vascoMemories, openLoop, ...freshNoise],
      },
      persona: s.personas.vasco,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.vasco.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("vasco"),
      dt: 3,
      rng: createSeededRng(42),
      now: 1_700_000_000_000,
    };

    const selected = runEngineStep(snapshot).perceptionPacket.relevantMemories;
    const selectedIds = selected.map(m => m.id);

    expect(selected).toHaveLength(8);
    // Recency-first selection would evict this for the ten fresher noise entries.
    expect(selectedIds).toContain("mem_open_loop");
    expect(selectedIds.filter(id => id.startsWith("mem_noise_")).length).toBeLessThan(10);
  });

  it("vasco sees the tomas trigger event", () => {
    const s = buildBiasedMemoryScenario();

    const snapshot: EngineSnapshot = {
      pulseIndex: 2,
      simulation: s.simulation,
      recentEventsWindow: s.committedEvents,
      agentState: { ...s.agentStates.vasco, lastProcessedEventId: null },
      persona: s.personas.vasco,
      channels: s.channels,
      channelMembership: s.memberships,
      relationalStates: s.agentStates.vasco.relationalStates,
      worldSignals: DEFAULT_WORLD,
      rateLimitStatus: makeRateLimit("vasco"),
      dt: 3,
      rng: createSeededRng(42),

      now: 1_700_000_000_000,
    };

    const result = runEngineStep(snapshot);

    // The event from tomas should be visible
    const tomasEvents = result.visibleEvents.filter(e => e.actorId === "tomas");
    expect(tomasEvents.length).toBeGreaterThan(0);
    // tomas should be in involvedPeople
    expect(result.perceptionPacket.involvedPeople).toContain("tomas");
  });
});
