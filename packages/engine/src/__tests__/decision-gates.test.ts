import { describe, it, expect } from "vitest";
import type { Pressure, Inhibition, AgentState, DecisionContext, InitiativeAccumulator, CoreMood, SocialEmotions } from "@perfectman/shared";
import { CAIO } from "@perfectman/shared";
import { resolveDecision } from "../decision/resolve-decision.js";
import { updateInitiativeAccumulators, scoreInitiativeCandidates } from "../initiative/update-initiative-accumulators.js";

const BASE_MOOD: CoreMood = { valence: 0, arousal: 0.5, stability: 0.6, energy: 0.6, circumplexAngle: 1.5, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 };
const ZERO_SOCIAL: SocialEmotions = { jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0 };

const ZERO_ACTIONS = {
  defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0, resentfulColdness: 0,
  curiousApproach: 0, anxiousOverreach: 0, pridefulPerformance: 0, vulnerableRetreat: 0,
  contemptuousDismissal: 0, strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0,
  dominanceAssertion: 0, repairImpulse: 0,
};

function agent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    agentId: "a1", simulationId: "sim1", personaId: "caio", presence: "active",
    coreMood: BASE_MOOD, socialEmotions: ZERO_SOCIAL, relationalStates: new Map(), memories: [],
    initiativeAccumulators: [], lastProcessedEventId: null, lastActionAt: null, lastRuminationPulse: null,
    arrivalPulse: null, createdAt: 1700000000000, updatedAt: 1700000000000, ...overrides,
  };
}

function pressure(type: Pressure["type"], intensity: Pressure["intensity"]): Pressure {
  return { id: `a1:${type}`, agentId: "a1", type, targetAgentIds: [], intensity, sourceEventIds: [], sourceMotivations: [], sourceEmotions: [], visibilityPreference: "public", decayRate: 0.1 };
}

function inhibition(type: Inhibition["type"], strength: Inhibition["strength"]): Inhibition {
  return { id: `a1:${type}`, agentId: "a1", type, strength, reason: "test" };
}

function ctx(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return { hasNewEvents: false, addressed: false, salientForeignEvent: false, initiativeProceed: false, pulseIndex: 6, initiativeCandidates: [], justActed: false, ...overrides };
}

describe("cooldown after acting (ADR-0015)", () => {
  it("a non-overwhelming urge right after acting cools down — delay, no LLM", () => {
    const d = resolveDecision([pressure("urge_to_message", "medium")], [], agent(), CAIO, ctx({ justActed: true, hasNewEvents: true }));
    expect(d.outcome).toBe("delay");
    expect(d.needsLLM).toBe(false);
    expect(d.noOpReason).toBe("delayed_intention");
  });

  it("being addressed lifts the cooldown; an unaddressed foreign message does not", () => {
    const addressed = resolveDecision([pressure("urge_to_message", "medium")], [], agent(), CAIO, ctx({ justActed: true, hasNewEvents: true, addressed: true }));
    expect(addressed.outcome).toBe("act");
    expect(addressed.needsLLM).toBe(true);
    const foreign = resolveDecision([pressure("urge_to_message", "medium")], [], agent(), CAIO, ctx({ justActed: true, hasNewEvents: true, salientForeignEvent: true }));
    expect(foreign.outcome).toBe("delay");
  });

  it("the initiative-driven and initiative-override act paths cool down too", () => {
    const initiative = resolveDecision([], [], agent(), CAIO, ctx({ justActed: true, initiativeProceed: true }));
    expect(initiative.outcome).toBe("delay");
    const override = resolveDecision(
      [pressure("urge_to_message", "low")],
      [inhibition("strategic_patience_hold", "medium")],
      agent(),
      CAIO,
      ctx({ justActed: true, pulseIndex: 9, initiativeCandidates: [{ source: "boredom_accumulator", score: 0.9, proceed: true, cooldownRemaining: 0 }] }),
    );
    expect(override.outcome).toBe("delay");
  });

  it("an overwhelming urge is never cooled down", () => {
    const d = resolveDecision([pressure("urge_to_provoke", "overwhelming")], [], agent(), CAIO, ctx({ justActed: true }));
    expect(d.outcome).toBe("act");
    expect(d.needsLLM).toBe(true);
  });
});

describe("low-urge floor", () => {
  it("a low-only urge with nothing addressed, nothing salient from others and no initiative is a no_op", () => {
    const d = resolveDecision([pressure("urge_to_message", "low")], [], agent(), CAIO, ctx({ hasNewEvents: true }));
    expect(d.outcome).toBe("no_op");
    expect(d.needsLLM).toBe(false);
    expect(d.noOpReason).toBe("noticed_but_ignored");
  });

  it("a low urge acts when a salient event from someone else arrived, or when addressed, or on initiative", () => {
    expect(resolveDecision([pressure("urge_to_message", "low")], [], agent(), CAIO, ctx({ salientForeignEvent: true })).outcome).toBe("act");
    expect(resolveDecision([pressure("urge_to_message", "low")], [], agent(), CAIO, ctx({ addressed: true })).outcome).toBe("act");
    expect(resolveDecision([pressure("urge_to_message", "low")], [], agent(), CAIO, ctx({ initiativeProceed: true })).outcome).toBe("act");
  });

  it("being addressed lifts a delay-favoring inhibition but never a no-op-favoring one", () => {
    const patience = resolveDecision([pressure("urge_to_message", "low")], [inhibition("strategic_patience_hold", "high")], agent(), CAIO, ctx({ addressed: true }));
    expect(patience.outcome).toBe("act");
    const rejection = resolveDecision([pressure("urge_to_message", "low")], [inhibition("fear_of_rejection", "medium")], agent(), CAIO, ctx({ addressed: true }));
    expect(rejection.outcome).toBe("no_op");
  });
});

describe("cold_start_bootstrap retirement", () => {
  it("fires before the first act and sits at 0 for the rest of the run afterwards", () => {
    let fresh: InitiativeAccumulator[] = [];
    for (let i = 0; i < 3; i++) fresh = updateInitiativeAccumulators(fresh, ZERO_ACTIONS, agent(), CAIO, i, false);
    expect(scoreInitiativeCandidates(fresh, 3, null).find(c => c.source === "cold_start_bootstrap")?.proceed).toBe(true);

    const acted = agent({ lastActionAt: 5_000 });
    let after = fresh;
    for (let i = 3; i < 23; i++) {
      after = updateInitiativeAccumulators(after, ZERO_ACTIONS, acted, CAIO, i, i === 3);
      expect(after.find(a => a.source === "cold_start_bootstrap")?.value, `pulse ${i}`).toBe(0);
    }
    expect(scoreInitiativeCandidates(after, 23, null).find(c => c.source === "cold_start_bootstrap")?.proceed).toBe(false);
  });
});
