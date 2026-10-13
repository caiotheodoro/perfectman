import { describe, expect, it } from "vitest";
import { describePose, poseFrom, toPoseVector } from "../emotion-pose.js";
import { personaSignature } from "../persona-signature.js";

const CALM = { valence: 0, arousal: 0.4, energy: 1 };

describe("poseFrom", () => {
  it("rests when no emotion is strong", () => {
    expect(poseFrom(CALM, { affection: 0.1 }).kind).toBe("rest");
  });

  it("lets the strongest social emotion pick the posture", () => {
    expect(poseFrom(CALM, { resentment: 0.4 }).kind).toBe("anger");
    expect(poseFrom(CALM, { humiliation: 0.3 }).kind).toBe("shame");
    expect(poseFrom(CALM, { fearOfExclusion: 0.8 }).kind).toBe("fear");
    expect(poseFrom(CALM, { affection: 0.5 }).kind).toBe("warm");
    expect(poseFrom(CALM, { pride: 0.3 }).kind).toBe("proud");
    expect(poseFrom(CALM, { suspicion: 0.2 }).kind).toBe("suspicion");
    expect(poseFrom({ ...CALM, energy: 0.2 }, {}).kind).toBe("tired");
  });

  it("breathes faster and trembles more when aroused", () => {
    const calm = poseFrom({ ...CALM, arousal: 0.2 }, { resentment: 0.4 });
    const wired = poseFrom({ ...CALM, arousal: 0.8 }, { resentment: 0.4 });

    expect(wired.breath).toBeLessThan(calm.breath);
    expect(wired.tremor).toBeGreaterThan(calm.tremor);
  });

  it("leans toward a listener when warm and away when afraid", () => {
    expect(poseFrom(CALM, { affection: 0.5 }, { toward: 1 }).lean).toBeGreaterThan(0);
    expect(poseFrom(CALM, { fearOfExclusion: 0.8 }, { toward: 1 }).lean).toBeLessThan(0);
  });

  it("describes every posture in words", () => {
    for (const k of ["rest", "anger", "shame", "fear", "warm", "proud", "suspicion", "tired", "peek"] as const) {
      expect(describePose(k).length).toBeGreaterThan(5);
    }
  });
});

describe("toPoseVector", () => {
  it("is all numbers with fixed-length paths, so any two poses can be blended", () => {
    const a = toPoseVector(poseFrom(CALM, { resentment: 0.4 }));
    const b = toPoseVector(poseFrom(CALM, { humiliation: 0.3 }));

    expect(a.aL).toHaveLength(6);
    expect(a.m).toHaveLength(6);
    expect(a.bl).toHaveLength(4);
    expect(Object.keys(a)).toEqual(Object.keys(b));
  });

  it("shows the persona's resting habit only when the pose has no opinion of its own", () => {
    const gatekeeper = personaSignature({ archetype: "gatekeeper" });
    const rest = toPoseVector(poseFrom(CALM, {}), gatekeeper);
    const folded = toPoseVector({ ...poseFrom(CALM, {}), armL: "folded", armR: "folded" });
    const angry = toPoseVector(poseFrom(CALM, { resentment: 0.4 }), gatekeeper);
    const down = toPoseVector(poseFrom(CALM, {}));

    expect(rest.aL).toEqual(folded.aL);
    expect(angry.aL).not.toEqual(folded.aL);
    expect(down.aL).not.toEqual(rest.aL);
  });
});
