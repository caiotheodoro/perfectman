import { describe, expect, it } from "vitest";
import { STATUS_DELTAS, TACTIC_VERBS } from "../taxonomy.js";
import { TAGGING_PROMPT, agreement, importTagLines, sampleIds, selectForTagging, splitHeldOut, validateTag } from "../tags.js";
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

describe("TAGGING_PROMPT", () => {
  it("gives every status_delta a line with an example, and lists every tactic verb", () => {
    for (const v of STATUS_DELTAS) expect(TAGGING_PROMPT).toMatch(new RegExp(`- ${v}: .+Example: .+`));
    for (const v of TACTIC_VERBS) expect(TAGGING_PROMPT).toContain(v);
  });
  it("forbids defaulting to a command and says when a boundary is bad", () => {
    expect(TAGGING_PROMPT).toContain('Do NOT default to "to command"');
    expect(TAGGING_PROMPT).toMatch(/Set false only for/);
    expect(TAGGING_PROMPT).toMatch(/When unsure, true/);
  });
  it("keeps the output keys the validator expects", () => {
    for (const k of ["id", "tactic_verb", "status_delta", "action_type", "emotion", "driver", "target", "confidence", "boundary_ok"]) expect(TAGGING_PROMPT).toContain(`"${k}"`);
  });
});

describe("selectForTagging and splitHeldOut", () => {
  const mk = (language: string, n: number, hint: Beat["actionHint"]): Beat[] => Array.from({ length: n }, (_, i) => ({ ...beat, id: `${language}-${hint}:1.1.${i + 1}`, language, actionHint: hint }));
  const beats = [...mk("en", 2000, "DIALOGUE_ONLY"), ...mk("pt", 2000, "DIALOGUE_ONLY"), ...mk("en", 30, "KISSING"), ...mk("pt", 30, "CRYING")];
  const share = (b: Beat[], language: string) => b.filter((x) => x.language === language && x.actionHint === "DIALOGUE_ONLY").length / 2000;

  it("keeps every action-hint beat and takes the dialogue fraction per language", () => {
    const out = selectForTagging(beats, { dialogueFraction: 0.25, dialogueFractionPt: 0.5 });
    expect(out.filter((b) => b.actionHint !== "DIALOGUE_ONLY").length).toBe(60);
    expect(share(out, "en")).toBeGreaterThan(0.21);
    expect(share(out, "en")).toBeLessThan(0.29);
    expect(share(out, "pt")).toBeGreaterThan(0.46);
    expect(share(out, "pt")).toBeLessThan(0.54);
  });
  it("uses one fraction for both languages when the Portuguese one is not given, and is deterministic", () => {
    const a = selectForTagging(beats, { dialogueFraction: 0.25 });
    expect(share(a, "pt")).toBeLessThan(0.29);
    expect(selectForTagging(beats, { dialogueFraction: 0.25 }).map((b) => b.id)).toEqual(a.map((b) => b.id));
    expect(a.map((b) => b.id)).toEqual(selectForTagging(beats, { dialogueFraction: 0.25, dialogueFractionPt: 0.25 }).map((b) => b.id));
  });
  it("a higher Portuguese fraction only adds beats", () => {
    const low = new Set(selectForTagging(beats, { dialogueFraction: 0.25, dialogueFractionPt: 0.25 }).map((b) => b.id));
    const high = new Set(selectForTagging(beats, { dialogueFraction: 0.25, dialogueFractionPt: 0.5 }).map((b) => b.id));
    for (const id of low) expect(high.has(id)).toBe(true);
    expect(high.size).toBeGreaterThan(low.size);
  });
  it("holds out the same ids as the verification sample, and the two sets partition the beats", () => {
    const { main, heldOut } = splitHeldOut(beats, 0.1);
    expect(heldOut.map((b) => b.id)).toEqual(sampleIds(beats.map((b) => b.id), 0.1));
    expect(main.length + heldOut.length).toBe(beats.length);
    expect(main.some((b) => heldOut.includes(b))).toBe(false);
    expect(heldOut.length / beats.length).toBeGreaterThan(0.08);
    expect(heldOut.length / beats.length).toBeLessThan(0.12);
  });
});
