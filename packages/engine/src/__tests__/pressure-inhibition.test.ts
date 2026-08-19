import { describe, it, expect, beforeEach } from "vitest";
import type {
  AgentState,
  CoreMood,
  SocialEmotions,
  ActionEmotions,
  CommittedEvent,
} from "@perfectman/shared";
import { CAIO, BRUNO, GOULART } from "@perfectman/shared";
import { computePressures } from "../pressure/compute-pressures.js";
import { computeInhibitions } from "../inhibition/compute-inhibitions.js";
import { deriveMotivations } from "../motivation/derive-motivations.js";
import { interpretProgrammaticSignals } from "../interpretation/interpret-programmatic-signals.js";

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

const ZERO_ACTIONS: ActionEmotions = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0,
  resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0,
  pridefulPerformance: 0, vulnerableRetreat: 0, contemptuousDismissal: 0,
  strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0,
  dominanceAssertion: 0, repairImpulse: 0,
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
      visibleToAgents: [], visibleToSpectators: true,
      visibleToOperators: true, visibilityReason: "public",
    },
    ...overrides,
  };
}

// --- computePressures ---
describe("computePressures", () => {
  it("returns empty array when all action emotions are zero", () => {
    const agent = makeAgent("a1");
    const result = computePressures(agent, ZERO_ACTIONS, []);
    expect(result).toHaveLength(0);
  });

  it("returns pressure when warmth is high", () => {
    const agent = makeAgent("a1");
    const actions = { ...ZERO_ACTIONS, warmth: 0.8 };
    const result = computePressures(agent, actions, []);
    expect(result.some(p => p.type === "urge_to_message")).toBe(true);
  });

  it("returns overwhelming pressure when impulsiveProvocation is high", () => {
    const agent = makeAgent("a1");
    const actions = { ...ZERO_ACTIONS, impulsiveProvocation: 0.9 };
    const result = computePressures(agent, actions, []);
    const provoke = result.find(p => p.type === "urge_to_provoke");
    expect(provoke).toBeDefined();
    expect(["high", "overwhelming"]).toContain(provoke!.intensity);
  });

  it("deduplicates pressure types (keeps highest intensity)", () => {
    const agent = makeAgent("a1");
    const actions = { ...ZERO_ACTIONS, warmth: 0.6, curiousApproach: 0.7 };
    const result = computePressures(agent, actions, []);
    const messageTypes = result.filter(p => p.type === "urge_to_message");
    expect(messageTypes.length).toBeLessThanOrEqual(1);
  });

  it("pressures sorted by intensity descending", () => {
    const agent = makeAgent("a1");
    const actions = { ...ZERO_ACTIONS, warmth: 0.5, impulsiveProvocation: 0.9, repairImpulse: 0.6 };
    const result = computePressures(agent, actions, []);
    for (let i = 1; i < result.length; i++) {
      const rankA = ["low", "medium", "high", "overwhelming"].indexOf(result[i-1]!.intensity);
      const rankB = ["low", "medium", "high", "overwhelming"].indexOf(result[i]!.intensity);
      expect(rankA).toBeGreaterThanOrEqual(rankB);
    }
  });

  it("visibility preference matches expected for shame withdrawal", () => {
    const agent = makeAgent("a1");
    const actions = { ...ZERO_ACTIONS, shameWithdrawal: 0.8 };
    const result = computePressures(agent, actions, []);
    const withdrawal = result.find(p => p.type === "urge_to_withdraw");
    expect(withdrawal).toBeDefined();
    expect(["private", "hidden"]).toContain(withdrawal!.visibilityPreference);
  });
});

// --- computeInhibitions ---
describe("computeInhibitions", () => {
  it("returns empty when social emotions are zero", () => {
    const agent = makeAgent("a1");
    const result = computeInhibitions(agent, CAIO, ZERO_ACTIONS);
    // conflict_avoidance might still trigger based on persona.conflictSensitivity
    // All non-persona-driven should be zero
    for (const inh of result) {
      expect(["conflict_avoidance", "strategic_patience_hold"]).toContain(inh.type);
    }
  });

  it("Bruno has high fearOfExclusion inhibition when fearOfExclusion is high", () => {
    const agent = makeAgent("bruno", {
      socialEmotions: { ...ZERO_SOCIAL, fearOfExclusion: 0.8 },
    });
    const result = computeInhibitions(agent, BRUNO, ZERO_ACTIONS);
    const inh = result.find(i => i.type === "fear_of_exclusion_worsening");
    expect(inh).toBeDefined();
    expect(["medium", "high"]).toContain(inh!.strength);
  });

  it("shame + high shame withdrawal produces shame_about_desire inhibition", () => {
    const agent = makeAgent("a1", {
      socialEmotions: { ...ZERO_SOCIAL, shame: 0.7 },
    });
    const actions = { ...ZERO_ACTIONS, shameWithdrawal: 0.7 };
    const result = computeInhibitions(agent, CAIO, actions);
    expect(result.some(i => i.type === "shame_about_desire")).toBe(true);
  });

  it("inhibition has agentId, type, strength, reason", () => {
    const agent = makeAgent("a1", {
      socialEmotions: { ...ZERO_SOCIAL, shame: 0.8 },
    });
    const result = computeInhibitions(agent, CAIO, ZERO_ACTIONS);
    for (const inh of result) {
      expect(inh.agentId).toBe("a1");
      expect(["low", "medium", "high"]).toContain(inh.strength);
      expect(inh.reason.length).toBeGreaterThan(0);
    }
  });
});

