/**
 * The conservative default drama block: a scene that writes no `drama` key is compiled with every ordered pair of its actors, up to a slap, nobody dies
 * (`defaultSceneDrama`, act-contract SCN-7), and `drama: off` compiles to the max_rung 0 block plus the body's `drama_mode: "off"` (SCN-8). The
 * director's side (the climb, the inert off scene) is in `drama-default-scene.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { AuthoringService } from "../authoring/authoring-service.js";
import { DRAMA_OFF, FREE_PLAY_DRAMA, compileDramaForm, defaultSceneDrama, resolveRunDrama, summarizeRunDrama } from "../authoring/scenario-drama.js";
import { parseScenarioBody } from "../run/scenario-body.js";
import { hotelReadsBlock } from "../testing/hotel-block-read.js";

const CAST = { names: ["Ana Clara", "Duda", "Rafa"], ids: ["person-1", "person-2", "person-3"] };
const llm = { provider: "mock" as const, baseUrl: "", apiKeyEnv: "PERFECTMAN_LLM_API_KEY" as const, models: ["mock"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 };
const formSource = (drama?: unknown): string =>
  JSON.stringify({
    title: "Noite no bar", situation: "Tres amigos no bar depois do trabalho.", language: "pt-BR",
    cast: [{ name: "Ana Clara", role: "connector", goal: "Fechar a conta." }, { name: "Duda", role: "skeptic", goal: "Cobrar o que deve." }, { name: "Rafa", role: "performer", goal: "Chamar atencao." }],
    ...(drama === undefined ? {} : { drama }),
  });

describe("the conservative default block: a scene that writes no drama key", () => {
  const svc = () => new AuthoringService({ llm, apiKey: undefined });
  type Body = { drama?: ScenarioDramaBody; drama_mode?: string; beats?: Array<{ verb?: string; authored_skip?: boolean }> };
  type ScenarioDramaBody = { max_rung: number; may_target: Array<[string, string]>; may_die: string[]; permadeath: boolean };
  const bodyOf = (source: string): Body => svc().compile({ source }).body as Body;
  const IDS = ["person-1", "person-2", "person-3"];
  const withBeats = (beats: unknown[], drama?: unknown) => JSON.stringify({ ...(JSON.parse(formSource(drama)) as object), beats });

  it("is every ordered pair of the bot actors, up to a slap: no punch, no kill, nobody dies, no permadeath, never a human", () => {
    const drama = defaultSceneDrama(IDS);
    expect(drama).toEqual({ max_rung: 4, may_target: [["person-1", "person-2"], ["person-1", "person-3"], ["person-2", "person-1"], ["person-2", "person-3"], ["person-3", "person-1"], ["person-3", "person-2"]], may_die: [], permadeath: false });
    expect(JSON.stringify(drama)).not.toContain("@human");
    expect(defaultSceneDrama(["a", "b", "b"])?.may_target).toEqual([["a", "b"], ["b", "a"]]);
  });

  it("needs two actors: with one there is nobody to aim at and no block", () => {
    expect(defaultSceneDrama(["person-1"])).toBeUndefined();
    expect(defaultSceneDrama([])).toBeUndefined();
    expect(defaultSceneDrama(["person-1", "person-1"])).toBeUndefined();
  });

  it("is written by the compile into the body, with the actors' own agent ids and drama_mode default, and the compile warns nothing about it", () => {
    const body = bodyOf(formSource());
    expect(body.drama).toEqual(defaultSceneDrama(IDS));
    expect(body.drama_mode).toBe("default");
    const v = svc().validate({ source: formSource() });
    expect(v.ok).toBe(true);
    expect(v.warnings.filter((w) => w.path.startsWith("drama"))).toEqual([]);
  });

  it("is the block of the compiled config's real agent ids (the pairs name agents the run spawns)", () => {
    const body = svc().compile({ source: formSource() }).body as { config: { agents: Array<{ id: string }> }; drama: ScenarioDramaBody };
    const ids = body.config.agents.map((a) => a.id);
    for (const [a, v] of body.drama.may_target) expect([ids.includes(a), ids.includes(v)]).toEqual([true, true]);
    expect(new Set(body.drama.may_target.map(([a]) => a))).toEqual(new Set(ids));
  });

  it("survives the round trip to the hotel: JSON on the wire, the sidecar's strict read keeps it and its mode, and the hotel's strict read takes it", () => {
    const wire = JSON.parse(JSON.stringify(svc().compile({ source: formSource() }).body)) as object;
    const parsed = parseScenarioBody(wire);
    expect(parsed.ok && parsed.body.drama).toEqual(defaultSceneDrama(IDS));
    expect(parsed.ok && parsed.body.drama_mode).toBe("default");
    expect(hotelReadsBlock(wire)).toEqual({ kind: "valid", ...defaultSceneDrama(IDS) });
    expect(svc().validate({ body: wire })).toMatchObject({ ok: true, errors: [] });
  });

  it("is read as the default by the run (summary: default, rung 4, six pairs), and a mode never outlives its block", () => {
    const body = bodyOf(formSource());
    const run = resolveRunDrama(body as never);
    expect(run).toMatchObject({ mode: "default", off: false, freePlay: false, canSkip: true });
    expect(summarizeRunDrama(run)).toEqual({ source: "default", max_rung: 4, may_target_pairs: 6, may_die: 0, permadeath: false });
    const broken = parseScenarioBody({ ...(svc().compile({ source: formSource() }).body as object), drama: { max_rung: 4, may_kill: [] } });
    expect(broken.ok && broken.body).not.toHaveProperty("drama_mode");
    expect(broken.ok && resolveRunDrama(broken.body).mode).toBe("free_play");
  });

  it("never replaces an explicit block: {} stays {} (the contract's free play plus skips), a restrictive block stays restrictive, max_rung 0 stays hug-only", () => {
    for (const drama of [{}, { max_rung: 0 }, { max_rung: "insult" }, { max_rung: 6, may_target: [["Ana Clara", "Duda"]], may_die: ["Duda"] }]) {
      const body = bodyOf(formSource(drama));
      expect(body.drama, JSON.stringify(drama)).toEqual(compileDramaForm(drama, CAST).drama);
      expect(body, JSON.stringify(drama)).not.toHaveProperty("drama_mode");
    }
    expect(bodyOf(formSource({})).drama).toEqual(FREE_PLAY_DRAMA);
  });

  it("drama: off is the opt-out: the strictest block the hotel reads plus drama_mode off; the form and a frontmatter write it as the word or false", () => {
    for (const off of ["off", "OFF", " off ", false]) {
      const body = bodyOf(formSource(off));
      expect(body.drama, String(off)).toEqual(DRAMA_OFF);
      expect(body.drama_mode, String(off)).toBe("off");
      expect(hotelReadsBlock(JSON.parse(JSON.stringify(body)))).toMatchObject({ kind: "valid", max_rung: 0, may_target: [], may_die: [] });
    }
    expect(compileDramaForm("off", CAST)).toMatchObject({ drama: DRAMA_OFF, mode: "off", errors: [] });
    expect(compileDramaForm("maybe", CAST).errors.map((e) => e.path)).toEqual(["drama"]);
  });

  it("off reads as off in the run, whatever the body's block says, and shuts the run's whole drama (no act of any kind)", () => {
    const wire = JSON.parse(JSON.stringify(bodyOf(formSource("off")))) as Record<string, unknown>;
    const parsed = parseScenarioBody(wire);
    expect(parsed.ok && resolveRunDrama(parsed.body)).toMatchObject({ mode: "off", off: true, canSkip: false, effective: DRAMA_OFF });
    // A body that says off but carries a looser block, or the word where the block goes, is never read looser.
    for (const tampered of [{ ...wire, drama: { max_rung: 6, may_target: [], may_die: [], permadeath: false } }, { ...wire, drama: "off", drama_mode: undefined }]) {
      const p = parseScenarioBody(tampered);
      expect(p.ok && resolveRunDrama(p.body).off).toBe(true);
      expect(p.ok && p.body.drama).toEqual(DRAMA_OFF);
    }
  });

  it("lets the scene's own beats use the default: a slap and an authored skip compile (they needed a block before); a punch or a kill warns that the block vetoes it", () => {
    const body = bodyOf(withBeats([{ at: 20, actor: "Ana Clara", verb: "slap", with: "Duda" }, { at: 60, actor: "Duda", verb: "insult", with: "Ana Clara", skip: true }]));
    expect(body.beats?.map((b) => b.verb)).toEqual(["slap", "insult"]);
    expect(body.beats?.[1]?.authored_skip).toBe(true);
    const v = svc().validate({ source: withBeats([{ at: 20, actor: "Ana Clara", verb: "punch", with: "Duda" }, { at: 80, actor: "Ana Clara", verb: "kill", with: "Duda" }]) });
    expect(v.warnings.filter((w) => w.message.includes("drama.beat_vetoed")).map((w) => w.message.match(/max_rung is \d/)?.[0])).toEqual(["max_rung is 4", "max_rung is 4"]);
  });

  it("a beat that names a person in an explicit-off scene is vetoed by the off block (max_rung 0), and a skip in a {} scene still compiles", () => {
    const v = svc().validate({ source: withBeats([{ at: 20, actor: "Ana Clara", verb: "slap", with: "Duda" }], "off") });
    expect(v.warnings.some((w) => w.message.includes("max_rung is 0"))).toBe(true);
    expect(() => svc().compile({ source: withBeats([{ at: 20, actor: "Ana Clara", verb: "shove", with: "Duda", skip: true }], {}) })).not.toThrow();
  });
});
