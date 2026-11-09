import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACTION_TYPES, EMOTIONS, STATUS_DELTAS, TACTIC_VERBS, fromPlanTag, isTacticVerb, normaliseTactic } from "../taxonomy.js";

// The KB's labels must stay in step with the drafting skill's plan schema, or reference_beats stop lining up with plans.
const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.claude/skills/perfectman-cast-and-scenario-drafting/references/plan.schema.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as { $defs: { beat: { properties: Record<string, { enum?: string[]; properties?: Record<string, { enum?: string[] }> }> } } };
const beat = schema.$defs.beat.properties;

describe("taxonomy matches plan.schema.json", () => {
  it("action types are the plan's physical_action_tag values, with DIALOGUE_ONLY for NONE", () => {
    const planTags = beat["physical_action_tag"]!.enum!;
    for (const t of planTags) expect(fromPlanTag(t), t).toBeDefined();
    expect(fromPlanTag("NONE")).toBe("DIALOGUE_ONLY");
    for (const t of ACTION_TYPES) if (t !== "DIALOGUE_ONLY" && t !== "FAINTING") expect(planTags).toContain(t);
  });
  it("status deltas and emotions are identical to the plan's", () => {
    expect([...STATUS_DELTAS]).toEqual(beat["status_delta"]!.enum);
    expect([...EMOTIONS]).toEqual(beat["emotion_vector"]!.properties!["primary_emotion"]!.enum);
  });
  it("every tactic matches the plan's active_tactic_verb pattern", () => {
    for (const v of TACTIC_VERBS) expect(v).toMatch(/^to [a-z]+( [a-z]+){0,2}$/);
  });
});

describe("tactic list", () => {
  it("has no duplicates and normalises loose input", () => {
    expect(new Set(TACTIC_VERBS).size).toBe(TACTIC_VERBS.length);
    expect(TACTIC_VERBS.length).toBeGreaterThan(100);
    expect(normaliseTactic("Intimidate")).toBe("to intimidate");
    expect(normaliseTactic("  TO  plead ")).toBe("to plead");
    expect(normaliseTactic("to fly")).toBeUndefined();
    expect(isTacticVerb("to kill")).toBe(true);
  });
});
