import { describe, it, expect } from "vitest";
import type {
  ActionIntent,
  AvailableAction,
  AgentState,
  SimulationSettings,
  CoreMood,
  SocialEmotions,
  RateLimitStatus,
} from "@perfectman/shared";
import { validateIntentPure } from "../intent/validate-intent.js";
import { checkRateLimitPure } from "../intent/rate-limit-rules.js";

// --- Helpers ---
const BASE_MOOD: CoreMood = {
  valence: 0.0, arousal: 0.5, stability: 0.6, energy: 0.6,
  circumplexAngle: 1.5, circumplexRadius: 0.5,
  momentumValence: 0.0, momentumArousal: 0.0,
};
const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0, resentment: 0, suspicion: 0, admiration: 0,
  contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
  desireForStatus: 0, desireForIntimacy: 0,
};

function makeAgent(id = "a1"): AgentState {
  return {
    agentId: id, simulationId: "sim1", personaId: "caio",
    presence: "active", coreMood: BASE_MOOD, socialEmotions: ZERO_SOCIAL,
    relationalStates: new Map(), memories: [], initiativeAccumulators: [],
    lastProcessedEventId: null, lastActionAt: null,
    createdAt: 1700000000000, updatedAt: 1700000000000,
  };
}

const DEFAULT_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 10,
  llmCallBudgetPerMinute: 20,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 200000,
};

function makeAvailableAction(overrides?: Partial<AvailableAction>): AvailableAction {
  return {
    intentType:     "send_message",
    channelTargets: ["ch1", "ch2"],
    personTargets:  ["a2", "a3"],
    blocked:        false,
    ...overrides,
  };
}

function makeIntent(overrides?: Partial<ActionIntent>): ActionIntent {
  return {
    id:                   "i1",
    actorId:              "a1",
    intentType:           "send_message",
    personTargets:        [],
    privateMotiveSummary: "Feeling curious, want to start a conversation",
    emotionDrivers:       ["curiosity"],
    motivationDrivers:    ["curiosity"],
    memoryWrites:         [],
    ...overrides,
  };
}

// --- validateIntentPure ---
describe("validateIntentPure", () => {
  it("valid intent passes", () => {
    const intent = makeIntent();
    const actions = [makeAvailableAction()];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("rejects unsupported intent type", () => {
    const intent = makeIntent({ intentType: "hack_system" as any });
    const actions = [makeAvailableAction()];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.type === "unsupported_intent_type")).toBe(true);
  });

  it("rejects empty privateMotiveSummary", () => {
    const intent = makeIntent({ privateMotiveSummary: "" });
    const actions = [makeAvailableAction()];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.type === "missing_motive_summary")).toBe(true);
  });

  it("rejects hidden channel target", () => {
    const intent = makeIntent({ channelTarget: "secret_ch" });
    const actions = [makeAvailableAction({ channelTargets: ["ch1"] })];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.type === "hidden_channel_target")).toBe(true);
  });

  it("allows valid channel target", () => {
    const intent = makeIntent({ channelTarget: "ch1" });
    const actions = [makeAvailableAction({ channelTargets: ["ch1", "ch2"] })];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(true);
  });

  it("rejects hidden person target", () => {
    const intent = makeIntent({ personTargets: ["unknown_agent"] });
    const actions = [makeAvailableAction({ personTargets: ["a2", "a3"] })];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.type === "hidden_person_target")).toBe(true);
  });

  it("allows person target in available list", () => {
    const intent = makeIntent({ personTargets: ["a2"] });
    const actions = [makeAvailableAction({ personTargets: ["a2", "a3"] })];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(true);
  });

  it("rejects negative preferredDelay", () => {
    const intent = makeIntent({ preferredDelay: -100 });
    const actions = [makeAvailableAction()];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.type === "invalid_delay")).toBe(true);
  });

  it("allows zero preferredDelay", () => {
    const intent = makeIntent({ preferredDelay: 0 });
    const actions = [makeAvailableAction()];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(true);
  });

  it("rejects visibleContent over max length", () => {
    const intent = makeIntent({ visibleContent: "x".repeat(2001) });
    const actions = [makeAvailableAction()];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.type === "schema_invalid")).toBe(true);
  });

  it("rejects blocked available action", () => {
    const intent = makeIntent();
    const actions = [makeAvailableAction({ blocked: true, blockReason: "rate_limited" })];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.type === "rate_limited")).toBe(true);
  });

  it("rejects invalid fallbackIfBlocked", () => {
    const intent = makeIntent({ fallbackIfBlocked: "invalid_type" as any });
    const actions = [makeAvailableAction()];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(false);
    expect(result.violations.some(v => v.type === "unsupported_intent_type")).toBe(true);
  });

  it("allows no_op with minimal fields", () => {
    const intent: ActionIntent = {
      id: "i1", actorId: "a1", intentType: "no_op",
      personTargets: [],
      privateMotiveSummary: "Just staying quiet",
      emotionDrivers: [], motivationDrivers: [], memoryWrites: [],
    };
    const actions = [makeAvailableAction({ intentType: "no_op", channelTargets: [], personTargets: [], blocked: false })];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.valid).toBe(true);
  });

  it("multiple violations collected", () => {
    const intent = makeIntent({
      privateMotiveSummary: "",
      channelTarget: "unknown_ch",
      preferredDelay: -1,
    });
    const actions = [makeAvailableAction({ channelTargets: ["ch1"] })];
    const result = validateIntentPure(intent, actions, makeAgent(), DEFAULT_SETTINGS);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});

