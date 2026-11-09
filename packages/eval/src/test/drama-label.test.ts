import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { DRAMA_AXES, parseClipLabel, serializeClipLabel, type ClipLabel } from "../drama/index.js";

const allScores = (score: number | null): ClipLabel["scores"] =>
  Object.fromEntries(DRAMA_AXES.map((a) => [a, { score }])) as ClipLabel["scores"];

const label = (over: Partial<ClipLabel> = {}): ClipLabel => ({
  clipId: "run7-clip-03",
  labeler: "caio",
  labeledAt: "2026-11-08T17:12:00.000Z",
  scores: allScores(3),
  failureCodes: [],
  pass: true,
  ...over,
});

describe("parseClipLabel", () => {
  it("accepts a complete label, with notes and not-applicable scores", () => {
    const input = label({
      scores: { ...allScores(4), escalation_arc: { score: null, note: "single act, no arc" }, restraint: { score: 5 } },
      failureCodes: ["D1", "E10", "T3"],
      pass: false,
      notes: "target never flinches",
    });
    expect(parseClipLabel(input)).toEqual(input);
  });

  it("accepts the JSON text of a label", () => {
    const input = label({ failureCodes: ["D6"] });
    expect(parseClipLabel(JSON.stringify(input))).toEqual(input);
  });

  it.each([0, 6, 3.5, -1, NaN, "4"])("rejects the score %s", (bad) => {
    const input = { ...label(), scores: { ...allScores(3), restraint: { score: bad } } };
    expect(() => parseClipLabel(input)).toThrow(ZodError);
  });

  it("rejects a missing axis", () => {
    const { restraint: _drop, ...rest } = allScores(3);
    expect(() => parseClipLabel({ ...label(), scores: rest })).toThrow(ZodError);
  });

  it("rejects an axis that is not a drama axis", () => {
    expect(() => parseClipLabel({ ...label(), scores: { ...allScores(3), charisma: { score: 3 } } })).toThrow(ZodError);
  });

  it.each(["d1", "D", "D1x", "1D", "D-1", ""])("rejects the failure code %j", (bad) => {
    expect(() => parseClipLabel(label({ failureCodes: [bad] }))).toThrow(ZodError);
  });

  it("rejects a labeledAt that is not an ISO timestamp", () => {
    expect(() => parseClipLabel(label({ labeledAt: "yesterday" }))).toThrow(ZodError);
    expect(() => parseClipLabel(label({ labeledAt: "2026-11-08" }))).toThrow(ZodError);
  });

  it("rejects an empty clip id or labeler, and a non-boolean pass", () => {
    expect(() => parseClipLabel(label({ clipId: "" }))).toThrow(ZodError);
    expect(() => parseClipLabel(label({ labeler: "" }))).toThrow(ZodError);
    expect(() => parseClipLabel({ ...label(), pass: "yes" })).toThrow(ZodError);
  });

  it("rejects unknown top-level keys, so a typo is not silently dropped", () => {
    expect(() => parseClipLabel({ ...label(), notez: "oops" })).toThrow(ZodError);
  });

  it("throws a plain error for text that is not JSON", () => {
    expect(() => parseClipLabel("{nope")).toThrow(/not valid JSON/);
  });
});

describe("serializeClipLabel", () => {
  it("writes keys in a fixed order whatever order the object was built in", () => {
    const shuffled = {
      pass: true,
      notes: "n",
      failureCodes: ["D2"],
      scores: Object.fromEntries([...DRAMA_AXES].reverse().map((a) => [a, { note: "x", score: 2 }])),
      labeledAt: "2026-11-08T17:12:00.000Z",
      labeler: "caio",
      clipId: "c1",
    } as ClipLabel;
    const text = serializeClipLabel(shuffled);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(["clipId", "labeler", "labeledAt", "scores", "failureCodes", "pass", "notes"]);
    expect(Object.keys(parsed["scores"] as object)).toEqual([...DRAMA_AXES]);
    expect(Object.keys((parsed["scores"] as Record<string, object>)["restraint"]!)).toEqual(["score", "note"]);
  });

  it("is one line, omits absent notes, and round-trips", () => {
    const input = label({ scores: { ...allScores(3), escalation_arc: { score: null } } });
    const text = serializeClipLabel(input);
    expect(text).not.toContain("\n");
    expect(text).not.toContain("notes");
    expect(parseClipLabel(text)).toEqual(input);
  });

  it("refuses to serialize an invalid label", () => {
    expect(() => serializeClipLabel(label({ failureCodes: ["nope"] }))).toThrow(ZodError);
  });
});