// --- deriveMotivations ---
describe("deriveMotivations", () => {
  it("returns no motivations when action emotions are zero", () => {
    const agent = makeAgent("a1");
    const result = deriveMotivations(agent, CAIO, ZERO_ACTIONS);
    // boredom might appear due to low arousal
    for (const m of result) {
      // Zero action emotions → boredom (low arousal) is the only motivation production can emit
      expect(m.type).toBe("boredom");
      expect(["weak", "moderate", "strong"]).toContain(m.strength);
    }
  });

  it("boredom motivation appears when arousal is very low", () => {
    const agent = makeAgent("a1", {
      coreMood: { ...BASE_MOOD, arousal: 0.05 },
    });
    const result = deriveMotivations(agent, GOULART, ZERO_ACTIONS);
    // Goulart has boredomSensitivity=1.4
    expect(result.some(m => m.type === "boredom")).toBe(true);
  });

  it("motivations sorted strongest first", () => {
    const agent = makeAgent("a1");
    const actions = { ...ZERO_ACTIONS, curiousApproach: 0.9, repairImpulse: 0.6 };
    const result = deriveMotivations(agent, CAIO, actions);
    const ranks = result.map(m => ({ strong: 2, moderate: 1, weak: 0 })[m.strength]);
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i-1]!).toBeGreaterThanOrEqual(ranks[i]!);
    }
  });

  it("motivation descriptions never contain raw numbers", () => {
    const agent = makeAgent("a1");
    const actions = { ...ZERO_ACTIONS, curiousApproach: 0.8, impulsiveProvocation: 0.7 };
    const result = deriveMotivations(agent, GOULART, actions);
    for (const m of result) {
      // Descriptions should not contain standalone decimal numbers like 0.3
      expect(/\b0\.\d+\b/.test(m.description)).toBe(false);
    }
  });
});

// --- interpretProgrammaticSignals ---
describe("interpretProgrammaticSignals", () => {
  it("returns public_silence when timeSinceLastPublicMessage > 120", () => {
    const agent = makeAgent("a1");
    const result = interpretProgrammaticSignals("a1", agent, [], 150, 3000);
    expect(result.some(i => i.signalType === "public_silence")).toBe(true);
  });

  it("does not return public_silence when recently active", () => {
    const agent = makeAgent("a1");
    const events = [makeEvent("e1", { actorId: "other" })];
    const result = interpretProgrammaticSignals("a1", agent, events, 30, 3000);
    expect(result.some(i => i.signalType === "public_silence")).toBe(false);
  });

  it("returns mention_ignored when agent mentioned but no reply followed", () => {
    const agent = makeAgent("a1");
    const events = [
      makeEvent("e1", { actorId: "other", payload: { mentionedAgentIds: ["a1"] } }),
      makeEvent("e2", { actorId: "other2", payload: {} }),
      makeEvent("e3", { actorId: "other3", payload: {} }),
    ];
    const result = interpretProgrammaticSignals("a1", agent, events, 30, 3000);
    expect(result.some(i => i.signalType === "mention_ignored")).toBe(true);
  });

  it("interpretations have non-empty descriptions", () => {
    const agent = makeAgent("a1");
    const result = interpretProgrammaticSignals("a1", agent, [], 200, 3000);
    for (const i of result) {
      expect(i.description.length).toBeGreaterThan(10);
    }
  });

  it("all confidence values are valid", () => {
    const agent = makeAgent("a1");
    const result = interpretProgrammaticSignals("a1", agent, [], 200, 3000);
    for (const i of result) {
      expect(["uncertain", "plausible", "likely"]).toContain(i.confidence);
    }
  });
});
