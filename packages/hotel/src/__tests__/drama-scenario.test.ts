import { describe, expect, it } from "vitest";
import { AuthoringError, AuthoringService } from "../authoring/authoring-service.js";
import { DEFAULT_SCENE_MAX_RUNG, FREE_PLAY_DRAMA, cleanDrama, compileDramaForm, resolveRunDrama } from "../authoring/scenario-drama.js";
import { SCENARIO_BODY_VERSION, parseScenarioBody } from "../run/scenario-body.js";
import { compiledScenario } from "../testing/helpers.js";

const CAST = { names: ["Ana Clara", "Duda", "Rafa"], ids: ["person-1", "person-2", "person-3"] };
const compile = (raw: unknown, sceneCuts = 0) => compileDramaForm(raw, CAST, { sceneCuts });
const errors = (raw: unknown): string[] => compile(raw).errors.map((e) => e.path);

const llm = { provider: "mock" as const, baseUrl: "", apiKeyEnv: "PERFECTMAN_LLM_API_KEY" as const, models: ["mock"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 };
const formSource = (drama?: unknown): string =>
  JSON.stringify({
    title: "Noite no bar", situation: "Tres amigos no bar depois do trabalho.", language: "pt-BR",
    cast: [{ name: "Ana Clara", role: "connector", goal: "Fechar a conta." }, { name: "Duda", role: "skeptic", goal: "Cobrar o que deve." }, { name: "Rafa", role: "performer", goal: "Chamar atencao." }],
    ...(drama === undefined ? {} : { drama }),
  });

describe("the scenario drama block (section 7)", () => {
  it("[SCN-2] drama:{} compiles to the defaults: max_rung 3 and empty lists, not permadeath", () => {
    expect(compile({}).drama).toEqual({ max_rung: 3, may_target: [], may_die: [], permadeath: false });
    expect(compile({}).errors).toEqual([]);
    expect(FREE_PLAY_DRAMA).toEqual({ max_rung: 3, may_target: [], may_die: [], permadeath: false });
  });

  it("[SCN-5] turns cast names into agent ids and accepts @human as a victim and as a may_die entry", () => {
    const r = compile({ max_rung: 4, may_target: [["Ana Clara", "Duda"], ["Rafa", "@human"]], may_die: ["Duda", "@human"], permadeath: true }, 1);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.drama).toEqual({ max_rung: 4, may_target: [["person-1", "person-2"], ["person-3", "@human"]], may_die: ["person-2", "@human"], permadeath: true });
  });

  it("[SCN-5] reads max_rung as an integer 0 to 6 or a ladder verb id, and writes the integer", () => {
    for (const [given, rung] of [[0, 0], [6, 6], ["glare", 1], ["insult", 2], ["shove", 3], ["slap", 4], ["punch", 5], ["kill", 6]] as const) {
      expect(compile({ max_rung: given }).drama?.max_rung, String(given)).toBe(rung);
    }
    for (const bad of [7, -1, 2.5, "hug", "cry", "4", true, null]) expect(errors({ max_rung: bad }), JSON.stringify(bad)).toEqual(["drama.max_rung"]);
  });

  it("[SCN-5] refuses a may_target entry that is not a pair, and one with a third element", () => {
    expect(errors({ may_target: [["Ana Clara"]] })).toEqual(["drama.may_target[0]"]);
    expect(errors({ may_target: [["Ana Clara", "Duda", "Rafa"]] })).toEqual(["drama.may_target[0]"]);
    expect(errors({ may_target: ["Ana Clara"] })).toEqual(["drama.may_target[0]"]);
    expect(errors({ may_target: [["Ana Clara", 2]] })).toEqual(["drama.may_target[0]"]);
    expect(errors({ may_target: "Ana Clara" })).toEqual(["drama.may_target"]);
  });

  it("[SCN-5] refuses an unknown cast name in may_target and in may_die, naming the path", () => {
    expect(errors({ may_target: [["Ana Clara", "Duda"], ["Ana Clara", "Ninguem"]] })).toEqual(["drama.may_target[1][1]"]);
    expect(errors({ may_target: [["Ninguem", "Duda"]] })).toEqual(["drama.may_target[0][0]"]);
    expect(errors({ may_die: ["Duda", "Ninguem"] })).toEqual(["drama.may_die[1]"]);
    expect(errors({ may_die: "Duda" })).toEqual(["drama.may_die"]);
  });

  it("[SCN-5] refuses @human as an aggressor, but not as a victim", () => {
    expect(errors({ may_target: [["@human", "Duda"]] })).toEqual(["drama.may_target[0][0]"]);
    expect(compile({ may_target: [["Duda", "@human"]] }).errors).toEqual([]);
  });

  it("[SCN-5] refuses a permadeath that is not a boolean, and any unknown key, each by its path", () => {
    expect(errors({ permadeath: "yes" })).toEqual(["drama.permadeath"]);
    expect(errors({ permadeath: 1 })).toEqual(["drama.permadeath"]);
    expect(errors({ may_kill: [] })).toEqual(["drama.may_kill"]);
    expect(errors({ max_rung: 9, permadeath: 3, extra: 1 }).sort()).toEqual(["drama.extra", "drama.max_rung", "drama.permadeath"]);
    for (const notABlock of [null, [], "drama", 3]) expect(errors(notABlock), JSON.stringify(notABlock)).toEqual(["drama"]);
  });

  it("[SCN-5] matches a cast name ignoring case and spacing, and counts duplicates once", () => {
    const r = compile({ may_die: ["  ana   clara ", "Ana Clara", "DUDA"], may_target: [["rafa", "duda"], ["Rafa", "Duda"]] });
    expect(r.errors).toEqual([]);
    expect(r.drama).toMatchObject({ may_die: ["person-1", "person-2"], may_target: [["person-3", "person-2"]] });
  });

  it("[SCN-6] warns drama.no_scene_cut when may_die is not empty and the scenario authors no scene cut; not when it does, not when may_die is empty", () => {
    expect(compile({ may_die: ["Duda"] }, 0).warnings).toEqual([{ path: "drama.may_die", message: expect.stringContaining("scene cut") }]);
    expect(compile({ may_die: ["Duda"] }, 0).warnings[0]?.message).toContain("drama.no_scene_cut");
    expect(compile({ may_die: ["Duda"] }, 2).warnings).toEqual([]);
    expect(compile({ may_die: [] }, 0).warnings).toEqual([]);
    expect(compile({ may_die: ["@human"] }, 0).warnings).toHaveLength(1);
  });
});

