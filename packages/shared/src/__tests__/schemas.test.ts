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
} from "../event/event.schema.js";
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

  it("rejects invalid status", () => {
    const sim = {
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
    expect(() => SimulationSchema.parse(sim)).toThrow();
  });

  it("rejects negative maxPrivateChannelsPerAgent", () => {
    expect(() =>
      SimulationSettingsSchema.parse({
        ...validSettings,
        maxPrivateChannelsPerAgent: -1,
      })
    ).toThrow();
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
  it("validates a valid intent", () => {
    const intent = {
      id: "i1",
      actorId: "a1",
      intentType: "send_message",
      personTargets: [],
      privateMotiveSummary: "Feeling bored, opening conversation",
      emotionDrivers: ["boredom"],
      motivationDrivers: ["curiosity"],
      memoryWrites: [],
    };
    expect(() => ActionIntentSchema.parse(intent)).not.toThrow();
  });

  it("rejects empty privateMotiveSummary", () => {
    expect(() =>
      ActionIntentSchema.parse({
        id: "i1",
        actorId: "a1",
        intentType: "no_op",
        personTargets: [],
        privateMotiveSummary: "", // MUST NOT be empty
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
      })
    ).toThrow();
  });

  it("rejects unsupported intentType", () => {
    expect(() =>
      ActionIntentSchema.parse({
        id: "i1",
        actorId: "a1",
        intentType: "hack_system",
        personTargets: [],
        privateMotiveSummary: "test",
        emotionDrivers: [],
        motivationDrivers: [],
        memoryWrites: [],
      })
    ).toThrow();
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

  it("rejects valence out of range", () => {
    expect(() =>
      CoreMoodSchema.parse({
        valence: 1.5, // > 1
        arousal: 0.5,
        stability: 0.5,
        energy: 0.5,
        circumplexAngle: 0,
        circumplexRadius: 0.5,
        momentumValence: 0,
        momentumArousal: 0,
      })
    ).toThrow();
  });

  it("rejects stability below floor 0.1", () => {
    expect(() =>
      CoreMoodSchema.parse({
        valence: 0,
        arousal: 0.5,
        stability: 0.05, // < 0.1
        energy: 0.5,
        circumplexAngle: 0,
        circumplexRadius: 0.5,
        momentumValence: 0,
        momentumArousal: 0,
      })
    ).toThrow();
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

// --- Utils ---
describe("SeededRng", () => {
  it("produces deterministic output for same seed", () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(42);
    expect(rng1.next()).toBe(rng2.next());
    expect(rng1.next()).toBe(rng2.next());
  });

  it("produces different output for different seeds", () => {
    const rng1 = createSeededRng(42);
    const rng2 = createSeededRng(43);
    expect(rng1.next()).not.toBe(rng2.next());
  });

  it("next() returns value in [0, 1)", () => {
    const rng = createSeededRng(100);
    for (let i = 0; i < 50; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("nextInt() returns integer in [0, max)", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 50; i++) {
      const v = rng.nextInt(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      expect(Number.isInteger(v)).toBe(true);
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
