import { describe, it, expect } from "vitest";
import {
  SimulationSchema,
  SimulationSettingsSchema,
} from "../simulation/simulation.schema.js";
import {
  ChannelSchema,
  ChannelMembershipSchema,
} from "../channel/channel.schema.js";
import {
  SimulationEventSchema,
  CommittedEventSchema,
  EventTypeSchema,
} from "../event/event.schema.js";
import {
  DelusionWeightsSchema,
  GoalAcceptanceDecisionSchema,
  GoalSynthesisResultSchema,
  SynthesizerConfigSchema,
} from "../goal/goal.schema.js";
import { GoalLayerConfigSchema } from "../goal/goal-layer-config.schema.js";
import {
  ActionIntentSchema,
  MemoryWriteProposalSchema,
} from "../intent/intent.schema.js";
import {
  CoreMoodSchema,
  SocialEmotionsSchema,
  RelationalStateSchema,
  ActionEmotionsSchema,
} from "../emotion/emotion.schema.js";
import { PersonaConfigSchema } from "../agent/agent.schema.js";
import { createSeededRng } from "../utils/rng.js";
import { clamp, meanOf, dampedSpring } from "../utils/math.js";

// --- Simulation ---
describe("SimulationSchema", () => {
  const validSettings = {
    omniscientSpectatorMode: true,
    allowPrivateChannels: true,
    maxPrivateChannelsPerAgent: 3,
    maxMessagesPerMinutePerAgent: 10,
    llmCallBudgetPerMinute: 20,
    pulseIntervalMs: 3000,
    tokenBudgetPerHour: 200000,
  };

  it("validates a valid simulation", () => {
    const sim = {
      id: "sim1",
      name: "Test Sim",
      status: "running",
      agentIds: ["a1", "a2"],
      channelIds: ["c1"],
      settings: validSettings,
      seed: 12345,
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    expect(() => SimulationSchema.parse(sim)).not.toThrow();
  });

  const invalidStatusSim = {
    id: "sim1",
    name: "Test",
    status: "invalid_status",
    agentIds: [],
    channelIds: [],
    settings: validSettings,
    seed: 1,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };

  it.each([
    ["invalid status", invalidStatusSim],
    [
      "negative maxPrivateChannelsPerAgent",
      { ...invalidStatusSim, settings: { ...validSettings, maxPrivateChannelsPerAgent: -1 } },
    ],
  ] as const)("rejects %s", (name, sim) => {
    expect(() => SimulationSchema.parse(sim)).toThrow();
  });
});

// --- Channel ---
describe("ChannelSchema", () => {
  it("validates a valid channel", () => {
    const channel = {
      id: "ch1",
      simulationId: "sim1",
      type: "public_channel",
      name: "#geral",
      createdBy: "system",
      memberAgentIds: ["a1", "a2"],
      spectatorVisible: true,
      operatorVisible: true,
      createdForMotives: [],
      status: "active",
      createdAt: 1700000000000,
      updatedAt: 1700000000000,
    };
    expect(() => ChannelSchema.parse(channel)).not.toThrow();
  });

  it("rejects invalid type", () => {
    expect(() =>
      ChannelSchema.parse({ type: "unknown_type", id: "x", simulationId: "s", name: "#x", createdBy: "system", memberAgentIds: [], spectatorVisible: true, operatorVisible: true, createdForMotives: [], status: "active", createdAt: 1, updatedAt: 1 })
    ).toThrow();
  });
});

// --- Event ---
describe("CommittedEventSchema", () => {
  it("validates a valid committed event", () => {
    const event = {
      id: "ev1",
      simulationId: "sim1",
      channelId: "ch1",
      actorId: "a1",
      type: "message_sent",
      payload: { text: "hello" },
      createdAt: 1700000000000,
      pulseIndex: 5,
      sourceEventIds: [],
      emotionalSalience: "medium",
      visibility: {
        visibleToAgents: [],
        visibleToSpectators: true,
        visibleToOperators: true,
        visibilityReason: "public_channel",
      },
    };
    expect(() => CommittedEventSchema.parse(event)).not.toThrow();
  });

  it("rejects event without required id", () => {
    expect(() =>
      CommittedEventSchema.parse({
        simulationId: "s",
        channelId: "c",
        actorId: "a",
        type: "message_sent",
        payload: {},
        createdAt: 1,
        pulseIndex: 0,
        sourceEventIds: [],
        emotionalSalience: "low",
        visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "" },
      })
    ).toThrow();
  });
});