describe("the drama block in the compiled body", () => {
  const ok = (drama: unknown) => parseScenarioBody({ ...(compiledScenario().body as object), drama });
  const dramaOf = (drama: unknown) => {
    const parsed = ok(drama);
    return parsed.ok ? parsed.body.drama : "refused";
  };

  it("[SCN-2] keeps SCENARIO_BODY_VERSION at 1 and reads a body without a drama block as it always did (free play: a body saved before the default is not given one at run time)", () => {
    expect(SCENARIO_BODY_VERSION).toBe(1);
    const { drama: _drama, drama_mode: _mode, ...legacy } = compiledScenario().body as Record<string, unknown>;
    const parsed = parseScenarioBody(legacy);
    expect(parsed.ok && parsed.body).not.toHaveProperty("drama");
    expect(parsed.ok && parsed.body).not.toHaveProperty("drama_mode");
  });

  it("[SCN-2] reads a compiled block, filling the defaults of omitted keys", () => {
    expect(dramaOf({ max_rung: 4, may_target: [["person-1", "person-2"], ["person-3", "@human"]], may_die: ["person-2"], permadeath: false })).toEqual({
      max_rung: 4, may_target: [["person-1", "person-2"], ["person-3", "@human"]], may_die: ["person-2"], permadeath: false,
    });
    expect(dramaOf({})).toEqual({ max_rung: 3, may_target: [], may_die: [], permadeath: false });
    expect(dramaOf({ permadeath: true })).toEqual({ max_rung: 3, may_target: [], may_die: [], permadeath: true });
  });

  it.each([
    ["an unknown key", { max_rung: 4, may_kill: [] }],
    ["a max_rung that is a verb id", { max_rung: "slap" }],
    ["a max_rung above 6", { max_rung: 7 }],
    ["an unknown agent id", { may_die: ["person-9"] }],
    ["@human as an aggressor", { may_target: [["@human", "person-1"]] }],
    ["a pair of three", { may_target: [["person-1", "person-2", "person-3"]] }],
    ["a permadeath that is a string", { permadeath: "true" }],
    ["a block that is not an object", [1]],
  ])("[SCN-5] drops the whole block for %s: the run is free play, never a looser reading", (_name, drama) => {
    expect(dramaOf(drama)).toBeUndefined();
    expect(ok(drama).ok).toBe(true);
  });

  it("[SCN-1] a run with no block resolves to free play: max rung 3, no pairs, no deaths, no authored skips", () => {
    expect(resolveRunDrama({})).toEqual({ block: undefined, effective: FREE_PLAY_DRAMA, freePlay: true, canSkip: false, mode: "free_play", off: false });
    expect(cleanDrama(undefined, ["person-1"])).toEqual({});
  });

  it("[SCN-2] a run with drama:{} is free play plus the ability to author skips (SCN-4)", () => {
    const resolved = resolveRunDrama({ drama: { max_rung: 3, may_target: [], may_die: [], permadeath: false } });
    expect(resolved).toMatchObject({ effective: FREE_PLAY_DRAMA, freePlay: false, canSkip: true });
  });
});

