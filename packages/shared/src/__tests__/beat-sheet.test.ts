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
    for (const verb of CLIMAX_VERBS.filter((v) => v !== "grab")) {
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
    (sheet["beats"] as unknown[]).reverse();
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
    (many["beats"] as unknown[]).push(...Array.from({ length: 70 }, () => ({ ...at(many, "m1") })));
    expect(messages(validateBeatSheet(many, ctx))).toMatch(/at most 60/);
  });

  it("refuses an unknown person, an unknown verb and a target a verb must not have", () => {
    const sheet = raw();
    at(sheet, "m10")["actor"] = "Fulano";
    expect(messages(validateBeatSheet(sheet, ctx))).toMatch(/"Fulano" is not in the cast/);
    const verb = raw();
    at(verb, "m10")["verb"] = "teleport";
    expect(messages(validateBeatSheet(verb, ctx))).toMatch(/not one of the 18 verbs/);
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

describe("validateBeatSheet: Contract A, invariants", () => {
  it("[1] exactly one climax act, and it is a physical verb", () => {
    const none = raw();
    delete (none["beats"] as Array<Record<string, unknown>>).find((b) => b["climax"] === true)!["climax"];
    expect(messages(validateBeatSheet(none, ctx))).toMatch(/exactly one act has climax:true \(found 0\)/);

    const two = raw();
    const acts = (two["beats"] as Array<Record<string, unknown>>).filter((b) => b["kind"] === "act" && b["verb"] === "glare");
    acts[0]!["climax"] = true;
    expect(messages(validateBeatSheet(two, ctx))).toMatch(/found 2/);

    const soft = raw();
    const c = (soft["beats"] as Array<Record<string, unknown>>).find((b) => b["climax"] === true)!;
    c["verb"] = "cry";
    delete c["with"];
    expect(messages(validateBeatSheet(soft, ctx))).toMatch(/the climax is a physical act/);
  });

  it("[1] the climax comes by 4:00, hard", () => {
    const late = raw({ climaxAtMs: 180_000 });
    const c = (late["beats"] as Array<Record<string, unknown>>).find((b) => b["climax"] === true)!;
    c["at_ms"] = 241_000;
    (late["arc"] as Record<string, number>)["climax_at_ms"] = 241_000;
    (late["arc"] as Record<string, number>)["aftermath_until_ms"] = 290_000;
    const r = validateBeatSheet(late, ctx);
    expect(messages(r)).toMatch(/by 240000 ms \(4:00\)/);
    expect(r.sheet).toBeUndefined();
    const edge = raw();
    const e = (edge["beats"] as Array<Record<string, unknown>>).find((b) => b["climax"] === true)!;
    e["at_ms"] = 240_000;
    (edge["arc"] as Record<string, number>)["climax_at_ms"] = 240_000;
    (edge["arc"] as Record<string, number>)["aftermath_until_ms"] = 290_000;
    for (const b of edge["beats"] as Array<Record<string, number>>) if (b["at_ms"]! > 200_000 && b["at_ms"]! < 240_000) b["at_ms"] = 240_000 + (b["at_ms"] % 1000) + 600;
    const okEdge = validateBeatSheet(edge, ctx);
    expect(okEdge.errors.filter((x) => /4:00/.test(x.message))).toEqual([]);
    expect(okEdge.warnings.map((w) => w.message).join(" ")).toMatch(/beat_sheet.climax_tight/);
  });

  it("[1] the inciting incident comes by 90 s", () => {
    const sheet = raw();
    for (const b of sheet["beats"] as Array<Record<string, unknown>>) if (b["phase"] === "inciting") b["at_ms"] = 95_000 + (b["at_ms"] as number);
    expect(messages(validateBeatSheet(sheet, ctx))).toMatch(/inciting_late|phase_order/);
  });

  it("[2] the ladder: one rung per beat unless authored_skip, and a skip needs a drama block", () => {
    const sheet = raw();
    const insult = (sheet["beats"] as Array<Record<string, unknown>>).find((b) => b["verb"] === "insult")!;
    insult["verb"] = "punch";
    expect(messages(validateBeatSheet(sheet, ctx))).toMatch(/skips the ladder/);
    insult["authored_skip"] = true;
    expect(validateBeatSheet(sheet, ctx).errors.filter((e) => /ladder/.test(e.message))).toEqual([]);
    expect(messages(validateBeatSheet(sheet, { ...ctx, drama: undefined }))).toMatch(/needs a drama block/);
  });

  it("[2] an explicit drama block bounds the sheet: max_rung, may_target, may_die", () => {
    const kill = raw({ climax: "kill" });
    const slapOnly = { max_rung: 4, may_target: [["person-1", "person-2"] as const], may_die: [] as string[] };
    expect(messages(validateBeatSheet(kill, { ...ctx, drama: slapOnly }))).toMatch(/max_rung/);
    expect(messages(validateBeatSheet(kill, { ...ctx, drama: { ...slapOnly, max_rung: 6 } }))).toMatch(/may_die/);
    expect(messages(validateBeatSheet(kill, { ...ctx, drama: { max_rung: 6, may_target: [], may_die: ["person-2"] } }))).toMatch(/may_target/);
    expect(validateBeatSheet(kill, { ...ctx, drama: { max_rung: 6, may_target: [["person-1", "person-2"]], may_die: ["person-2"] } }).errors).toEqual([]);
  });

  it("[2] physical beats are 20 s apart, the same verb at one person 60 s apart, one death a scene", () => {
    const close = raw();
    const shove = (close["beats"] as Array<Record<string, unknown>>).find((b) => b["verb"] === "shove")!;
    shove["at_ms"] = 152_000;
    expect(messages(validateBeatSheet(close, ctx))).toMatch(/spacing|phase_order/);

    const twice = raw();
    const insult = (twice["beats"] as Array<Record<string, unknown>>).find((b) => b["verb"] === "insult")!;
    (twice["beats"] as unknown[]).push({ ...insult, id: "dup", at_ms: (insult["at_ms"] as number) + 10_000 });
    expect(messages(validateBeatSheet(twice, ctx))).toMatch(/cooldown/);

    const deaths = raw({ climax: "kill" });
    (deaths["beats"] as unknown[]).push({ id: "d2", at_ms: 190_000, phase: "aftermath", kind: "act", actor: "person-2", verb: "die" });
    expect(messages(validateBeatSheet(deaths, ctx))).toMatch(/one death per scene/);
  });

  it("[2] a humans-only target needs the scene flag", () => {
    const sheet = raw();
    at(sheet, "m10")["with"] = "@human";
    expect(messages(validateBeatSheet(sheet, ctx))).toMatch(/names actors/);
    expect(validateBeatSheet(sheet, { ...ctx, mayTargetHumans: true }).errors.filter((e) => /@human/.test(e.message))).toEqual([]);
  });

  it("[3] every act has a setup before it, and the climax an aftermath after it", () => {
    const noSetup = raw();
    noSetup["beats"] = (noSetup["beats"] as Array<Record<string, unknown>>).filter((b) => b["kind"] !== "note" && b["kind"] !== "reveal");
    expect(messages(validateBeatSheet(noSetup, ctx))).toMatch(/needs a note or a reveal before it/);
    const noAfter = raw();
    noAfter["beats"] = (noAfter["beats"] as Array<Record<string, unknown>>).filter((b) => b["phase"] !== "aftermath");
    expect(messages(validateBeatSheet(noAfter, ctx))).toMatch(/phase aftermath comes after the climax/);
  });

  it("[4] a scene over two minutes needs a reversal before the climax", () => {
    const flat = raw();
    flat["beats"] = (flat["beats"] as Array<Record<string, unknown>>).filter((b) => b["phase"] !== "reversal" || b["kind"] === "act" || b["kind"] === "camera" || b["kind"] === "expression");
    delete (flat["arc"] as Record<string, unknown>)["reversal_at_ms"];
    expect(messages(validateBeatSheet(flat, ctx))).toMatch(/needs a reveal or note with phase reversal/);
    const short = raw();
    short["beats"] = (short["beats"] as Array<Record<string, unknown>>).filter((b) => (b["at_ms"] as number) <= 100_000 || b["kind"] === "act");
    expect(messages(validateBeatSheet(flat, ctx))).not.toMatch(/never/);
  });

  it("[4] reversal_at_ms is taken from the first reversal beat", () => {
    const sheet = raw();
    (sheet["arc"] as Record<string, number>)["reversal_at_ms"] = 12_345;
    const r = validateBeatSheet(sheet, ctx);
    expect(r.errors.filter((e) => /reversal/.test(e.message))).toEqual([]);
    expect(r.sheet!.arc.reversal_at_ms).toBe(sheet && (r.sheet!.beats.find((b) => b.phase === "reversal" && (b.kind === "reveal" || b.kind === "note"))!.at_ms));
    expect(r.warnings.some((w) => /arc_fixed/.test(w.message))).toBe(true);
  });

  it("[5] at least three distinct block, prop or camera beats", () => {
    const talky = raw();
    talky["beats"] = (talky["beats"] as Array<Record<string, unknown>>).filter((b) => !["block", "prop", "camera"].includes(b["kind"] as string));
    expect(messages(validateBeatSheet(talky, ctx))).toMatch(/at least 3 distinct block, prop or camera beats \(found 0\)/);
    const same = raw();
    same["beats"] = [
      ...(same["beats"] as Array<Record<string, unknown>>).filter((b) => !["block", "prop", "camera"].includes(b["kind"] as string)),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, at_ms: 1000 + i, phase: "setup", kind: "camera", intent: { shot: "establishing" } })),
    ];
    expect(messages(validateBeatSheet(same, ctx))).toMatch(/\(found 1\)/);
  });

  it("[5] a prop the room does not have is mimed (a warning), and a place it does not have is a warning too", () => {
    const sheet = raw();
    const room = { furni: [{ id: "f1", label: "mesa" }, { id: "f2", label: "sofa" }], zones: [{ id: "z1", kind: "window", label: "janela" }] };
    const r = validateBeatSheet(sheet, { ...ctx, room });
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.message).join(" ")).toMatch(/beat_sheet.prop_mimed/);
    const known = raw();
    for (const b of known["beats"] as Array<Record<string, unknown>>) if (b["kind"] === "prop") b["prop"] = "mesa";
    expect(validateBeatSheet(known, { ...ctx, room }).warnings.map((w) => w.message).join(" ")).not.toMatch(/prop_mimed/);
  });

  it("[6] a sheet that cost more than 30 cents is refused", () => {
    const sheet = raw();
    sheet["generated_by"] = { model: "m", cost_usd: 0.31, ms: 12_000 };
    expect(messages(validateBeatSheet(sheet, ctx))).toMatch(/at most \$0.30/);
    sheet["generated_by"] = { model: "m", cost_usd: 0.3, ms: 12_000, input_hash: "abc", attempts: 2 };
    const ok = validateBeatSheet(sheet, ctx);
    expect(ok.errors).toEqual([]);
    expect(ok.sheet!.generated_by).toMatchObject({ model: "m", cost_usd: 0.3, input_hash: "abc", attempts: 2 });
  });

  it("phases run in time order", () => {
    const sheet = raw();
    at(sheet, "m3")["phase"] = "aftermath";
    expect(messages(validateBeatSheet(sheet, ctx))).toMatch(/phase_order/);
  });

  it("a death asks for a cut after it (a warning), and a cut obeys the scene floor", () => {
    const sheet = raw({ climax: "kill" });
    sheet["beats"] = (sheet["beats"] as Array<Record<string, unknown>>).filter((b) => b["kind"] !== "cut");
    expect(validateBeatSheet(sheet, ctx).warnings.map((w) => w.message).join(" ")).toMatch(/drama.no_scene_cut/);
    const quick = raw({ climax: "kill" });
    (quick["beats"] as unknown[]).push({ id: "c2", at_ms: 205_000, phase: "aftermath", kind: "cut", reason: "de novo" });
    expect(messages(validateBeatSheet(quick, ctx))).toMatch(/cut_floor/);
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

  it("sends a new face as the nearest old one until the wire has it", () => {
    expect(wireFace("fear")).toBe("surprised");
    expect(wireFace("smug")).toBe("smile");
    expect(wireFace("fear", ["fear", "neutral"])).toBe("fear");
    expect(wireFace("angry")).toBe("angry");
  });
});

describe("sheet beats are typed", () => {
  it("compiles every kind the contract lists", () => {
    const kinds: SheetBeat["kind"][] = ["act", "cut", "block", "prop", "reveal", "note", "pause", "expression", "camera"];
    const seen = new Set(mock({ climax: "kill" }).beats.map((b) => b.kind));
    for (const k of kinds) expect(seen.has(k), k).toBe(true);
  });
});
