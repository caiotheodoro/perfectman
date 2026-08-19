import { describe, it, expect } from "vitest";
import { computeActionEmotions } from "../emotion/compute-action-emotions.js";
import { makeMood, makeSocial, makeRels } from "./fixtures.js";

interface Case {
  name: string; key: keyof ReturnType<typeof computeActionEmotions>;
  mood?: object; social?: object; rels?: object[];
}
const CASES: Case[] = [
  { name: "defensiveness from threat+suspicion+low trust", key: "defensiveness", mood: { arousal: 1 }, social: { suspicion: 1 }, rels: [{ targetAgentId: "b", threat: 1, trust: -1 }] },
  { name: "warmth from affection+comfort+positive valence+intimacy", key: "warmth", mood: { valence: 1 }, social: { affection: 1, desireForIntimacy: 1 }, rels: [{ targetAgentId: "b", affection: 1, comfort: 1 }] },
  { name: "jealousInspection from jealousy+suspicion+low trust", key: "jealousInspection", social: { jealousy: 1 }, rels: [{ targetAgentId: "b", suspicion: 1, trust: -1 }] },
  { name: "shameWithdrawal from shame+humiliation+low arousal", key: "shameWithdrawal", mood: { arousal: 0 }, social: { shame: 1, humiliation: 1 } },
  { name: "resentfulColdness from resentment+contempt", key: "resentfulColdness", social: { resentment: 1, contempt: 1 }, rels: [{ targetAgentId: "b", resentment: 1 }] },
  { name: "curiousApproach from curiosity+valence+energy", key: "curiousApproach", mood: { valence: 1, energy: 1 }, rels: [{ targetAgentId: "b", curiosity: 1 }] },
  { name: "anxiousOverreach from neediness+socialAnxiety+arousal", key: "anxiousOverreach", mood: { arousal: 1 }, social: { neediness: 1, socialAnxiety: 1 } },
  { name: "pridefulPerformance from pride+status+energy", key: "pridefulPerformance", mood: { energy: 1 }, social: { pride: 1, desireForStatus: 1 } },
  { name: "vulnerableRetreat from low stability+fear+negative valence", key: "vulnerableRetreat", mood: { stability: 0, valence: -1 }, social: { fearOfExclusion: 1 } },
  { name: "contemptuousDismissal from contempt+stability+no affection", key: "contemptuousDismissal", mood: { stability: 1 }, social: { contempt: 1 }, rels: [{ targetAgentId: "b", affection: 0 }] },
  { name: "strategicPatience from stability+low arousal+status", key: "strategicPatience", mood: { stability: 1, arousal: 0 }, social: { desireForStatus: 1 } },
  { name: "impulsiveProvocation from arousal+instability+resentment", key: "impulsiveProvocation", mood: { arousal: 1, stability: 0 }, social: { resentment: 1 } },
  { name: "comfortSeeking from neediness+closeness+negative valence", key: "comfortSeeking", mood: { valence: -1 }, social: { neediness: 1 }, rels: [{ targetAgentId: "b", desireForCloseness: 1 }] },
  { name: "dominanceAssertion from status+pride+energy+arousal", key: "dominanceAssertion", mood: { energy: 1, arousal: 1 }, social: { desireForStatus: 1, pride: 1 } },
  { name: "repairImpulse from affection+shame+resentment+valence", key: "repairImpulse", mood: { valence: 1 }, social: { shame: 1 }, rels: [{ targetAgentId: "b", affection: 1, resentment: 1 }] },
];

describe("computeActionEmotions", () => {
  describe.each(CASES)("$name", ({ key, mood, social, rels }) => {
    it(`drives ${key} near its ceiling`, () => {
      const result = computeActionEmotions(makeMood(mood), makeSocial(social), makeRels(...(rels ?? [])));
      expect(result[key]).toBeGreaterThanOrEqual(0.9);
    });
  });

  it("clamps every action emotion to [0, 1]", () => {
    const result = computeActionEmotions(makeMood({ valence: 1, arousal: 1, stability: 1, energy: 1 }), makeSocial(), makeRels());
    for (const v of Object.values(result)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("produces near-zero action emotions for a flat neutral state", () => {
    const result = computeActionEmotions(makeMood({ valence: 0, arousal: 0.5, stability: 0.5, energy: 0.5 }), makeSocial(), makeRels());
    for (const [k, v] of Object.entries(result)) {
      // No strong signal anywhere -> nothing exceeds a dominance threshold
      expect(v, k).toBeLessThan(0.6);
    }
  });
});
