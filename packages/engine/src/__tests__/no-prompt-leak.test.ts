/**
 * No Prompt Leak tests.
 *
 * Assert that data flowing into the LLM prompt contains:
 *   - No raw numeric decimal values (0.75, -0.3, 1.0 etc.)
 *   - No other agents' private motive data
 *   - No operator-internal or stagnation events in perceptionPacket
 *   - No decimal values in relationalFlavors descriptions
 */

import { describe, it, expect } from "vitest";
import type {
  CoreMood,
  SocialEmotions,
  RelationalState,
  Pressure,
  Inhibition,
  EngineSnapshot,
  CommittedEvent,
} from "@perfectman/shared";
import { CAIO, createSeededRng } from "@perfectman/shared";
import { translateEmotionalState } from "../prompt/translate-emotional-state.js";
import { runEngineStep } from "../step/run-engine-step.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

const DECIMAL_PATTERN = /\b-?\d+\.\d+\b/;

function assertNoDecimals(text: string, context: string): void {
  expect(text, `${context} contains decimal number: "${text.match(DECIMAL_PATTERN)?.[0]}"`).not.toMatch(DECIMAL_PATTERN);
}

function makeMood(overrides?: Partial<CoreMood>): CoreMood {
  return {
    valence: 0.75,
    arousal: 0.55,
    stability: 0.6,
    energy: 0.7,
    circumplexAngle: 1.2,
    circumplexRadius: 0.45,
    momentumValence: 0.2,
    momentumArousal: -0.1,
    ...overrides,
  };
}

function makeSocial(overrides?: Partial<SocialEmotions>): SocialEmotions {
  return {
    jealousy: 0.3,
    envy: 0.2,
    humiliation: 0.6,
    pride: 0.4,
    shame: 0.7,
    affection: 0.5,
    resentment: 0.8,
    suspicion: 0.55,
    admiration: 0.45,
    contempt: 0.35,
    neediness: 0.65,
    socialAnxiety: 0.5,
    fearOfExclusion: 0.6,
    desireForStatus: 0.4,
    desireForIntimacy: 0.7,
    ...overrides,
  };
}

function makeRelational(targetId: string, overrides?: Partial<RelationalState>): RelationalState {
  return {
    targetAgentId: targetId,
    trust: 0.3,
    affection: 0.6,
    resentment: 0.4,
    attraction: 0.5,
    suspicion: 0.2,
    admiration: 0.55,
    envy: 0.1,
    comfort: 0.45,
    threat: 0.3,
    curiosity: 0.7,
    desireForCloseness: 0.6,
    desireForDistance: 0.2,
    interactionCount: 3,
    lastInteractionAt: null,
    lastPositiveAt: null,
    lastNegativeAt: null,
    ...overrides,
  };
}

const ALL_PRESSURES: Pressure[] = [
  { type: "urge_to_reply", intensity: "high", sourceEventId: "e1" },
  { type: "urge_to_message", intensity: "moderate", sourceEventId: "e2" },
  { type: "urge_to_defend_self", intensity: "overwhelming", sourceEventId: "e3" },
  { type: "urge_to_create_private_channel", intensity: "low", sourceEventId: "e4" },
];

const ALL_INHIBITIONS: Inhibition[] = [
  { type: "fear_of_looking_needy", strength: 0.6, reason: "test" },
  { type: "fear_of_escalating", strength: 0.8, reason: "test" },
  { type: "social_anxiety_block", strength: 0.5, reason: "test" },
];

// ── translateEmotionalState output tests ───────────────────────────────────────