// --- Intent ---
describe("ActionIntentSchema", () => {
  const validIntent = {
    id: "i1",
    actorId: "a1",
    intentType: "send_message",
    personTargets: [],
    privateMotiveSummary: "Feeling bored, opening conversation",
    emotionDrivers: ["boredom"],
    motivationDrivers: ["curiosity"],
    memoryWrites: [],
  };

  it("validates a valid intent", () => {
    expect(() => ActionIntentSchema.parse(validIntent)).not.toThrow();
  });

  it.each([
    ["empty privateMotiveSummary", { ...validIntent, privateMotiveSummary: "" }],
    ["unsupported intentType", { ...validIntent, intentType: "hack_system" }],
  ] as const)("rejects %s", (name, intent) => {
    expect(() => ActionIntentSchema.parse(intent)).toThrow();
  });
});

// --- Emotion ---
describe("CoreMoodSchema", () => {
  it("validates valid mood", () => {
    expect(() =>
      CoreMoodSchema.parse({
        valence: 0.3,
        arousal: 0.65,
        stability: 0.5,
        energy: 0.8,
        circumplexAngle: 0.5,
        circumplexRadius: 0.7,
        momentumValence: 0.1,
        momentumArousal: -0.05,
      })
    ).not.toThrow();
  });

  const moodBase = {
    valence: 0,
    arousal: 0.5,
    stability: 0.5,
    energy: 0.5,
    circumplexAngle: 0,
    circumplexRadius: 0.5,
    momentumValence: 0,
    momentumArousal: 0,
  };

  it.each([
    ["valence out of range", { ...moodBase, valence: 1.5 }],
    ["stability below floor 0.1", { ...moodBase, stability: 0.05 }],
  ] as const)("rejects %s", (name, mood) => {
    expect(() => CoreMoodSchema.parse(mood)).toThrow();
  });
});

describe("SocialEmotionsSchema", () => {
  it("validates all 15 dimensions in range", () => {
    const emotions = {
      jealousy: 0, envy: 0.5, humiliation: 0, pride: 0.8,
      shame: 0.1, affection: 0.6, resentment: 0, suspicion: 0.3,
      admiration: 0.4, contempt: 0, neediness: 0.2, socialAnxiety: 0.1,
      fearOfExclusion: 1.0, desireForStatus: 0.7, desireForIntimacy: 0.5,
    };
    expect(() => SocialEmotionsSchema.parse(emotions)).not.toThrow();
  });

  it("rejects value above 1", () => {
    expect(() =>
      SocialEmotionsSchema.parse({
        jealousy: 1.1, envy: 0, humiliation: 0, pride: 0,
        shame: 0, affection: 0, resentment: 0, suspicion: 0,
        admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0,
        fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0,
      })
    ).toThrow();
  });
});

// --- Goal Layer ---
const validGoalProposal = {
  id: "goal-1",
  agentId: "a1",
  title: "Recover from block",
  targetState: {
    id: "ts-1",
    description: "no more blocked intents from a1 in ch1",
    observableCriteria: ["no more blocked intents from a1 in ch1"],
  },
  kind: "resolve",
  origin: "crystallized_from",
  sourceEventIds: ["ev1", "ev2"],
  createdAt: 1700000000000,
};

