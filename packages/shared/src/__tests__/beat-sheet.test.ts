/**
 * Contract A: the beat sheet's validator and the deterministic sheet. Each invariant of the contract has a case that breaks it and one that keeps it.
 */
import { describe, expect, it } from "vitest";
import { CLIMAX_VERBS, deriveSheetDrama, mockBeatSheet, sheetActs, sheetStats, validateBeatSheet, wireFace } from "../index.js";
import type { BeatSheet, SheetBeat, SheetContext } from "../index.js";

const CAST = [
  { id: "person-1", displayName: "Heloísa" },
  { id: "person-2", displayName: "Otávio" },
  { id: "person-3", displayName: "Renato" },
];
const ctx: SheetContext = { cast: CAST, drama: "derive" };
const mock = (o: Partial<Parameters<typeof mockBeatSheet>[0]> = {}): BeatSheet => mockBeatSheet({ cast: CAST.map((c) => ({ id: c.id, name: c.displayName })), language: "pt-BR", ...o });
/** The mock as a model would write it: names, not ids, and no normalisation. */
const raw = (o: Partial<Parameters<typeof mockBeatSheet>[0]> = {}): Record<string, unknown> => JSON.parse(JSON.stringify(mock(o)));
const at = (sheet: Record<string, unknown>, id: string): Record<string, unknown> => (sheet["beats"] as Array<Record<string, unknown>>).find((b) => b["id"] === id)!;
/** The beats of a raw sheet, as a list one can push into. */
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const messages = (r: { errors: Array<{ message: string }> }): string => r.errors.map((e) => e.message).join(" | ");

describe("mockBeatSheet", () => {
  it("is deterministic and passes the validator for a cast of two, three and five", () => {
    for (const n of [2, 3, 5]) {
      const cast = Array.from({ length: n }, (_, i) => ({ id: `person-${i + 1}`, displayName: `P${i + 1}` }));
      const sheet = mockBeatSheet({ cast: cast.map((c) => ({ id: c.id, name: c.displayName })), language: "en" });
      expect(JSON.stringify(mockBeatSheet({ cast: cast.map((c) => ({ id: c.id, name: c.displayName })), language: "en" }))).toBe(JSON.stringify(sheet));
      const r = validateBeatSheet(sheet, { cast, drama: "derive" });
      expect(r.errors).toEqual([]);
      expect(r.sheet?.arc.climax_at_ms).toBeLessThanOrEqual(240_000);
    }
  });

  it("makes a valid sheet for every climax verb the contract names that the vocabulary has", () => {
    for (const verb of CLIMAX_VERBS) {
      const r = validateBeatSheet(mock({ climax: verb }), ctx);
      expect(r.errors, verb).toEqual([]);
      expect(sheetActs(r.sheet!).filter((b) => b.kind === "act" && b.climax)).toHaveLength(1);
    }
  });

  it("stats count what a scorer reads", () => {
    const s = sheetStats(mock());
    expect(s.climax_at_ms).toBe(170_000);
    expect(s.byKind["reveal"]).toBeGreaterThanOrEqual(2);
    expect(s.byPhase["climax"]).toBe(1);
  });
});

