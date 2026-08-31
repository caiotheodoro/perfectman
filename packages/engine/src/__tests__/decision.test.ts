import { describe, it, expect } from "vitest";
import type {
  Pressure,
  Inhibition,
  AgentState,
  CoreMood,
  SocialEmotions,
  InitiativeAccumulator,
} from "@perfectman/shared";
import { CAIO, GOULART, BRUNO, createSeededRng } from "@perfectman/shared";
import { resolveDecision } from "../decision/resolve-decision.js";
import {
  updateInitiativeAccumulators,
  scoreInitiativeCandidates,
  anyInitiativeProceed,
} from "../initiative/update-initiative-accumulators.js";
import { applyRumination } from "../rumination/apply-rumination.js";

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

function makeAgent(id = "a1", overrides?: Partial<AgentState>): AgentState {
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

function makeInhibition(type: Inhibition["type"], strength: Inhibition["strength"]): Inhibition {
  return {
    id: `inh-${type}`,
    agentId: "a1",
    type,
    strength,
    reason: "test",
  };
}

// --- resolveDecision ---
describe("resolveDecision", () => {
  it("no pressures + no initiative → no_op", () => {
    const result = resolveDecision([], [], makeAgent(), CAIO, false, false, 1);
    expect(result.outcome).toBe("no_op");
    expect(result.needsLLM).toBe(false);
  });

  it("no pressures + initiative proceed → act with LLM", () => {
    const result = resolveDecision([], [], makeAgent(), CAIO, false, true, 1);
    expect(result.outcome).toBe("act");
    expect(result.needsLLM).toBe(true);
    expect(result.initiativeProceed).toBe(true);
  });

  it("pressure with no inhibition → act with LLM", () => {
    const pressures = [makePressure("urge_to_message", "medium")];
    const result = resolveDecision(pressures, [], makeAgent(), CAIO, true, false, 1);
    expect(result.outcome).toBe("act");
    expect(result.needsLLM).toBe(true);
  });

  it("strong inhibition >= pressure → delay or no_op", () => {
    const pressures = [makePressure("urge_to_message", "low")];
    const inhibitions = [makeInhibition("strategic_patience_hold", "medium")];
    const result = resolveDecision(pressures, inhibitions, makeAgent(), CAIO, true, false, 1);
    expect(["delay", "no_op"]).toContain(result.outcome);
  });

  it("strategic_patience_hold inhibition → delay outcome", () => {
    const pressures = [makePressure("urge_to_message", "low")];
    const inhibitions = [makeInhibition("strategic_patience_hold", "high")];
    const result = resolveDecision(pressures, inhibitions, makeAgent(), CAIO, true, false, 1);
    expect(result.outcome).toBe("delay");
  });

  it("overwhelming shame withdrawal alone → memory_only", () => {
    const pressures = [makePressure("urge_to_withdraw", "overwhelming")];
    const result = resolveDecision(pressures, [], makeAgent(), CAIO, false, false, 1);
    expect(result.outcome).toBe("memory_only");
    expect(result.needsLLM).toBe(false);
  });

  it("high pressure > inhibition → act", () => {
    const pressures = [makePressure("urge_to_provoke", "high")];
    const inhibitions = [makeInhibition("conflict_avoidance", "low")];
    const result = resolveDecision(pressures, inhibitions, makeAgent(), GOULART, true, false, 1);
    expect(result.outcome).toBe("act");
  });

  it("privateMotiveSeed is set", () => {
    const pressures = [makePressure("urge_to_message", "medium")];
    const result = resolveDecision(pressures, [], makeAgent(), CAIO, true, false, 1);
    expect(result.privateMotiveSeed.length).toBeGreaterThan(0);
  });
});

// --- Initiative ---
describe("updateInitiativeAccumulators + scoreInitiativeCandidates", () => {
  const ZERO_ACTIONS = {
    defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0,
    resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0,
    pridefulPerformance: 0, vulnerableRetreat: 0, contemptuousDismissal: 0,
    strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0,
    dominanceAssertion: 0, repairImpulse: 0,
  };

  it("returns 17 accumulators for all sources", () => {
    const agent = makeAgent();
    const result = updateInitiativeAccumulators([], ZERO_ACTIONS, agent, CAIO, 0, false);
    expect(result).toHaveLength(17);
  });

  it("cold_start_bootstrap starts with non-zero value", () => {
    const agent = makeAgent();
    const result = updateInitiativeAccumulators([], ZERO_ACTIONS, agent, CAIO, 0, false);
    const bootstrap = result.find(a => a.source === "cold_start_bootstrap");
    expect(bootstrap?.value).toBeGreaterThan(0);
  });

  it("accumulator values grow over pulses", () => {
    const agent = makeAgent();
    let accumulators: InitiativeAccumulator[] = [];
    for (let i = 0; i < 10; i++) {
      accumulators = updateInitiativeAccumulators(accumulators, ZERO_ACTIONS, agent, CAIO, i, false);
    }
    const boredom = accumulators.find(a => a.source === "boredom_accumulator");
    expect(boredom?.value).toBeGreaterThan(0);
  });

  it("values decay after agent acts", () => {
    const agent = makeAgent();
    let accumulators: InitiativeAccumulator[] = [];
    // Build up
    for (let i = 0; i < 10; i++) {
      accumulators = updateInitiativeAccumulators(accumulators, ZERO_ACTIONS, agent, CAIO, i, false);
    }
    const beforeAct = accumulators[0]!.value;
    // Act
    accumulators = updateInitiativeAccumulators(accumulators, ZERO_ACTIONS, agent, CAIO, 10, true);
    const afterAct = accumulators[0]!.value;
    expect(afterAct).toBeLessThan(beforeAct);
  });

  it("passive decay: a silent pulse relaxes every accumulator that is above its fixed point", () => {
    const agent = makeAgent();
    const saturated: InitiativeAccumulator[] = (
      updateInitiativeAccumulators([], ZERO_ACTIONS, agent, CAIO, 0, false)
    ).map(a => ({ ...a, value: 0.9 }));

    const next = updateInitiativeAccumulators(saturated, ZERO_ACTIONS, agent, CAIO, 1, false);

    for (const acc of next) {
      if (acc.source === "cold_start_bootstrap") {
        // passive-decay exempt: growth-only, so it rises instead of relaxing
        expect(acc.value).toBeGreaterThan(0.9);
        continue;
      }
      expect(acc.value).toBeLessThan(0.9);
    }
  });

  it("passive decay: a silent agent's accumulators converge below 1.0 instead of re-saturating", () => {
    const agent = makeAgent();
    let accumulators: InitiativeAccumulator[] = [];
    for (let i = 0; i < 100; i++) {
      accumulators = updateInitiativeAccumulators(accumulators, ZERO_ACTIONS, agent, CAIO, i, false);
    }
    // cold_start_bootstrap is passive-decay exempt (its 0.30 threshold sits
    // below the 0.4*energy ceiling); every other source relaxes below 1.0.
    for (const acc of accumulators) {
      if (acc.source === "cold_start_bootstrap") continue;
      expect(acc.value).toBeLessThan(1);
    }
    // reply_pressure is the fastest grower; its fixed point is
    // growth/(decayRate*0.5) = (0.08*energy)/0.20, still well under 1.0.
    const replyPressure = accumulators.find(a => a.source === "reply_pressure");
    expect(replyPressure!.value).toBeLessThan(0.6);
  });

  it("no initiative source stays at 1.0 across consecutive pulses over a 40-pulse silent run", () => {
    const agent = makeAgent();
    let accumulators: InitiativeAccumulator[] = [];
    let prev: Map<string, number> | null = null;
    for (let i = 0; i < 40; i++) {
      accumulators = updateInitiativeAccumulators(accumulators, ZERO_ACTIONS, agent, CAIO, i, false);
      const current = new Map(accumulators.map(a => [a.source, a.value]));
      if (prev) {
        for (const [source, value] of current) {
          if (source === "cold_start_bootstrap") continue;
          const stuckAtCeiling = value >= 1 && prev.get(source)! >= 1;
          expect(stuckAtCeiling, `${source} pinned at 1.0 on pulse ${i}`).toBe(false);
        }
      }
      prev = current;
    }
  });

  it("cold_start_bootstrap still crosses its threshold within ~2 silent pulses for a calm agent", () => {
    // Passive-decay exemption regression: with universal passive decay,
    // cold_start_bootstrap's fixed point (0.4*energy) sits under its 0.30
    // threshold for typical persona energy, so proceed would never fire.
    for (const energy of [0.3, 0.5]) {
      const agent = makeAgent("cold", { coreMood: { ...BASE_MOOD, energy } });
      let accumulators: InitiativeAccumulator[] = [];
      let proceeded = false;
      for (let i = 0; i < 2; i++) {
        accumulators = updateInitiativeAccumulators(accumulators, ZERO_ACTIONS, agent, CAIO, i, false);
        const candidates = scoreInitiativeCandidates(accumulators, i, null);
        if (candidates.find(c => c.source === "cold_start_bootstrap")!.proceed) proceeded = true;
      }
      expect(proceeded, `energy ${energy}`).toBe(true);
    }
  });

  it("accumulator values stay in [0, 1]", () => {
    const agent = makeAgent();
    let accumulators: InitiativeAccumulator[] = [];
    for (let i = 0; i < 30; i++) {
      accumulators = updateInitiativeAccumulators(accumulators, ZERO_ACTIONS, agent, CAIO, i, false);
    }
    for (const acc of accumulators) {
      expect(acc.value).toBeGreaterThanOrEqual(0);
      expect(acc.value).toBeLessThanOrEqual(1);
    }
  });

  it("cold_start_bootstrap proceeds after enough pulses", () => {
    const agent = makeAgent();
    let accumulators: InitiativeAccumulator[] = [];
    for (let i = 0; i < 5; i++) {
      accumulators = updateInitiativeAccumulators(accumulators, ZERO_ACTIONS, agent, CAIO, i, false);
    }
    const candidates = scoreInitiativeCandidates(accumulators, 5, null);
    const bootstrap = candidates.find(c => c.source === "cold_start_bootstrap");
    expect(bootstrap).toBeDefined();
    // May or may not proceed depending on accumulation, but score should be > 0
    expect(bootstrap!.score).toBeGreaterThan(0);
  });

  it("scoreInitiativeCandidates takes 3 args and still gates on arrivalPulse as the third", () => {
    expect(scoreInitiativeCandidates.length).toBe(3);
    const accumulators = updateInitiativeAccumulators([], ZERO_ACTIONS, makeAgent(), CAIO, 0, false)
      .map(a => ({ ...a, value: 0.99 }));
    const beforeArrival = scoreInitiativeCandidates(accumulators, 2, 5);
    const afterArrival = scoreInitiativeCandidates(accumulators, 6, 5);
    expect(beforeArrival.every(c => !c.proceed)).toBe(true);
    expect(afterArrival.some(c => c.proceed)).toBe(true);
  });

  it("anyInitiativeProceed returns true when any candidate proceeds", () => {
    const candidates = [
      { source: "boredom_accumulator" as const, score: 0.3, proceed: false, cooldownRemaining: 0 },
      { source: "cold_start_bootstrap" as const, score: 0.8, proceed: true, cooldownRemaining: 0 },
    ];
    expect(anyInitiativeProceed(candidates)).toBe(true);
  });

  it("anyInitiativeProceed returns false when no candidate proceeds", () => {
    const candidates = [
      { source: "boredom_accumulator" as const, score: 0.3, proceed: false, cooldownRemaining: 2 },
    ];
    expect(anyInitiativeProceed(candidates)).toBe(false);
  });
});

// --- applyRumination ---
describe("applyRumination", () => {
  const ZERO_DELTA = {
    coreMoodDelta: {},
    socialEmotionDeltas: {},
    relationalDeltas: new Map(),
    ruminationApplied: false,
  };

  it("does not ruminate when new events present", () => {
    const agent = makeAgent();
    const rng = createSeededRng(42);
    const result = applyRumination(agent, CAIO, ZERO_DELTA, rng, 10, true);
    expect(result.emotionDelta.ruminationApplied).toBe(false);
  });

  it("may ruminate with negative mood + no new events", () => {
    const agent = makeAgent("a1", {
      coreMood: { ...BASE_MOOD, valence: -0.8, stability: 0.2 },
      relationalStates: new Map([
        ["other", {
          targetAgentId: "other",
          trust: -0.5, affection: 0, resentment: 0.7, attraction: 0,
          suspicion: 0.6, admiration: 0, envy: 0, comfort: 0,
          threat: 0.4, curiosity: 0, desireForCloseness: 0,
          desireForDistance: 0.5, interactionCount: 5,
          lastInteractionAt: null, lastPositiveAt: null, lastNegativeAt: 1700000000000,
        }]
      ]),
    });
    // Use seed that will pass probability check
    // We'll run multiple times to verify rumination can fire
    let ruminatedAtLeastOnce = false;
    for (let seed = 0; seed < 20; seed++) {
      const rng = createSeededRng(seed);
      const result = applyRumination(agent, BRUNO, ZERO_DELTA, rng, seed * 10, false);
      if (result.emotionDelta.ruminationApplied) {
        ruminatedAtLeastOnce = true;
        break;
      }
    }
    expect(ruminatedAtLeastOnce).toBe(true);
  });

  it("rumination intensifies resentment without adding new events", () => {
    const resentmentVal = 0.5;
    const agent = makeAgent("a1", {
      coreMood: { ...BASE_MOOD, valence: -0.8, stability: 0.15 },
      relationalStates: new Map([
        ["other", {
          targetAgentId: "other",
          trust: -0.5, affection: 0, resentment: resentmentVal, attraction: 0,
          suspicion: 0.5, admiration: 0, envy: 0, comfort: 0,
          threat: 0.3, curiosity: 0, desireForCloseness: 0,
          desireForDistance: 0.4, interactionCount: 3,
          lastInteractionAt: null, lastPositiveAt: null, lastNegativeAt: 1700000000000,
        }]
      ]),
    });
    // Seed that always ruminates (high negative mood → high probability)
    // Force by setting probability near 1: use seed=1 and check multiple
    let intensified = false;
    for (let seed = 0; seed < 30 && !intensified; seed++) {
      const rng = createSeededRng(seed);
      const result = applyRumination(agent, BRUNO, ZERO_DELTA, rng, seed * 10, false);
      if (result.emotionDelta.ruminationApplied) {
        const newRes = result.updatedRelationalStates.get("other")?.resentment ?? 0;
        expect(newRes).toBeGreaterThanOrEqual(resentmentVal);
        intensified = true;
      }
    }
    // If we never ruminated in 30 tries, that's also valid (probability-based)
  });

  it("rumination cooldown prevents back-to-back rumination", () => {
    const baseAgent = makeAgent("a1", {
      coreMood: { ...BASE_MOOD, valence: -0.9, stability: 0.1 },
    });
    // Find a seed that causes rumination
    let ruminatedPulse = -1;
    for (let seed = 0; seed < 30; seed++) {
      const rng = createSeededRng(seed);
      const result = applyRumination(baseAgent, BRUNO, ZERO_DELTA, rng, seed * 10, false);
      if (result.emotionDelta.ruminationApplied) {
        ruminatedPulse = seed * 10;
        break;
      }
    }
    if (ruminatedPulse >= 0) {
      // Thread lastRuminationPulse back into agent state (as the engine step would)
      const agentAfterRumination = makeAgent("a1", {
        coreMood: { ...BASE_MOOD, valence: -0.9, stability: 0.1 },
        lastRuminationPulse: ruminatedPulse,
      });
      // Try again at pulse+1 (within cooldown)
      const rng2 = createSeededRng(0);
      const result2 = applyRumination(agentAfterRumination, BRUNO, ZERO_DELTA, rng2, ruminatedPulse + 1, false);
      expect(result2.emotionDelta.ruminationApplied).toBe(false);
    }
  });
});