describe("the drama block through authoring (validate and compile)", () => {
  const dramaRows = (rows: Array<{ path: string; message: string }>) => rows.filter((r) => r.path.startsWith("drama"));
  const svc = () => new AuthoringService({ llm, apiKey: undefined });

  it("[SCN-5] compile writes the block into the body with agent ids, and the body validates", () => {
    const { body } = svc().compile({ source: formSource({ max_rung: "slap", may_target: [["Ana Clara", "Duda"]], may_die: ["Duda"], permadeath: true }) }) as { body: { v: number; drama?: unknown } };
    expect(body.drama).toEqual({ max_rung: 4, may_target: [["person-1", "person-2"]], may_die: ["person-2"], permadeath: true });
    expect(svc().validate({ body })).toMatchObject({ ok: true, errors: [] });
  });

  it("a form with no drama key compiles to the conservative default for its three actors (see the default block tests below)", () => {
    const { body } = svc().compile({ source: formSource() }) as { body: { drama?: { max_rung: number; may_target: string[][] }; drama_mode?: string } };
    expect(body.drama?.max_rung).toBe(DEFAULT_SCENE_MAX_RUNG);
    expect(body.drama?.may_target).toHaveLength(6);
    expect(body.drama_mode).toBe("default");
  });

  it("[SCN-5] compile refuses a bad block with 422 and the path; validate reports it as an error row", () => {
    const source = formSource({ may_die: ["Ninguem"], max_rung: 9 });
    expect(() => svc().compile({ source })).toThrow(AuthoringError);
    try {
      svc().compile({ source });
    } catch (err) {
      expect(err).toMatchObject({ status: 422, code: "bad_scenario", errors: [{ path: "drama.max_rung" }, { path: "drama.may_die[0]" }] });
    }
    expect(svc().validate({ source })).toMatchObject({ ok: false, errors: [{ path: "drama.max_rung" }, { path: "drama.may_die[0]" }] });
  });

  it("[SCN-5] a drama block always compiles with no drama.disabled warning: the sidecar has no switch (errata P4-10)", () => {
    const v = svc().validate({ source: formSource({ max_rung: 4 }) });
    expect(v.ok).toBe(true);
    expect(dramaRows(v.warnings)).toEqual([]);
    expect(v.warnings.some((w) => w.message.includes("drama.disabled"))).toBe(false);
    expect(dramaRows(svc().validate({ source: formSource({}) }).warnings)).toEqual([]);
    expect(dramaRows(svc().validate({ source: formSource() }).warnings)).toEqual([]);
    expect(() => svc().compile({ source: formSource({ max_rung: 4 }) })).not.toThrow();
  });

  it("[SCN-6] validate warns drama.no_scene_cut for a scenario that can kill and authors no cut", () => {
    const res = svc().validate({ source: formSource({ may_die: ["Duda"] }) });
    expect(res.ok).toBe(true);
    expect(dramaRows(res.warnings)).toEqual([{ path: "drama.may_die", message: expect.stringContaining("drama.no_scene_cut") }]);
  });
});