describe("validateBeatSheet: the shape", () => {
  it("reads names into agent ids and sorts the beats", () => {
    const sheet = raw();
    for (const b of sheet["beats"] as Array<Record<string, unknown>>) {
      for (const key of ["actor", "with", "from"]) if (typeof b[key] === "string") b[key] = CAST.find((c) => c.id === b[key])!.displayName;
    }
    list(sheet["beats"]).reverse();
    const r = validateBeatSheet(sheet, ctx);
    expect(r.errors).toEqual([]);
    const times = r.sheet!.beats.map((b) => b.at_ms);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(r.sheet!.beats.filter((b) => b.kind === "act").every((b) => (b as { actor: string }).actor.startsWith("person-"))).toBe(true);
  });

  it("refuses what is not a sheet, a missing arc and too many beats", () => {
    expect(validateBeatSheet("no", ctx).errors[0]?.path).toBe("beat_sheet");
    const noArc = raw();
    delete noArc["arc"];
    expect(messages(validateBeatSheet(noArc, ctx))).toMatch(/arc is an object/);
    const many = raw();
    list(many["beats"]).push(...Array.from({ length: 70 }, () => ({ ...at(many, "m1") })));
    expect(messages(validateBeatSheet(many, ctx))).toMatch(/at most 60/);
  });

  it("refuses an unknown person, an unknown verb and a target a verb must not have", () => {
    const sheet = raw();
    at(sheet, "m10")["actor"] = "Fulano";
    expect(messages(validateBeatSheet(sheet, ctx))).toMatch(/"Fulano" is not in the cast/);
    const verb = raw();
    at(verb, "m10")["verb"] = "teleport";
    expect(messages(validateBeatSheet(verb, ctx))).toMatch(/not one of the 25 verbs/);
    const noTarget = raw();
    delete at(noTarget, "m10")["with"];
    expect(messages(validateBeatSheet(noTarget, ctx))).toMatch(/needs a target/);
  });

  it("[invariant 7] refuses dialogue: a text key, and a quoted line in a gist", () => {
    const keyed = raw();
    at(keyed, "m10")["text"] = "Você mentiu pra mim, Otávio!";
    expect(messages(validateBeatSheet(keyed, ctx))).toMatch(/never writes dialogue/);
    const quoted = raw();
    at(quoted, "m10")["gist"] = 'Heloísa diz "você mentiu pra todo mundo nessa mesa" e sai';
    expect(messages(validateBeatSheet(quoted, ctx))).toMatch(/no quoted lines/);
    const note = raw();
    at(note, "m3")["gist"] = "x";
    expect(validateBeatSheet(note, ctx).errors).toEqual([]);
  });

  it("drops an unknown key with a warning and cuts a long gist", () => {
    const sheet = raw();
    at(sheet, "m10")["mood"] = "tense";
    at(sheet, "m10")["gist"] = "g".repeat(400);
    const r = validateBeatSheet(sheet, ctx);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/beat_sheet.unknown_key/);
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/beat_sheet.trimmed/);
    expect(r.sheet!.beats.find((b) => b.id === "m10")?.gist?.length).toBeLessThanOrEqual(180);
  });
});

describe("deriveSheetDrama and wireFace", () => {
  it("widens the scene's block just enough for the sheet", () => {
    const sheet = validateBeatSheet(raw({ climax: "kill" }), ctx).sheet!;
    const block = deriveSheetDrama(sheet, { max_rung: 4, may_target: [["person-2", "person-1"]], may_die: [], permadeath: false });
    expect(block.max_rung).toBe(6);
    expect(block.may_target).toContainEqual(["person-1", "person-2"]);
    expect(block.may_target).toContainEqual(["person-2", "person-1"]);
    expect(block.may_die).toEqual(["person-2"]);
    const slap = deriveSheetDrama(validateBeatSheet(raw(), ctx).sheet!, undefined);
    expect(slap).toMatchObject({ max_rung: 4, may_die: [], permadeath: false });
  });

  it("sends every face as itself, and the nearest old one only to a hotel that lacks it", () => {
    for (const face of ["fear", "disgust", "smug", "angry", "neutral"] as const) expect(wireFace(face)).toBe(face);
    expect(wireFace("fear", ["neutral", "smile", "angry", "sad", "surprised", "sleepy"])).toBe("surprised");
    expect(wireFace("disgust", ["neutral", "angry"])).toBe("angry");
    expect(wireFace("smug", ["neutral", "smile", "angry", "sad", "surprised", "sleepy"])).toBe("smile");
    expect(wireFace("fear", ["fear", "neutral"])).toBe("fear");
  });
});

describe("sheet beats are typed", () => {
  it("compiles every kind the contract lists", () => {
    const kinds: SheetBeat["kind"][] = ["act", "cut", "block", "prop", "reveal", "note", "pause", "expression", "camera"];
    const seen = new Set(mock({ climax: "kill" }).beats.map((b) => b.kind));
    for (const k of kinds) expect(seen.has(k), k).toBe(true);
  });
});
