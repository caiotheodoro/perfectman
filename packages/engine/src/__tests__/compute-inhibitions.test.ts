import { describe, it, expect } from "vitest";
import { computeInhibitions } from "../inhibition/compute-inhibitions.js";
import {
  makeMood, makeSocial, makeActionEmotions, makeRels, makeAgent, makePersona,
} from "./fixtures.js";

/** Every inhibition's dominant drivers pushed past the 0.20 threshold. */
const CASES: Array<{ type: string; mood?: object; social?: object; action?: object; rels?: object[]; persona?: object }> = [
  { type: "fear_of_looking_needy", social: { neediness: 1 }, persona: { intimacySensitivity: 1 } },
  { type: "fear_of_escalating", social: { resentment: 1 }, persona: { conflictSensitivity: 1 } },
  { type: "fear_of_rejection", persona: { exclusionSensitivity: 1 }, rels: [{ targetAgentId: "b", trust: -1 }] },
  { type: "fear_of_exclusion_worsening", social: { fearOfExclusion: 1 }, persona: { exclusionSensitivity: 1 } },
  { type: "shame_about_desire", social: { shame: 1 }, action: { shameWithdrawal: 1 } },
  { type: "social_anxiety_block", social: { socialAnxiety: 1 }, mood: { arousal: 1 } },
  { type: "status_protection", social: { desireForStatus: 1 }, action: { strategicPatience: 1 } },
  { type: "conflict_avoidance", persona: { conflictSensitivity: 1 }, action: { impulsiveProvocation: 0 } },
  { type: "vulnerability_guard", action: { vulnerableRetreat: 1 }, rels: [{ targetAgentId: "b", trust: -1 }] },
  { type: "contempt_concealment", social: { contempt: 1 } },
  { type: "strategic_patience_hold", action: { strategicPatience: 1 } },
  { type: "intimacy_fear", social: { desireForIntimacy: 1 }, rels: [{ targetAgentId: "b", suspicion: 1 }] },
  { type: "performance_anxiety", action: { pridefulPerformance: 1 }, social: { humiliation: 1 } },
  { type: "repair_doubt", action: { repairImpulse: 1 }, rels: [{ targetAgentId: "b", trust: -1 }] },
];

describe("computeInhibitions", () => {
  describe.each(CASES)("$type", ({ type, mood, social, action, rels, persona }) => {
    it("appears when its dominant drivers are high", () => {
      const agent = makeAgent({
        coreMood: makeMood(mood),
        socialEmotions: makeSocial(social),
        relationalStates: makeRels(...(rels ?? [])),
      });
      const result = computeInhibitions(agent, makePersona(persona), makeActionEmotions(action));
      expect(result.map(i => i.type)).toContain(type);
    });
  });

  it("returns no inhibitions for a low-signal state", () => {
    const agent = makeAgent({
      coreMood: makeMood({ arousal: 0.1, stability: 0.9 }),
      socialEmotions: makeSocial({ shame: 0, socialAnxiety: 0, contempt: 0, desireForStatus: 0 }),
      relationalStates: new Map(),
    });
    const calm = makePersona({ conflictSensitivity: 0, exclusionSensitivity: 0, intimacySensitivity: 0 });
    expect(computeInhibitions(agent, calm, makeActionEmotions())).toHaveLength(0);
  });

  it("maps score to strength (high >= 0.65, medium >= 0.40, low otherwise)", () => {
    const mk = (v: number) =>
      computeInhibitions(
        makeAgent({ socialEmotions: makeSocial(), relationalStates: new Map() }),
        makePersona(),
        makeActionEmotions({ strategicPatience: v }),
      ).find(i => i.type === "strategic_patience_hold");
    expect(mk(1)?.strength).toBe("high");
    expect(mk(0.5)?.strength).toBe("medium");
    expect(mk(0.25)?.strength).toBe("low");
  });

  it("sorts surfaced inhibitions by score descending", () => {
    const result = computeInhibitions(
      makeAgent({
        socialEmotions: makeSocial({ contempt: 1, desireForStatus: 1 }),
        relationalStates: new Map(),
      }),
      makePersona(),
      makeActionEmotions({ strategicPatience: 0.5, shameWithdrawal: 1 }),
    );
    const types = result.map(i => i.type);
    // shame_about_desire = 0*0.5 + 1*0.5 = 0.5; contempt = 0.7; strategic = 0.5
    // 0.7 (contempt) sorts first; shame (0.5) before strategic (0.5) is stable.
    expect(types[0]).toBe("contempt_concealment");
  });

  it("labels every inhibition with agentId and a reason", () => {
    const result = computeInhibitions(
      makeAgent({ agentId: "a1", socialEmotions: makeSocial({ contempt: 1 }), relationalStates: new Map() }),
      makePersona(),
      makeActionEmotions(),
    );
    for (const inh of result) {
      expect(inh.agentId).toBe("a1");
      expect(inh.reason.length).toBeGreaterThan(5);
      expect(["low", "medium", "high"]).toContain(inh.strength);
    }
  });
});
