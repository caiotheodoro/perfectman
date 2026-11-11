import { describe, expect, it } from "vitest";
import {
  ACT_HIT_STOP_MS,
  ACT_INTENSITY,
  ACT_ORIGINS,
  ACT_TARGET_MODE,
  ACT_VERBS,
  LADDER_VERBS,
  PHYSICAL_VERBS,
  impactClassOf,
  ladderRung,
} from "../act-verbs.js";
import type { ActVerb } from "../act-verbs.js";

describe("act verbs (act-contract.md section 0.2)", () => {
  it("[ACT-6] lists exactly the 25 verbs (the 18 of the contract and the 7 of verb table rev 4), once each", () => {
    expect(ACT_VERBS).toHaveLength(25);
    expect(new Set(ACT_VERBS).size).toBe(25);
    expect([...ACT_ORIGINS]).toEqual(["model", "director", "scenario"]);
  });

  it("[ACT-7] [ACT-8] has 15 required-target verbs and 10 solo verbs, and the solo ones are the self-directed set", () => {
    const required = ACT_VERBS.filter((v) => ACT_TARGET_MODE[v] === "required");
    const none = ACT_VERBS.filter((v) => ACT_TARGET_MODE[v] === "none");
    expect(required).toHaveLength(15);
    expect(none.sort()).toEqual(["cry", "die", "faint", "flee", "freeze_gasp", "kneel", "recoil", "slump", "storm_off", "tableau"]);
  });

  it("[LAD-1] puts the six ladder verbs on rungs 1 to 6 and the physical beats at 3 to 6", () => {
    expect(LADDER_VERBS.map((v) => ladderRung(v))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(PHYSICAL_VERBS.map((v) => ladderRung(v))).toEqual([3, 4, 5, 6]);
    expect(ladderRung("hug")).toBeUndefined();
  });
});

describe("impact class (TBL-4)", () => {
  it("[TBL-4] splits at 0.34 and 0.67 inclusive, for a verb with no clamp", () => {
    const classOf = (i: number): string | undefined => impactClassOf("recoil", i);
    // Verbs without a class bound have no impact class at all (the field is omitted on the wire).
    expect(classOf(0.9)).toBeUndefined();
    const at = (i: number): string | undefined => impactClassOf("punch", i);
    expect([at(0.33), at(0.34), at(0.67), at(0.68)]).toEqual(["M", "M", "M", "H"]);
  });

  it("[TBL-4] clamps to the verb's [min, max]: shove 0.9 is M, slap 0.1 is M, kill is always F", () => {
    expect(impactClassOf("shove", 0.9)).toBe("M");
    expect(impactClassOf("shove", 0.1)).toBe("L");
    expect(impactClassOf("slap", 0.1)).toBe("M");
    expect(impactClassOf("slap", 0.95)).toBe("H");
    expect(impactClassOf("kill", 0.0)).toBe("F");
    expect(impactClassOf("restrain", 1)).toBe("L");
  });

  it("[TBL-4] uses the verb's default intensity when none is given", () => {
    expect(ACT_INTENSITY.slap.default).toBe(0.5);
    expect(impactClassOf("slap")).toBe("M");
    expect(impactClassOf("punch")).toBe("H");
    expect(impactClassOf("shove")).toBe("L");
  });

  it("[TBL-4] the hit-stops are 50, 100, 150 and 175 ms", () => {
    expect(ACT_HIT_STOP_MS).toEqual({ L: 50, M: 100, H: 150, F: 175 });
  });

  it("every verb has a default intensity in [0, 1]", () => {
    for (const v of ACT_VERBS as readonly ActVerb[]) {
      expect(ACT_INTENSITY[v].default).toBeGreaterThanOrEqual(0);
      expect(ACT_INTENSITY[v].default).toBeLessThanOrEqual(1);
    }
  });
});
