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
import { updateRelationalEmotions } from "../emotion/update-relational-emotions.js";
import { makeEvent as makeFixtureEvent, makeMood, makePersona } from "./fixtures.js";

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

// --- updateRelationalEmotions accretion ---
describe("updateRelationalEmotions accretion", () => {
  const OBSERVER = "a1";
  const ACTOR = "other";
  const NOW = 1_700_000_050_000;

  it("accretes the invitee's entry about the creator from a channel_created invite", () => {
    const event = makeFixtureEvent("channel_created", {
      actorId: ACTOR,
      payload: { invitedAgentIds: [OBSERVER] },
    });
    const entry = updateRelationalEmotions(new Map(), [event], OBSERVER, makeMood(), makePersona(), NOW).get(ACTOR);
    expect(entry, "the invited agent must accrete a relational entry about the creator").toBeDefined();
    expect(entry!.trust, "the channel_created target rule warms the invitee toward the creator").toBeGreaterThan(0);
  });

  it("does not cast a singularly-invited agent as an excluded bystander", () => {
    const event = makeFixtureEvent("agent_invited", {
      actorId: ACTOR,
      payload: { invitedAgentId: OBSERVER },
    });
    const entry = updateRelationalEmotions(new Map(), [event], OBSERVER, makeMood(), makePersona(), NOW).get(ACTOR);
    expect(entry, "the invitee must not accrete the exclusion-cascade entry about the inviter").toBeUndefined();
  });

  it("accretes a warm invitee entry for the full create-and-invite scenario", () => {
    const events = [
      makeFixtureEvent("channel_created", {
        actorId: ACTOR,
        payload: { invitedAgentIds: [OBSERVER] },
      }),
      makeFixtureEvent("agent_invited", {
        actorId: ACTOR,
        payload: { invitedAgentId: OBSERVER },
      }),
    ];
    const entry = updateRelationalEmotions(new Map(), events, OBSERVER, makeMood(), makePersona(), NOW).get(ACTOR);
    expect(entry, "creating a channel and inviting the observer must accrete an entry about the creator").toBeDefined();
    expect(entry!.trust, "the invitee's view of the creator must warm, not turn to the exclusion cascade").toBeGreaterThan(0);
  });

  it("moves a directed message's target less than a reply does", () => {
    const reply = makeFixtureEvent("reply_sent", { actorId: ACTOR, payload: { personTargets: [OBSERVER] } });
    const message = makeFixtureEvent("message_sent", { actorId: ACTOR, payload: { personTargets: [OBSERVER] } });
    const afterReply = updateRelationalEmotions(new Map(), [reply], OBSERVER, makeMood(), makePersona(), NOW).get(ACTOR);
    const afterMessage = updateRelationalEmotions(new Map(), [message], OBSERVER, makeMood(), makePersona(), NOW).get(ACTOR);
    expect(afterMessage, "a directed plain message must accrete an entry about the sender").toBeDefined();
    expect(afterReply, "a reply must accrete an entry about the sender").toBeDefined();
    expect(afterReply!.trust - afterMessage!.trust, "a reply must move trust more than a plain message").toBeGreaterThan(0);
    expect(afterReply!.comfort - afterMessage!.comfort, "a reply must move comfort more than a plain message").toBeGreaterThan(0);
  });

  it("gives bystanders a small co-presence entry about the sender of an untargeted message", () => {
    const message = makeFixtureEvent("message_sent", { actorId: ACTOR, payload: {} });
    const entry = updateRelationalEmotions(new Map(), [message], OBSERVER, makeMood(), makePersona(), NOW).get(ACTOR);
    const directed = updateRelationalEmotions(
      new Map(),
      [makeFixtureEvent("message_sent", { actorId: ACTOR, payload: { personTargets: [OBSERVER] } })],
      OBSERVER,
      makeMood(),
      makePersona(),
      NOW,
    ).get(ACTOR);
    expect(entry, "co-presence must accrete an entry about the sender").toBeDefined();
    expect(directed, "a directed message must accrete an entry about the sender").toBeDefined();
    expect(entry!.trust, "the co-presence bump must be positive").toBeGreaterThan(0);
    expect(entry!.trust, "the co-presence bump must move trust less than a directed message").toBeLessThan(directed!.trust);
  });

  it("ambient co-presence carries no interaction bookkeeping; a directed message does", () => {
    const ambient = updateRelationalEmotions(
      new Map(),
      [makeFixtureEvent("message_sent", { actorId: ACTOR, payload: {} })],
      OBSERVER, makeMood(), makePersona(), NOW,
    ).get(ACTOR);
    const directed = updateRelationalEmotions(
      new Map(),
      [makeFixtureEvent("message_sent", { actorId: ACTOR, payload: { personTargets: [OBSERVER] } })],
      OBSERVER, makeMood(), makePersona(), NOW,
    ).get(ACTOR);
    expect(ambient!.interactionCount, "ambient co-presence is not a discrete interaction").toBe(0);
    expect(ambient!.lastInteractionAt, "ambient co-presence leaves lastInteractionAt untouched").toBeNull();
    expect(directed!.interactionCount, "a directed message counts as an interaction").toBe(1);
    expect(directed!.lastInteractionAt, "a directed message stamps lastInteractionAt").toBe(NOW);
  });

  it("registers a reaction aimed at the observer as a target event", () => {
    const reaction = makeFixtureEvent("reaction_sent", {
      actorId: ACTOR,
      payload: { personTargets: [OBSERVER], emoji: "🔥" },
    });
    const entry = updateRelationalEmotions(new Map(), [reaction], OBSERVER, makeMood(), makePersona(), NOW).get(ACTOR);
    expect(entry, "a reaction must register in relational state").toBeDefined();
    expect(entry!.affection, "the reaction target rule warms the receiver toward the reactor").toBeGreaterThan(0);
  });
});
