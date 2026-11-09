import { describe, it, expect } from "vitest";
import { DRAMA_AXES, DRAMA_FAILURE_CODES, LADDER_RUNGS, rungIndex } from "../drama/index.js";

describe("drama axes", () => {
  it("lists the six axes in rubric order", () => {
    expect(DRAMA_AXES).toEqual(["physical_expressiveness", "action_legibility", "emotion_action_fit", "reaction_integrity", "escalation_arc", "restraint"]);
  });
});

describe("drama failure codes", () => {
  it("numbers D1..D7 in order with their slugs", () => {
    expect(DRAMA_FAILURE_CODES.map((c) => `${c.id} ${c.slug}`)).toEqual([
      "D1 act_without_reaction",
      "D2 unmotivated_violence",
      "D3 skipped_ladder_rung",
      "D4 dead_actor_speaks",
      "D5 illegible_act",
      "D6 act_spam",
      "D7 consent_violation",
    ]);
  });

  it("gives every code a one-line definition, and ids that fit the label code pattern", () => {
    for (const c of DRAMA_FAILURE_CODES) {
      expect(c.definition.length).toBeGreaterThan(10);
      expect(c.definition).not.toContain("\n");
      expect(c.id).toMatch(/^[A-Z]\d+$/);
      expect(c.slug).toMatch(/^[a-z]+(_[a-z]+)+$/);
    }
  });
});

describe("escalation ladder", () => {
  it("orders rungs glare to kill with the index as the rung number", () => {
    expect(LADDER_RUNGS).toEqual(["glare", "insult", "shove", "slap", "punch", "kill"]);
    expect(LADDER_RUNGS.map((r) => rungIndex(r))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("reports an unknown verb as no rung instead of guessing", () => {
    expect(rungIndex("hug")).toBe(-1);
  });
});
