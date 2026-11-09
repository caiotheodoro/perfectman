import { describe, expect, it } from "vitest";
import { agreement, importTagLines, sampleIds, validateTag } from "../tags.js";
import type { Beat, TagRecord } from "../types.js";

const beat: Beat = {
  id: "s:1.1.1", sourceId: "s", title: "T", author: "A", language: "en", medium: "THEATRE", act: "1", scene: "1", index: 1,
  speakers: ["IAGO", "OTHELLO"], castSize: 3, text: "x", directions: [], actionHint: "DIALOGUE_ONLY", license_class: "public-domain-us",
};
const good = { id: beat.id, tactic_verb: "to manipulate", status_delta: "LOW_TO_HIGH", action_type: "DIALOGUE_ONLY", emotion: "resolve", driver: "Iago", target: "Othello", confidence: 0.8, boundary_ok: true };

describe("validateTag", () => {
  it("accepts a valid tag and resolves speaker names to the beat's spelling", () => {
    const r = validateTag(good, beat, "haiku");
    expect(r.ok && r.tag.driver).toBe("IAGO");
    expect(r.ok && r.tag.tagged_by).toBe("haiku");
  });
  it("normalises a loose tactic", () => {
    const r = validateTag({ ...good, tactic_verb: "Manipulate" }, beat, "h");
    expect(r.ok && r.tag.tactic_verb).toBe("to manipulate");
  });
  it.each([
    [{ tactic_verb: "to fly" }, "tactic_verb"],
    [{ status_delta: "UP" }, "status_delta"],
    [{ action_type: "NONE" }, "action_type"],
    [{ emotion: "happy" }, "emotion"],
    [{ driver: "Cassio" }, "driver"],
    [{ target: "Desdemona" }, "target"],
    [{ target: "iago" }, "target equals driver"],
    [{ confidence: 1.4 }, "confidence"],
    [{ boundary_ok: "yes" }, "boundary_ok"],
  ])("rejects %j", (patch, needle) => {
    const r = validateTag({ ...good, ...patch }, beat, "h");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.join(" ")).toContain(needle);
  });
});

describe("importTagLines", () => {
  it("keeps valid lines, reports bad JSON, unknown ids and invalid tags, and tolerates code fences", () => {
    const beats = new Map([[beat.id, beat]]);
    const r = importTagLines([JSON.stringify(good), "not json", JSON.stringify({ ...good, id: "nope" }), JSON.stringify({ ...good, emotion: "x" }), "", "```json", JSON.stringify(good) + "```"], beats, "h");
    expect(r.tags).toHaveLength(2);
    expect(r.errors.map((e) => e.errors[0])).toEqual(expect.arrayContaining([expect.stringContaining("not JSON"), "unknown beat id", expect.stringContaining("emotion")]));
  });
});

describe("sampleIds and agreement", () => {
  const ids = Array.from({ length: 2000 }, (_, i) => `id-${i}`);
  it("is deterministic and close to the requested fraction", () => {
    const a = sampleIds(ids, 0.1);
    expect(a).toEqual(sampleIds(ids, 0.1));
    expect(a.length).toBeGreaterThan(150);
    expect(a.length).toBeLessThan(250);
    expect(sampleIds(ids, 0.1, "other")).not.toEqual(a);
  });
  it("computes exact and group agreement", () => {
    const t = (id: string, tactic: string, action: TagRecord["action_type"]): TagRecord => ({ id, tactic_verb: tactic, status_delta: "HIGH_STABLE", action_type: action, emotion: "anger", driver: "A", target: null, confidence: 1, boundary_ok: true, tagged_by: "x" });
    const a = [t("1", "to threaten", "KILLING"), t("2", "to plead", "CRYING"), t("3", "to mock", "DIALOGUE_ONLY")];
    const b = [t("1", "to intimidate", "KILLING"), t("2", "to plead", "KISSING"), t("9", "to mock", "DIALOGUE_ONLY")];
    expect(agreement(a, b)).toEqual({ n: 2, tactic_exact: 0.5, tactic_group: 1, action_type: 0.5, status_delta: 1, emotion: 1 });
  });
});
