import { describe, it, expect } from "vitest";
import type {
  AgentState,
  PersonaConfig,
  CommittedEvent,
  WorldSignals,
  RelationalState,
  CoreMood,
  SocialEmotions,
  EventVisibility,
} from "@perfectman/shared";
import { scoreAttention } from "../attention/score-attention.js";
import { CAIO } from "@perfectman/shared";

// --- Helpers ---

function makeEvent(id: string, overrides?: Partial<CommittedEvent>): CommittedEvent {
  return {
    id,
    simulationId: "sim1",
    channelId: "ch1",
    actorId: "other1",
    type: "message_sent",
    payload: {},
    createdAt: 1700000000000,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public_channel",
    },
    ...overrides,
  };
}

const DEFAULT_MOOD: CoreMood = {
  valence: 0.2, arousal: 0.4, stability: 0.6,
  energy: 0.6, circumplexAngle: 0.2, circumplexRadius: 0.5,
  momentumValence: 0, momentumArousal: 0,
};

const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0, resentment: 0, suspicion: 0, admiration: 0,
  contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
  desireForStatus: 0, desireForIntimacy: 0,
};

function makeAgent(overrides?: Partial<AgentState>): AgentState {
  return {
    agentId: "a1",
    simulationId: "sim1",
    personaId: "caio",
    presence: "active",
    coreMood: DEFAULT_MOOD,
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

const DEFAULT_WORLD: WorldSignals = {
  highArousalNearby: false,
  averageChannelArousal: 0.3,
  activeAgentCount: 3,
  timeSinceLastPublicMessage: 30,
  channelMessageRatePerMinute: 5,
  recentTopicShift: false,
};

// --- Tests ---
describe("scoreAttention", () => {
  it("returns noticed=false for offline agent", () => {
    const agent = makeAgent({ presence: "offline" });
    const result = scoreAttention(agent, CAIO, [], DEFAULT_WORLD, new Map(), null, 3000);
    expect(result.noticed).toBe(false);
    expect(result.dueScore).toBe(0);
    expect(result.needsLLM).toBe(false);
  });

  it("includes direct_mention reason when agent is mentioned", () => {
    const agent = makeAgent();
    const event = makeEvent("e1", {
      actorId: "other1",
      payload: { mentionedAgentIds: ["a1"] },
      emotionalSalience: "medium",
    });
    const result = scoreAttention(agent, CAIO, [event], DEFAULT_WORLD, new Map(), null, 3000);
    expect(result.reasons).toContain("direct_mention");
    expect(result.dueScore).toBeGreaterThan(0);
  });

  it("includes reply_to_self reason when event is reply to agent", () => {
    const agent = makeAgent();
    const event = makeEvent("e1", {
      type: "reply_sent",
      actorId: "other1",
      payload: { replyToActorId: "a1" },
      emotionalSalience: "medium",
    });
    const result = scoreAttention(agent, CAIO, [event], DEFAULT_WORLD, new Map(), null, 3000);
    expect(result.reasons).toContain("reply_to_self");
  });

  it("needsLLM=true when dueScore >= threshold", () => {
    const agent = makeAgent();
    // Direct mention + high salience = should exceed threshold
    const event = makeEvent("e1", {
      actorId: "other1",
      payload: { mentionedAgentIds: ["a1"] },
      emotionalSalience: "high",
    });
    const result = scoreAttention(agent, CAIO, [event], DEFAULT_WORLD, new Map(), null, 3000);
    expect(result.needsLLM).toBe(true);
  });

  it("needsLLM=false for low-salience irrelevant event", () => {
    const agent = makeAgent();
    const event = makeEvent("e1", { emotionalSalience: "low" });
    const result = scoreAttention(agent, CAIO, [event], DEFAULT_WORLD, new Map(), null, 3000);
    expect(result.needsLLM).toBe(false);
  });

  it("reduces dueScore when agent has low energy", () => {
    const lowEnergyAgent = makeAgent({
      coreMood: { ...DEFAULT_MOOD, energy: 0.1 },
    });
    const highEnergyAgent = makeAgent({
      coreMood: { ...DEFAULT_MOOD, energy: 0.9 },
    });
    const event = makeEvent("e1");
    const lowResult = scoreAttention(lowEnergyAgent, CAIO, [event], DEFAULT_WORLD, new Map(), null, 3000);
    const highResult = scoreAttention(highEnergyAgent, CAIO, [event], DEFAULT_WORLD, new Map(), null, 3000);
    expect(lowResult.dueScore).toBeLessThanOrEqual(highResult.dueScore);
  });

  it("dueScore clamped to [0, 1]", () => {
    const agent = makeAgent({
      coreMood: { ...DEFAULT_MOOD, arousal: 1.0, energy: 1.0 },
    });
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent(`e${i}`, {
        payload: { mentionedAgentIds: ["a1"] },
        emotionalSalience: "critical",
      }),
    );
    const result = scoreAttention(agent, CAIO, events, DEFAULT_WORLD, new Map(), null, 3000);
    expect(result.dueScore).toBeLessThanOrEqual(1);
    expect(result.dueScore).toBeGreaterThanOrEqual(0);
  });

  it("reasons array has no duplicates", () => {
    const agent = makeAgent();
    const events = [
      makeEvent("e1", { payload: { mentionedAgentIds: ["a1"] }, emotionalSalience: "high" }),
      makeEvent("e2", { payload: { mentionedAgentIds: ["a1"] }, emotionalSalience: "high" }),
    ];
    const result = scoreAttention(agent, CAIO, events, DEFAULT_WORLD, new Map(), null, 3000);
    const unique = new Set(result.reasons);
    expect(result.reasons.length).toBe(unique.size);
  });

  it("triggeringEventId is set when event causes attention", () => {
    const agent = makeAgent();
    const event = makeEvent("trigger-ev", {
      payload: { mentionedAgentIds: ["a1"] },
    });
    const result = scoreAttention(agent, CAIO, [event], DEFAULT_WORLD, new Map(), null, 3000);
    expect(result.triggeringEventId).toBe("trigger-ev");
  });

  it("boredom_threshold added when arousal low + energy ok", () => {
    const agent = makeAgent({
      coreMood: { ...DEFAULT_MOOD, arousal: 0.15, energy: 0.5 },
    });
    const result = scoreAttention(agent, CAIO, [], DEFAULT_WORLD, new Map(), null, 3000);
    expect(result.reasons).toContain("boredom_threshold");
  });
});