const committedEventFor = (type: string) => ({
  id: `ev-${type}`,
  simulationId: "sim1",
  channelId: "ch1",
  actorId: "a1",
  type,
  payload: {},
  createdAt: 1700000000000,
  pulseIndex: 5,
  sourceEventIds: [],
  emotionalSalience: "low",
  visibility: {
    visibleToAgents: [],
    visibleToSpectators: true,
    visibleToOperators: true,
    visibilityReason: "test",
  },
});

describe("EventTypeSchema — goal layer members", () => {
  const goalEventTypes = [
    "goal_proposed",
    "goal_accepted",
    "goal_declined",
    "world_verdict",
    "delusion_gap_sampled",
    "ending_offered",
  ] as const;

  it.each(goalEventTypes)("accepts %s", (type) => {
    expect(EventTypeSchema.parse(type)).toBe(type);
    expect(CommittedEventSchema.parse(committedEventFor(type)).type).toBe(type);
  });

  it("rejects an invented goal-layer type", () => {
    expect(EventTypeSchema.safeParse("goal_fabricated").success).toBe(false);
  });
});

describe("DelusionWeightsSchema", () => {
  const validWeights = {
    wSignal: 0.5,
    wSocial: 0.3,
    wIdentity: 0.2,
    revisionThreshold: 0.4,
  };

  it.each([
    ["accepts an unchanged valid weights object", validWeights, true],
    ["rejects a weight above 1", { ...validWeights, wSignal: 1.5 }, false],
  ] as const)("%s", (name, weights, valid) => {
    const result = DelusionWeightsSchema.safeParse(weights);
    expect(result.success).toBe(valid);
    if (valid && result.success) {
      expect(result.data).toEqual(validWeights);
    }
  });
});

describe("GoalLayerConfigSchema", () => {
  it.each([
    [
      "an empty object (all fields optional)",
      {},
      { enabled: undefined, synthesizer: undefined, acceptance: undefined },
    ],
    [
      "a full valid section",
      {
        enabled: true,
        reviewEveryPulses: 3,
        delusionWeightsByAgent: {
          a1: { wSignal: 0.5, wSocial: 0.3, wIdentity: 0.2, revisionThreshold: 0.4 },
        },
        ending: { offerAcceptPulses: 2 },
        synthesizer: { mode: "deterministic", intervalPulses: 5, maxCandidatesPerReview: 2 },
        acceptance: { mode: "auto" },
      },
      {
        enabled: true,
        reviewEveryPulses: 3,
        synthesizer: { mode: "deterministic", intervalPulses: 5 },
        acceptance: { mode: "auto" },
      },
    ],
    [
      "unwired-but-contract-defined modes (D-3: parse-valid, build-rejected later)",
      { synthesizer: { mode: "llm", intervalPulses: 5, maxCandidatesPerReview: 2 }, acceptance: { mode: "agent" } },
      { synthesizer: { mode: "llm" }, acceptance: { mode: "agent" } },
    ],
  ] as const)("parses %s", (name, input, expected) => {
    const parsed = GoalLayerConfigSchema.parse(input) as Record<string, unknown>;
    for (const [key, value] of Object.entries(expected)) {
      if (value === undefined) {
        expect(parsed[key]).toBeUndefined();
      } else {
        expect(parsed).toMatchObject({ [key]: value });
      }
    }
  });

  it.each([
    ["zero reviewEveryPulses", { reviewEveryPulses: 0 }, true],
    [
      "zero intervalPulses",
      { synthesizer: { mode: "deterministic", intervalPulses: 0, maxCandidatesPerReview: 3 } },
      false,
    ],
    [
      "zero maxCandidatesPerReview",
      { synthesizer: { mode: "deterministic", intervalPulses: 1, maxCandidatesPerReview: 0 } },
      false,
    ],
    [
      "a delusion weight above 1",
      {
        delusionWeightsByAgent: {
          a1: { wSignal: 0.5, wSocial: 1.2, wIdentity: 0.2, revisionThreshold: 0.4 },
        },
      },
      false,
    ],
  ] as const)("rejects %s", (name, input, expectFieldMessage) => {
    const result = GoalLayerConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (expectFieldMessage && !result.success) {
      expect(result.error.message).toMatch(/reviewEveryPulses/);
    }
  });
});

