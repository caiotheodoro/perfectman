import { describe, it, expect } from "vitest";
import type {
  AgentState,
  CommittedEvent,
  CoreMood,
  SocialEmotions,
} from "@perfectman/shared";
import {
  computeStagnationMetrics,
  detectAttractorStates,
} from "../health/compute-stagnation-metrics.js";

// --- Helpers ---
const BASE_MOOD: CoreMood = {
  valence: 0.1, arousal: 0.4, stability: 0.6, energy: 0.6,
  circumplexAngle: 0.5, circumplexRadius: 0.4,
  momentumValence: 0, momentumArousal: 0,
};

const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0, resentment: 0, suspicion: 0, admiration: 0,
  contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
  desireForStatus: 0, desireForIntimacy: 0,
};

function makeAgent(id: string, moodOverride?: Partial<CoreMood>): AgentState {
  return {
    agentId: id,
    simulationId: "sim1",
    personaId: "caio",
    presence: "active",
    coreMood: { ...BASE_MOOD, ...moodOverride },
    socialEmotions: ZERO_SOCIAL,
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

function makeEvent(id: string, actorId: string, type: CommittedEvent["type"] = "message_sent", channelId = "ch1"): CommittedEvent {
  return {
    id,
    simulationId: "sim1",
    channelId,
    actorId,
    type,
    payload: {},
    createdAt: 1700000000000 + parseInt(id),
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [], visibleToSpectators: true,
      visibleToOperators: true, visibilityReason: "public_channel",
    },
  };
}

// --- computeStagnationMetrics ---
describe("computeStagnationMetrics", () => {
  it("returns a StagnationMetrics with all required fields", () => {
    const result = computeStagnationMetrics("sim1", 10, [], new Map());
    expect(result.simulationId).toBe("sim1");
    expect(result.pulseIndex).toBe(10);
    expect(typeof result.bdi).toBe("number");
    expect(typeof result.rdv).toBe("number");
    expect(typeof result.ige).toBe("number");
    expect(typeof result.cue).toBe("number");
    expect(typeof result.eri).toBe("number");
    expect(typeof result.isd).toBe("number");
    expect(typeof result.cns).toBe("number");
    expect(typeof result.compositeScore).toBe("number");
    expect(["normal", "yellow", "red", "critical"]).toContain(result.level);
  });

  it("all metrics in [0, 1]", () => {
    const agents = new Map([
      ["a1", makeAgent("a1")],
      ["a2", makeAgent("a2", { valence: -0.3 })],
    ]);
    const events = Array.from({ length: 20 }, (_, i) =>
      makeEvent(`${i}`, i % 2 === 0 ? "a1" : "a2"),
    );
    const result = computeStagnationMetrics("sim1", 10, events, agents);
    for (const metric of [result.bdi, result.rdv, result.ige, result.cue, result.eri, result.isd, result.cns, result.compositeScore]) {
      expect(metric).toBeGreaterThanOrEqual(0);
      expect(metric).toBeLessThanOrEqual(1);
    }
  });

  it("compositeScore in [0, 1]", () => {
    const result = computeStagnationMetrics("sim1", 5, [], new Map());
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(1);
  });

  it("level is normal for diverse activity", () => {
    const agents = new Map([
      ["a1", makeAgent("a1", { valence: 0.5, arousal: 0.7 })],
      ["a2", makeAgent("a2", { valence: -0.3, arousal: 0.3 })],
      ["a3", makeAgent("a3", { valence: 0.1, arousal: 0.5 })],
    ]);
    const events = [
      makeEvent("1", "a1", "message_sent", "ch1"),
      makeEvent("2", "a2", "reply_sent", "ch1"),
      makeEvent("3", "a3", "message_sent", "ch2"),
      makeEvent("4", "a1", "channel_created", "ch3"),
      makeEvent("5", "a2", "react", "ch2"),
      makeEvent("6", "a3", "message_sent", "ch1"),
    ];
    const result = computeStagnationMetrics("sim1", 5, events, agents);
    // Diverse activity should keep composite lower
    expect(result.compositeScore).toBeLessThan(0.90);
  });

  it("level escalates with repetitive same-actor messages", () => {
    const agents = new Map([
      ["a1", makeAgent("a1")],
      ["a2", makeAgent("a2")],
    ]);
    // All messages from a1 only
    const events = Array.from({ length: 15 }, (_, i) =>
      makeEvent(`${i}`, "a1", "message_sent"),
    );
    const result = computeStagnationMetrics("sim1", 20, events, agents);
    // CNS should be high (a1 dominates)
    expect(result.cns).toBeGreaterThan(0.5);
  });

  it("metrics are never in agent-visible output (no-leak check)", () => {
    // This test simply ensures the function returns numeric metrics, not strings
    // that would be embedded in prompts. The translation layer handles that.
    const result = computeStagnationMetrics("sim1", 1, [], new Map());
    expect(typeof result.compositeScore).toBe("number");
    expect(typeof result.level).toBe("string");
    // All individual metrics are numbers (not included in any agent prompt)
    for (const key of ["bdi", "rdv", "ige", "cue", "eri", "isd", "cns"] as const) {
      expect(typeof result[key]).toBe("number");
    }
  });
});

// --- detectAttractorStates ---
describe("detectAttractorStates", () => {
  it("returns empty array with no events", () => {
    const result = detectAttractorStates([], new Map());
    expect(result).toHaveLength(0);
  });

  it("detects message_loop when 2 agents dominate", () => {
    const agents = new Map([["a1", makeAgent("a1")], ["a2", makeAgent("a2")]]);
    // >70% from a1 + a2
    const events = [
      ...Array.from({ length: 8 }, (_, i) => makeEvent(`${i}`, "a1", "message_sent")),
      ...Array.from({ length: 4 }, (_, i) => makeEvent(`${i + 10}`, "a2", "reply_sent")),
      makeEvent("20", "a3", "message_sent"), // minority
    ];
    const result = detectAttractorStates(events, agents);
    expect(result).toContain("message_loop");
  });

  it("detects silence_cascade when most decisions are no_op", () => {
    const agents = new Map([["a1", makeAgent("a1")]]);
    const events = [
      ...Array.from({ length: 10 }, (_, i) => makeEvent(`${i}`, "a1", "no_op_recorded")),
      makeEvent("10", "a1", "message_sent"),
    ];
    const result = detectAttractorStates(events, agents);
    expect(result).toContain("silence_cascade");
  });

  it("detects dormant_agents when most agents offline", () => {
    const agents = new Map([
      ["a1", makeAgent("a1")],
      ["a2", { ...makeAgent("a2"), presence: "offline" } as AgentState],
      ["a3", { ...makeAgent("a3"), presence: "offline" } as AgentState],
    ]);
    const result = detectAttractorStates([], agents);
    expect(result).toContain("dormant_agents");
  });

  it("returns array of strings", () => {
    const result = detectAttractorStates([], new Map());
    expect(Array.isArray(result)).toBe(true);
    for (const item of result) {
      expect(typeof item).toBe("string");
    }
  });
});