describe("translateEmotionalState contains no decimal numbers", () => {
  const mood = makeMood();
  const social = makeSocial();
  const relational = new Map([
    ["caio", makeRelational("caio")],
    ["bruno", makeRelational("bruno", { resentment: 0.8, suspicion: 0.7 })],
  ]);

  const result = translateEmotionalState(mood, social, relational, ALL_PRESSURES, ALL_INHIBITIONS);

  it("moodDescription has no decimal numbers", () => {
    assertNoDecimals(result.moodDescription, "moodDescription");
  });

  it("socialContext has no decimal numbers", () => {
    assertNoDecimals(result.socialContext, "socialContext");
  });

  it("each pressureDescription has no decimal numbers", () => {
    for (const desc of result.pressureDescriptions) {
      assertNoDecimals(desc, `pressureDescription: "${desc}"`);
    }
  });

  it("each inhibitionDescription has no decimal numbers", () => {
    for (const desc of result.inhibitionDescriptions) {
      assertNoDecimals(desc, `inhibitionDescription: "${desc}"`);
    }
  });

  it("relationalFlavors contain no decimal values", () => {
    for (const flavor of result.relationalFlavors) {
      assertNoDecimals(flavor.description, `relationalFlavor[${flavor.targetAgentId}]`);
    }
  });

  it("all extreme mood values still produce no decimals", () => {
    const extremeMood = makeMood({ valence: -0.99, arousal: 0.01, stability: 0.05, energy: 0.95 });
    const extremeResult = translateEmotionalState(extremeMood, makeSocial(), new Map(), [], []);
    assertNoDecimals(extremeResult.moodDescription, "extreme moodDescription");
  });

  it("empty relational states produce no flavors", () => {
    const noRelResult = translateEmotionalState(mood, social, new Map(), [], []);
    expect(noRelResult.relationalFlavors).toHaveLength(0);
  });

  it("empty social produces empty socialContext string", () => {
    const zeroSocial: SocialEmotions = {
      jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
      affection: 0, resentment: 0, suspicion: 0, admiration: 0,
      contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
      desireForStatus: 0, desireForIntimacy: 0,
    };
    const noSocResult = translateEmotionalState(mood, zeroSocial, new Map(), [], []);
    expect(noSocResult.socialContext).toBe("");
  });
});

// ── perceptionPacket operator events blocked ──────────────────────────────────