describe("SynthesizerConfigSchema", () => {
  it.each([
    ["accepts a valid deterministic config", { mode: "deterministic", intervalPulses: 1, maxCandidatesPerReview: 3 }, true],
    ["rejects intervalPulses 0", { mode: "deterministic", intervalPulses: 0, maxCandidatesPerReview: 3 }, false],
    ["rejects an unknown mode", { mode: "quantum", intervalPulses: 1, maxCandidatesPerReview: 3 }, false],
  ] as const)("%s", (name, input, valid) => {
    const result = SynthesizerConfigSchema.safeParse(input);
    expect(result.success).toBe(valid);
    if (valid && result.success) {
      expect(result.data.mode).toBe("deterministic");
    }
  });
});

describe("GoalSynthesisResultSchema", () => {
  it.each([
    [
      "accepts a valid deterministic result",
      {
        proposal: validGoalProposal,
        narrativeFraming: "no more blocked intents from a1 in ch1",
        confidence: 1,
        synthesizer: "deterministic",
      },
      true,
    ],
    [
      "rejects confidence above 1",
      { proposal: validGoalProposal, narrativeFraming: "framing", confidence: 1.5, synthesizer: "deterministic" },
      false,
    ],
  ] as const)("%s", (name, input, valid) => {
    const result = GoalSynthesisResultSchema.safeParse(input);
    expect(result.success).toBe(valid);
    if (valid && result.success) {
      expect(result.data.synthesizer).toBe("deterministic");
      expect(result.data.proposal.id).toBe("goal-1");
    }
  });
});

describe("GoalAcceptanceDecisionSchema", () => {
  it.each([
    ["accepts { decision: 'accept' } without a reason (reason optional)", { decision: "accept" }, true, undefined],
    ["accepts a decline with a reason", { decision: "decline", reason: "critic pre-filter" }, true, "critic pre-filter"],
    ["rejects an unknown decision", { decision: "maybe" }, false, undefined],
  ] as const)("%s", (name, input, ok, expectedReason) => {
    const result = GoalAcceptanceDecisionSchema.safeParse(input);
    expect(result.success).toBe(ok);
    if (ok && result.success) {
      expect(result.data.reason).toBe(expectedReason);
    }
  });
});

// --- Utils ---
describe("SeededRng", () => {
  it.each([
    ["deterministic output for the same seed", 42, 42, true],
    ["different output for different seeds", 42, 43, false],
  ] as const)("produces %s", (name, seedA, seedB, same) => {
    const rngA = createSeededRng(seedA);
    const rngB = createSeededRng(seedB);
    if (same) {
      expect(rngA.next()).toBe(rngB.next());
      expect(rngA.next()).toBe(rngB.next());
    } else {
      expect(rngA.next()).not.toBe(rngB.next());
    }
  });

  it.each([
    ["next()", 1, false],
    ["nextInt(5)", 5, true],
  ] as const)("%s returns a value in [0, max)", (name, max, isInteger) => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 50; i++) {
      const v = name === "next()" ? rng.next() : rng.nextInt(max);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(max);
      if (isInteger) {
        expect(Number.isInteger(v)).toBe(true);
      }
    }
  });
});

describe("Math utils", () => {
  it("clamp works", () => {
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp(-0.5, 0, 1)).toBe(0);
    expect(clamp(1.5, 0, 1)).toBe(1);
  });

  it("meanOf empty array returns 0", () => {
    expect(meanOf([])).toBe(0);
  });

  it("dampedSpring moves toward target", () => {
    const result = dampedSpring(0, 1, 0.5, 1);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(1);
  });
});
