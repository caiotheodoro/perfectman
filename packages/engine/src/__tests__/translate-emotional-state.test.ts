import { describe, it, expect } from "vitest";
import type {
  CoreMood,
  SocialEmotions,
  RelationalState,
  Pressure,
  Inhibition,
} from "@perfectman/shared";
import { translateEmotionalState } from "../prompt/translate-emotional-state.js";

// --- Helpers ---
const BASE_MOOD: CoreMood = {
  valence: 0.2, arousal: 0.5, stability: 0.6, energy: 0.6,
  circumplexAngle: 0.5, circumplexRadius: 0.5,
  momentumValence: 0.0, momentumArousal: 0.0,
};

const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0, resentment: 0, suspicion: 0, admiration: 0,
  contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
  desireForStatus: 0, desireForIntimacy: 0,
};

function makePressure(type: Pressure["type"], intensity: Pressure["intensity"]): Pressure {
  return {
    id: `p-${type}`,
    agentId: "a1",
    type,
    targetAgentIds: [],
    intensity,
    sourceEventIds: [],
    sourceMotivations: [],
    sourceEmotions: [],
    visibilityPreference: "public",
    decayRate: 0.1,
  };
}

function makeInhibition(type: Inhibition["type"]): Inhibition {
  return {
    id: `inh-${type}`,
    agentId: "a1",
    type,
    strength: "medium",
    reason: "test reason",
  };
}

function makeRelational(targetId: string, overrides?: Partial<RelationalState>): RelationalState {
  return {
    targetAgentId: targetId,
    trust: 0, affection: 0, resentment: 0, attraction: 0,
    suspicion: 0, admiration: 0, envy: 0, comfort: 0,
    threat: 0, curiosity: 0, desireForCloseness: 0, desireForDistance: 0,
    interactionCount: 0, lastInteractionAt: null,
    lastPositiveAt: null, lastNegativeAt: null,
    ...overrides,
  };
}

// Number regex — matches standalone decimals like 0.5, 1.0, -0.3
const NUMBER_RE = /\b-?\d+\.\d+\b/;

// --- Tests ---
describe("translateEmotionalState", () => {
  it("moodDescription contains no raw numbers", () => {
    const result = translateEmotionalState(BASE_MOOD, ZERO_SOCIAL, new Map(), [], []);
    expect(NUMBER_RE.test(result.moodDescription)).toBe(false);
  });

  it("socialContext contains no raw numbers", () => {
    const social: SocialEmotions = { ...ZERO_SOCIAL, fearOfExclusion: 0.8, shame: 0.7 };
    const result = translateEmotionalState(BASE_MOOD, social, new Map(), [], []);
    expect(NUMBER_RE.test(result.socialContext)).toBe(false);
  });

  it("pressureDescriptions contain no raw numbers", () => {
    const pressures = [
      makePressure("urge_to_reply", "high"),
      makePressure("urge_to_withdraw", "medium"),
    ];
    const result = translateEmotionalState(BASE_MOOD, ZERO_SOCIAL, new Map(), pressures, []);
    for (const desc of result.pressureDescriptions) {
      expect(NUMBER_RE.test(desc)).toBe(false);
    }
  });

  it("inhibitionDescriptions contain no raw numbers", () => {
    const inhibitions = [makeInhibition("fear_of_rejection"), makeInhibition("social_anxiety_block")];
    const result = translateEmotionalState(BASE_MOOD, ZERO_SOCIAL, new Map(), [], inhibitions);
    for (const desc of result.inhibitionDescriptions) {
      expect(NUMBER_RE.test(desc)).toBe(false);
    }
  });

  it("moodDescription is subjective (not 3rd person narration)", () => {
    const result = translateEmotionalState(BASE_MOOD, ZERO_SOCIAL, new Map(), [], []);
    // Should not contain "the agent" or "they feel"
    expect(/the agent/i.test(result.moodDescription)).toBe(false);
    expect(/they feel/i.test(result.moodDescription)).toBe(false);
  });

  it("low valence produces appropriate description", () => {
    const sadMood = { ...BASE_MOOD, valence: -0.7 };
    const result = translateEmotionalState(sadMood, ZERO_SOCIAL, new Map(), [], []);
    expect(result.moodDescription.toLowerCase()).toMatch(/low|down|not (okay|great)/);
  });

  it("high arousal produces description reflecting activation", () => {
    const highArousal = { ...BASE_MOOD, arousal: 0.85 };
    const result = translateEmotionalState(highArousal, ZERO_SOCIAL, new Map(), [], []);
    expect(result.moodDescription.toLowerCase()).toMatch(/activated|activated|going on|restless|hard to settle/);
  });

  it("low stability adds unsettled clause", () => {
    const unstable = { ...BASE_MOOD, stability: 0.2 };
    const result = translateEmotionalState(unstable, ZERO_SOCIAL, new Map(), [], []);
    expect(result.moodDescription.toLowerCase()).toMatch(/unsettled|hard to predict/);
  });

  it("socialContext is empty string when no social emotions salient", () => {
    const result = translateEmotionalState(BASE_MOOD, ZERO_SOCIAL, new Map(), [], []);
    expect(result.socialContext).toBe("");
  });

  it("fear of exclusion produces socialContext output", () => {
    const social = { ...ZERO_SOCIAL, fearOfExclusion: 0.8 };
    const result = translateEmotionalState(BASE_MOOD, social, new Map(), [], []);
    expect(result.socialContext.length).toBeGreaterThan(0);
  });

  it("relationalFlavors capped at 5", () => {
    const rels = new Map(
      Array.from({ length: 10 }, (_, i) => [
        `agent${i}`,
        makeRelational(`agent${i}`, { trust: 0.6, affection: 0.6 }),
      ]),
    );
    const result = translateEmotionalState(BASE_MOOD, ZERO_SOCIAL, rels, [], []);
    expect(result.relationalFlavors.length).toBeLessThanOrEqual(5);
  });

  it("relationalFlavor descriptions contain no raw numbers", () => {
    const rels = new Map([
      ["other", makeRelational("other", { trust: 0.8, affection: 0.7, resentment: 0.3 })],
    ]);
    const result = translateEmotionalState(BASE_MOOD, ZERO_SOCIAL, rels, [], []);
    for (const flavor of result.relationalFlavors) {
      expect(NUMBER_RE.test(flavor.description)).toBe(false);
    }
  });

  it("pressureDescriptions length matches pressures input", () => {
    const pressures = [
      makePressure("urge_to_message", "medium"),
      makePressure("urge_to_withdraw", "high"),
      makePressure("urge_to_repair", "low"),
    ];
    const result = translateEmotionalState(BASE_MOOD, ZERO_SOCIAL, new Map(), pressures, []);
    expect(result.pressureDescriptions).toHaveLength(3);
  });

  it("overwhelming pressure gets intensity suffix", () => {
    const pressure = makePressure("urge_to_reply", "overwhelming");
    const result = translateEmotionalState(BASE_MOOD, ZERO_SOCIAL, new Map(), [pressure], []);
    expect(result.pressureDescriptions[0]).toContain("hard to ignore");
  });

  it("inhibitionDescriptions length matches inhibitions input", () => {
    const inhibitions = [makeInhibition("conflict_avoidance"), makeInhibition("fear_of_rejection")];
    const result = translateEmotionalState(BASE_MOOD, ZERO_SOCIAL, new Map(), [], inhibitions);
    expect(result.inhibitionDescriptions).toHaveLength(2);
  });
});