describe("perceptionPacket does not contain operator-internal events", () => {
  function makeBasicSnapshot(eventOverrides: Partial<CommittedEvent>[] = []): EngineSnapshot {
    const rng = createSeededRng(999);
    return {
      pulseIndex: 1,
      simulation: {
        id: "sim1",
        name: "Test",
        status: "running",
        agentIds: ["a1", "a2"],
        channelIds: ["ch1"],
        settings: {
          omniscientSpectatorMode: false,
          allowPrivateChannels: true,
          maxPrivateChannelsPerAgent: 3,
          maxMessagesPerMinutePerAgent: 10,
          llmCallBudgetPerMinute: 20,
          pulseIntervalMs: 3000,
          tokenBudgetPerHour: 200000,
        },
        seed: 42,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
      committedEvents: eventOverrides.map((ov, i) => ({
        id: `e${i}`,
        simulationId: "sim1",
        channelId: "ch1",
        actorId: "a2",
        type: "message_sent" as const,
        payload: {},
        createdAt: 1700000000000 + i,
        pulseIndex: 1,
        sourceEventIds: [],
        emotionalSalience: "low" as const,
        visibility: {
          visibleToAgents: [],
          visibleToSpectators: false,
          visibleToOperators: true,
          visibilityReason: "operator_internal",
        },
        ...ov,
      })),
      agentState: {
        agentId: "a1",
        simulationId: "sim1",
        personaId: "caio",
        presence: "active",
        coreMood: {
          valence: 0.1, arousal: 0.4, stability: 0.6, energy: 0.6,
          circumplexAngle: 0.5, circumplexRadius: 0.4,
          momentumValence: 0, momentumArousal: 0,
        },
        socialEmotions: {
          jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
          affection: 0, resentment: 0, suspicion: 0, admiration: 0,
          contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
          desireForStatus: 0, desireForIntimacy: 0,
        },
        relationalStates: new Map(),
        memories: [],
        initiativeAccumulators: [],
        lastProcessedEventId: null,
        lastActionAt: null,
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      },
      persona: CAIO,
      channels: [{
        id: "ch1",
        simulationId: "sim1",
        type: "public_channel",
        name: "#general",
        createdBy: "system",
        memberAgentIds: ["a1", "a2"],
        spectatorVisible: true,
        operatorVisible: true,
        createdForMotives: [],
        status: "active",
        createdAt: 1700000000000,
        updatedAt: 1700000000000,
      }],
      channelMembership: [
        { channelId: "ch1", agentId: "a1", joinedAt: 1700000000000 },
        { channelId: "ch1", agentId: "a2", joinedAt: 1700000000000 },
      ],
      relationalStates: new Map(),
      worldSignals: {
        highArousalNearby: false,
        averageChannelArousal: 0.4,
        activeAgentCount: 2,
        timeSinceLastPublicMessage: 30,
        channelMessageRatePerMinute: 3,
        recentTopicShift: false,
      },
      rateLimitStatus: {
        agentId: "a1",
        messagesThisMinute: 0,
        privateChannelsCreated: 0,
        lastActionAt: null,
        blocked: false,
      },
      dt: 3,
      rng,
    };
  }

  it("operator_warning event does not appear in perceptionPacket visibleContextEvents", () => {
    const snap = makeBasicSnapshot([{
      type: "operator_warning",
      visibility: {
        visibleToAgents: [],
        visibleToSpectators: false,
        visibleToOperators: true,
        visibilityReason: "operator_internal",
      },
    }]);
    const result = runEngineStep(snap);
    const types = result.perceptionPacket.visibleContextEvents.map(e => e.type);
    expect(types).not.toContain("operator_warning");
  });

  it("stagnation_detected event does not appear in perceptionPacket", () => {
    const snap = makeBasicSnapshot([{
      type: "stagnation_detected",
      visibility: {
        visibleToAgents: [],
        visibleToSpectators: false,
        visibleToOperators: true,
        visibilityReason: "operator_internal",
      },
    }]);
    const result = runEngineStep(snap);
    const types = result.perceptionPacket.visibleContextEvents.map(e => e.type);
    expect(types).not.toContain("stagnation_detected");
  });

  it("private_motive_summary from other agent does not appear in perceptionPacket", () => {
    const snap = makeBasicSnapshot([{
      actorId: "a2", // different agent
      type: "private_motive_summary",
      visibility: {
        visibleToAgents: ["a2"],  // only a2 should see this
        visibleToSpectators: false,
        visibleToOperators: true,
        visibilityReason: "private_agent_data",
      },
    }]);
    const result = runEngineStep(snap);
    const types = result.perceptionPacket.visibleContextEvents.map(e => e.type);
    expect(types).not.toContain("private_motive_summary");
  });

  it("perceptionPacket only contains events visible to the current agent", () => {
    // Mix of events: one for a1, one only for a2
    const snap = makeBasicSnapshot([]);
    // Add a visible event and a non-visible event manually
    const a1visible: CommittedEvent = {
      id: "e_a1",
      simulationId: "sim1",
      channelId: "ch1",
      actorId: "a2",
      type: "message_sent",
      payload: { text: "hello" },
      createdAt: 1700000000001,
      pulseIndex: 1,
      sourceEventIds: [],
      emotionalSalience: "medium",
      visibility: {
        visibleToAgents: [],  // everyone in channel
        visibleToSpectators: true,
        visibleToOperators: true,
        visibilityReason: "public_channel",
      },
    };
    const a2only: CommittedEvent = {
      id: "e_a2only",
      simulationId: "sim1",
      channelId: "ch1",
      actorId: "a2",
      type: "message_sent",
      payload: { text: "secret" },
      createdAt: 1700000000002,
      pulseIndex: 1,
      sourceEventIds: [],
      emotionalSalience: "high",
      visibility: {
        visibleToAgents: ["a2"],  // only a2
        visibleToSpectators: false,
        visibleToOperators: true,
        visibilityReason: "dm",
      },
    };

    snap.committedEvents = [a1visible, a2only];
    const result = runEngineStep(snap);

    // visibleEvents: full filtered set for this agent
    const visibleIds = result.visibleEvents.map(e => e.id);
    expect(visibleIds).toContain("e_a1");       // a1 can see this
    expect(visibleIds).not.toContain("e_a2only"); // a1 cannot see a2-only

    // perceptionPacket.visibleContextEvents: context window (newest = triggeringEvent, excluded from context)
    // e_a2only must not appear in any perception field
    const ctxIds = result.perceptionPacket.visibleContextEvents.map(e => e.id);
    expect(ctxIds).not.toContain("e_a2only");
  });
});