// --- checkRateLimitPure ---
describe("checkRateLimitPure", () => {
  function makeRateLimit(overrides?: Partial<RateLimitStatus>): RateLimitStatus {
    return {
      agentId: "a1",
      messagesThisMinute: 0,
      privateChannelsCreated: 0,
      lastActionAt: null,
      blocked: false,
      ...overrides,
    };
  }

  it("allows send_message when under limit", () => {
    const result = checkRateLimitPure("send_message", makeRateLimit(), DEFAULT_SETTINGS);
    expect(result.allowed).toBe(true);
  });

  it("blocks when globally blocked", () => {
    const result = checkRateLimitPure("send_message", makeRateLimit({ blocked: true, blockReason: "manual" }), DEFAULT_SETTINGS);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("manual");
  });

  it("blocks send_message when at message limit", () => {
    const result = checkRateLimitPure("send_message", makeRateLimit({ messagesThisMinute: 10 }), DEFAULT_SETTINGS);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("message_rate_limit");
  });

  it("does not block no_op on message limit", () => {
    const result = checkRateLimitPure("no_op", makeRateLimit({ messagesThisMinute: 10 }), DEFAULT_SETTINGS);
    expect(result.allowed).toBe(true);
  });

  it("blocks create_channel when disabled", () => {
    const settings = { ...DEFAULT_SETTINGS, allowPrivateChannels: false };
    const result = checkRateLimitPure("create_channel", makeRateLimit(), settings);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("private_channels_disabled");
  });

  it("blocks create_channel at channel limit", () => {
    const result = checkRateLimitPure("create_channel", makeRateLimit({ privateChannelsCreated: 3 }), DEFAULT_SETTINGS);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("private_channel_limit");
  });

  it("allows write_memory regardless of rate limits", () => {
    const result = checkRateLimitPure(
      "write_memory",
      makeRateLimit({ messagesThisMinute: 10, blocked: false }),
      DEFAULT_SETTINGS,
    );
    expect(result.allowed).toBe(true);
  });

  it("allows delay_response regardless of rate limits", () => {
    const result = checkRateLimitPure(
      "delay_response",
      makeRateLimit({ messagesThisMinute: 10 }),
      DEFAULT_SETTINGS,
    );
    expect(result.allowed).toBe(true);
  });
});
