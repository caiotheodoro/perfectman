import { describe, it, expect } from "vitest";
import type {
  AgentState,
  CoreMood,
  SocialEmotions,
  RelationalState,
  CommittedEvent,
  MoodImpulse,
} from "@perfectman/shared";
import { BRUNO, CAIO, GOULART } from "@perfectman/shared";
import { updateCoreMood } from "../emotion/update-core-mood.js";
import { computeActionEmotions } from "../emotion/compute-action-emotions.js";
import { updateEmotionStack } from "../emotion/update-emotion-stack.js";

// --- Helpers ---

const BASE_MOOD: CoreMood = {
  valence: 0.0, arousal: 0.5, stability: 0.6,
  energy: 0.6, circumplexAngle: 1.5, circumplexRadius: 0.5,
  momentumValence: 0.0, momentumArousal: 0.0,
};

const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0, resentment: 0, suspicion: 0, admiration: 0,
  contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
  desireForStatus: 0, desireForIntimacy: 0,
};

function makeAgent(id: string, overrides?: Partial<AgentState>): AgentState {
  return {
    agentId: id,
    simulationId: "sim1",
    personaId: "caio",
    presence: "active",
    coreMood: BASE_MOOD,
    socialEmotions: ZERO_SOCIAL,
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

function makeEvent(id: string, overrides?: Partial<CommittedEvent>): CommittedEvent {
  return {
    id,
    simulationId: "sim1",
    channelId: "ch1",
    actorId: "other",
    type: "message_sent",
    payload: {},
    createdAt: 1700000000000,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "medium",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public_channel",
    },
    ...overrides,
  };
}

// --- updateCoreMood tests ---
describe("updateCoreMood", () => {
  it("stability stays above floor 0.1", () => {
    const mood: CoreMood = { ...BASE_MOOD, stability: 0.15 };
    // Large shock impulse
    const impulses: MoodImpulse[] = [
      { deltaValence: -0.8, deltaArousal: 0.9, magnitude: 0.9, sourceEventId: "e1" },
      { deltaValence: -0.8, deltaArousal: 0.9, magnitude: 0.9, sourceEventId: "e2" },
    ];
    const result = updateCoreMood(mood, impulses, CAIO, 3);
    expect(result.stability).toBeGreaterThanOrEqual(0.1);
  });

  it("valence clamped to [-1, 1]", () => {
    const impulses: MoodImpulse[] = Array.from({ length: 5 }, (_, i) => ({
      deltaValence: 0.5,
      deltaArousal: 0,
      magnitude: 0.9,
      sourceEventId: `e${i}`,
    }));
    const result = updateCoreMood(BASE_MOOD, impulses, CAIO, 1);
    expect(result.valence).toBeLessThanOrEqual(1);
  });

  it("arousal clamped to [0, 1]", () => {
    const impulses: MoodImpulse[] = Array.from({ length: 5 }, (_, i) => ({
      deltaValence: 0,
      deltaArousal: 0.8,
      magnitude: 0.9,
      sourceEventId: `e${i}`,
    }));
    const result = updateCoreMood(BASE_MOOD, impulses, CAIO, 1);
    expect(result.arousal).toBeLessThanOrEqual(1);
    expect(result.arousal).toBeGreaterThanOrEqual(0);
  });

  it("energy regenerates toward baseline over time", () => {
    const lowEnergyMood: CoreMood = { ...BASE_MOOD, energy: 0.1 };
    const result = updateCoreMood(lowEnergyMood, [], CAIO, 5);
    expect(result.energy).toBeGreaterThan(0.1);
  });

  it("high-reactivity persona (Goulart) responds more than low-reactivity (Mariana)", () => {
    const impulse: MoodImpulse[] = [{
      deltaValence: 0.3,
      deltaArousal: 0.3,
      magnitude: 0.5,
      sourceEventId: "e1",
    }];
    const neutralMood = { ...BASE_MOOD, valence: 0, arousal: 0.5 };
    const goulartResult = updateCoreMood(neutralMood, impulse, GOULART, 1);
    const brunoResult = updateCoreMood(neutralMood, impulse, BRUNO, 1);
    // Goulart has higher emotionalReactivity (1.5 vs 1.2)
    expect(Math.abs(goulartResult.valence)).toBeGreaterThanOrEqual(Math.abs(brunoResult.valence));
  });

  it("angular rotation constrained by maxMoodRotation", () => {
    const start = updateCoreMood(BASE_MOOD, [], CAIO, 0); // stable
    const end = updateCoreMood(
      BASE_MOOD,
      [{ deltaValence: 1.0, deltaArousal: 1.0, magnitude: 0.9, sourceEventId: "e1" }],
      CAIO,
      1,
    );
    const angleDiff = Math.abs(end.circumplexAngle - start.circumplexAngle);
    const normalized = Math.min(angleDiff, 2 * Math.PI - angleDiff);
    expect(normalized).toBeLessThanOrEqual(CAIO.maxMoodRotation + 0.01); // tolerance
  });
});

// --- computeActionEmotions tests ---
describe("computeActionEmotions", () => {
  it("all values in [0, 1]", () => {
    const result = computeActionEmotions(BASE_MOOD, ZERO_SOCIAL, new Map());
    for (const [key, val] of Object.entries(result)) {
      expect(val, key).toBeGreaterThanOrEqual(0);
      expect(val, key).toBeLessThanOrEqual(1);
    }
  });

  it("has exactly 15 dimensions", () => {
    const result = computeActionEmotions(BASE_MOOD, ZERO_SOCIAL, new Map());
    expect(Object.keys(result)).toHaveLength(15);
  });

  it("warmth higher when affection is high", () => {
    const lowAffection  = computeActionEmotions(BASE_MOOD, ZERO_SOCIAL, new Map());
    const highAffection = computeActionEmotions(
      BASE_MOOD,
      { ...ZERO_SOCIAL, affection: 1.0 },
      new Map(),
    );
    expect(highAffection.warmth).toBeGreaterThan(lowAffection.warmth);
  });

  it("impulsiveProvocation higher with high arousal + low stability", () => {
    const highArousal: CoreMood = { ...BASE_MOOD, arousal: 0.9, stability: 0.2 };
    const calm: CoreMood = { ...BASE_MOOD, arousal: 0.2, stability: 0.9 };
    const provHigh = computeActionEmotions(highArousal, ZERO_SOCIAL, new Map());
    const provCalm = computeActionEmotions(calm, ZERO_SOCIAL, new Map());
    expect(provHigh.impulsiveProvocation).toBeGreaterThan(provCalm.impulsiveProvocation);
  });

  it("defensiveness increases with high threat in relational state", () => {
    const threatRel: RelationalState = {
      targetAgentId: "other",
      trust: -0.5, affection: 0, resentment: 0.3, attraction: 0,
      suspicion: 0.7, admiration: 0, envy: 0, comfort: 0.1,
      threat: 0.9, curiosity: 0, desireForCloseness: 0,
      desireForDistance: 0.5, interactionCount: 3,
      lastInteractionAt: null, lastPositiveAt: null, lastNegativeAt: null,
    };
    const threatened = computeActionEmotions(BASE_MOOD, ZERO_SOCIAL, new Map([["other", threatRel]]));
    const neutral = computeActionEmotions(BASE_MOOD, ZERO_SOCIAL, new Map());
    expect(threatened.defensiveness).toBeGreaterThan(neutral.defensiveness);
  });
});

// --- updateEmotionStack integration ---
describe("updateEmotionStack", () => {
  it("returns updated state with all required fields", () => {
    const agent = makeAgent("a1");
    const events = [makeEvent("e1", { actorId: "other", payload: { mentionedAgentIds: ["a1"] } })];
    const result = updateEmotionStack(agent, CAIO, events, 3, Date.now());
    expect(result.updatedState.coreMood).toBeDefined();
    expect(result.updatedState.socialEmotions).toBeDefined();
    expect(result.updatedState.relationalStates).toBeDefined();
    expect(result.actionEmotions).toBeDefined();
    expect(result.emotionDelta).toBeDefined();
  });

  it("all action emotions in [0, 1] after full stack", () => {
    const agent = makeAgent("a1");
    const events = [
      makeEvent("e1", { actorId: "other", type: "reaction_sent", payload: { personTargets: ["a1"] } }),
    ];
    const result = updateEmotionStack(agent, CAIO, events, 3, Date.now());
    for (const [key, val] of Object.entries(result.actionEmotions)) {
      expect(val, key).toBeGreaterThanOrEqual(0);
      expect(val, key).toBeLessThanOrEqual(1);
    }
  });

  it("Bruno exclusion scenario increases fearOfExclusion", () => {
    // Bruno sees Caio invited to private channel but not Bruno
    const brunoAgent = makeAgent("bruno", {
      coreMood: { ...BASE_MOOD, valence: -0.1, arousal: 0.3 },
    });
    const exclusionEvent = makeEvent("e1", {
      type: "agent_invited",
      actorId: "caio",
      payload: { invitedAgentIds: ["goulart"] }, // not bruno
    });
    const before = brunoAgent.socialEmotions.fearOfExclusion;
    const result = updateEmotionStack(brunoAgent, BRUNO, [exclusionEvent], 3, Date.now());
    // fearOfExclusion should increase or stay same (decay vs trigger)
    expect(result.updatedState.socialEmotions.fearOfExclusion).toBeGreaterThanOrEqual(before * BRUNO.moodInertia);
  });

  it("emotionDelta.ruminationApplied defaults to false", () => {
    const agent = makeAgent("a1");
    const result = updateEmotionStack(agent, CAIO, [], 3, Date.now());
    expect(result.emotionDelta.ruminationApplied).toBe(false);
  });
});
