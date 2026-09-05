import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { Pressure, Inhibition, AgentState, DecisionContext, CoreMood, SocialEmotions } from "@perfectman/shared";
import { CAIO } from "@perfectman/shared";
import { resolveDecision } from "../decision/resolve-decision.js";

const BASE_MOOD: CoreMood = { valence: 0, arousal: 0.5, stability: 0.6, energy: 0.6, circumplexAngle: 1.5, circumplexRadius: 0.5, momentumValence: 0, momentumArousal: 0 };
const ZERO_SOCIAL: SocialEmotions = { jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0, affection: 0, resentment: 0, suspicion: 0, admiration: 0, contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0, desireForStatus: 0, desireForIntimacy: 0 };
const AGENT: AgentState = {
  agentId: "a1", simulationId: "sim1", personaId: "caio", presence: "active",
  coreMood: BASE_MOOD, socialEmotions: ZERO_SOCIAL, relationalStates: new Map(), memories: [],
  initiativeAccumulators: [], lastProcessedEventId: null, lastActionAt: null, lastRuminationPulse: null,
  arrivalPulse: null, createdAt: 1, updatedAt: 1,
};

const INTENSITY_RANK = { low: 1, medium: 2, high: 3, overwhelming: 4 } as const;
const STRENGTH_RANK = { low: 1, medium: 2, high: 3 } as const;
const NOOP_FAVORING = new Set(["fear_of_rejection", "social_anxiety_block", "fear_of_exclusion_worsening", "vulnerability_guard"]);

// urge_to_withdraw is excluded: overwhelming-and-alone it is the memory_only
// branch, a different contract from the act gates under test.
const PRESSURE_TYPES = ["urge_to_reply", "urge_to_message", "urge_to_defend_self", "urge_to_mock", "urge_to_react", "urge_to_show_off", "urge_to_dominate", "urge_to_provoke", "urge_to_create_private_channel"] as const;
const INHIBITION_TYPES = ["fear_of_looking_needy", "fear_of_escalating", "fear_of_rejection", "fear_of_exclusion_worsening", "shame_about_desire", "social_anxiety_block", "status_protection", "conflict_avoidance", "vulnerability_guard", "contempt_concealment", "strategic_patience_hold", "intimacy_fear", "performance_anxiety", "repair_doubt"] as const;

function pressures(intensities: readonly Pressure["intensity"][]) {
  return fc.array(
    fc.record({ type: fc.constantFrom(...PRESSURE_TYPES), intensity: fc.constantFrom(...intensities) }),
    { maxLength: 3 },
  ).map(list =>
    list
      .map((p): Pressure => ({ id: `a1:${p.type}`, agentId: "a1", type: p.type, targetAgentIds: [], intensity: p.intensity, sourceEventIds: [], sourceMotivations: [], sourceEmotions: [], visibilityPreference: "public", decayRate: 0.1 }))
      .sort((a, b) => INTENSITY_RANK[b.intensity] - INTENSITY_RANK[a.intensity]),
  );
}

const inhibitions = fc.array(
  fc.record({ type: fc.constantFrom(...INHIBITION_TYPES), strength: fc.constantFrom("low", "medium", "high") }),
  { maxLength: 2 },
).map(list =>
  list
    .map((i): Inhibition => ({ id: `a1:${i.type}`, agentId: "a1", type: i.type, strength: i.strength, reason: "gen" }))
    .sort((a, b) => STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength]),
);

const pulseInput = (intensities: readonly Pressure["intensity"][]) =>
  fc.record({
    pressures: pressures(intensities),
    inhibitions,
    hasNewEvents: fc.boolean(),
    salientForeignEvent: fc.boolean(),
    initiativeProceed: fc.boolean(),
    pulseIndex: fc.integer({ min: 0, max: 40 }),
  });

function ctxFor(input: { hasNewEvents: boolean; salientForeignEvent: boolean; initiativeProceed: boolean; pulseIndex: number }, extra: Partial<DecisionContext>): DecisionContext {
  return { ...input, addressed: false, initiativeCandidates: [], justActed: false, ...extra };
}

describe("resolveDecision properties", () => {
  it("P1: an unaddressed agent never acts on two consecutive pulses (no overwhelming urges)", () => {
    // The generator samples initiativeProceed independently of justActed,
    // which is stricter than production (accumulators are relieved after an
    // act): the invariant must hold even then.
    fc.assert(
      fc.property(fc.array(pulseInput(["low", "medium", "high"]), { minLength: 2, maxLength: 12 }), (pulses) => {
        let prevActed = false;
        for (const p of pulses) {
          const d = resolveDecision(p.pressures, p.inhibitions, AGENT, CAIO, ctxFor(p, { justActed: prevActed }));
          const acted = d.outcome === "act";
          expect(acted && prevActed).toBe(false);
          prevActed = acted;
        }
      }),
    );
  });

  it("P2: consecutive acts happen only on an overwhelming top urge", () => {
    fc.assert(
      fc.property(fc.array(pulseInput(["low", "medium", "high", "overwhelming"]), { minLength: 2, maxLength: 12 }), (pulses) => {
        let prevActed = false;
        for (const p of pulses) {
          const d = resolveDecision(p.pressures, p.inhibitions, AGENT, CAIO, ctxFor(p, { justActed: prevActed }));
          const acted = d.outcome === "act";
          if (acted && prevActed) expect(p.pressures[0]?.intensity).toBe("overwhelming");
          prevActed = acted;
        }
      }),
    );
  });

  it("P3: being addressed always reaches the LLM unless a no-op-favoring or high inhibition outranks the urge", () => {
    fc.assert(
      fc.property(pulseInput(["low", "medium", "high"]), fc.boolean(), (p, justActed) => {
        const d = resolveDecision(p.pressures, p.inhibitions, AGENT, CAIO, ctxFor(p, { addressed: true, justActed }));
        const top = p.pressures[0];
        const inh = p.inhibitions[0];
        const blocked =
          top !== undefined && inh !== undefined &&
          STRENGTH_RANK[inh.strength] >= INTENSITY_RANK[top.intensity] &&
          (NOOP_FAVORING.has(inh.type) || STRENGTH_RANK[inh.strength] >= 3);
        if (!blocked) {
          expect(d.outcome).toBe("act");
          expect(d.needsLLM).toBe(true);
        }
      }),
    );
  });

  it("P4: needsLLM is exactly `outcome === act`, and the function is pure", () => {
    fc.assert(
      fc.property(pulseInput(["low", "medium", "high", "overwhelming"]), fc.boolean(), fc.boolean(), (p, addressed, justActed) => {
        const ctx = ctxFor(p, { addressed, justActed });
        const a = resolveDecision(p.pressures, p.inhibitions, AGENT, CAIO, ctx);
        const b = resolveDecision(p.pressures, p.inhibitions, AGENT, CAIO, ctx);
        expect(a).toEqual(b);
        expect(a.needsLLM).toBe(a.outcome === "act");
      }),
    );
  });
});
