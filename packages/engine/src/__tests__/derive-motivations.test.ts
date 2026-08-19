import { describe, it, expect } from "vitest";
import { deriveMotivations } from "../motivation/derive-motivations.js";
import {
  makeMood, makeSocial, makeActionEmotions, makeRels, makeAgent, makePersona,
} from "./fixtures.js";

/** Every motivation's dominant drivers pushed high enough to cross the 0.25 threshold. */
const CASES: Array<{ type: string; mood?: object; social?: object; action?: object; rels?: object[]; persona?: object }> = [
  { type: "boredom", mood: { arousal: 0 }, persona: { boredomSensitivity: 1 } },
  { type: "curiosity", action: { curiousApproach: 1 }, rels: [{ targetAgentId: "b", curiosity: 0.5 }] },
  { type: "repair", action: { repairImpulse: 1 } },
  { type: "gossip", social: { suspicion: 1 }, action: { jealousInspection: 1 } },
  { type: "status", social: { desireForStatus: 1 }, action: { pridefulPerformance: 1 } },
  { type: "attraction", social: { desireForIntimacy: 1 }, rels: [{ targetAgentId: "b", attraction: 0.5 }] },
  { type: "comfort", action: { comfortSeeking: 1 } },
  { type: "alliance", rels: [{ targetAgentId: "b", trust: 0.5, affection: 0.6 }] },
  { type: "avoidance", rels: [{ targetAgentId: "b", desireForDistance: 1 }] },
  { type: "control", action: { dominanceAssertion: 1 } },
  { type: "testing", social: { suspicion: 1 }, action: { jealousInspection: 1 } },
  { type: "conflict", social: { resentment: 1 }, action: { impulsiveProvocation: 1 } },
  { type: "exclusion", social: { fearOfExclusion: 1 }, persona: { exclusionSensitivity: 1 } },
  { type: "liking", social: { admiration: 1 }, rels: [{ targetAgentId: "b", affection: 0.5 }] },
  { type: "vulnerability", action: { shameWithdrawal: 1, vulnerableRetreat: 1 } },
  { type: "secrecy", social: { suspicion: 1, shame: 1 }, action: { vulnerableRetreat: 1 } },
  { type: "impulse", mood: { arousal: 1, stability: 0.1 }, action: { impulsiveProvocation: 1 } },
];

describe("deriveMotivations", () => {
  describe.each(CASES)("$type", ({ type, mood, social, action, rels, persona }) => {
    it("appears when its dominant drivers are high", () => {
      const agent = makeAgent({
        coreMood: makeMood(mood),
        socialEmotions: makeSocial(social),
        relationalStates: makeRels(...(rels ?? [])),
      });
      const result = deriveMotivations(agent, makePersona(persona), makeActionEmotions(action));
      expect(result.map(m => m.type)).toContain(type);
    });
  });

  it("returns no motivations when nothing crosses the threshold", () => {
    // High arousal suppresses boredom; zero signals everywhere else.
    const agent = makeAgent({ coreMood: makeMood({ arousal: 0.9 }), socialEmotions: makeSocial(), relationalStates: new Map() });
    const quiet = makePersona({ boredomSensitivity: 0, exclusionSensitivity: 0 });
    expect(deriveMotivations(agent, quiet, makeActionEmotions())).toHaveLength(0);
  });

  it("maps score to strength (strong >= 0.65, moderate >= 0.40, weak otherwise)", () => {
    const mk = (v: number) =>
      deriveMotivations(
        makeAgent({ socialEmotions: makeSocial(), relationalStates: new Map() }),
        makePersona(),
        makeActionEmotions({ curiousApproach: v }),
      ).find(m => m.type === "curiosity");
    expect(mk(1)?.strength).toBe("strong");
    expect(mk(0.5)?.strength).toBe("moderate");
    expect(mk(0.3)?.strength).toBe("weak");
  });

  it("sorts surfaced motivations by score descending", () => {
    const agent = makeAgent({ socialEmotions: makeSocial(), relationalStates: new Map() });
    const result = deriveMotivations(
      agent,
      makePersona(),
      makeActionEmotions({ curiousApproach: 1, dominanceAssertion: 0.8, repairImpulse: 0.5 }),
    );
    const types = result.map(m => m.type);
    expect(types.indexOf("curiosity")).toBeLessThan(types.indexOf("control"));
    expect(types.indexOf("control")).toBeLessThan(types.indexOf("repair"));
  });

  it("caps target agent ids at 3", () => {
    const rels = makeRels(
      { targetAgentId: "b1", curiosity: 0.5 }, { targetAgentId: "b2", curiosity: 0.5 },
      { targetAgentId: "b3", curiosity: 0.5 }, { targetAgentId: "b4", curiosity: 0.5 },
      { targetAgentId: "b5", curiosity: 0.5 },
    );
    const curiosity = deriveMotivations(
      makeAgent({ socialEmotions: makeSocial(), relationalStates: rels }),
      makePersona(),
      makeActionEmotions({ curiousApproach: 1 }),
    ).find(m => m.type === "curiosity");
    expect(curiosity?.targetAgentIds).toHaveLength(3);
  });

  it("keeps the motivation description readable", () => {
    const agent = makeAgent({ socialEmotions: makeSocial(), relationalStates: new Map() });
    const result = deriveMotivations(agent, makePersona(), makeActionEmotions({ curiousApproach: 1 }));
    expect(result.find(m => m.type === "curiosity")?.description.length).toBeGreaterThan(10);
  });
});
