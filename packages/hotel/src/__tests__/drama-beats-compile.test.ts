/**
 * The scenario's authored beats (errata P1-05, P4-01): the optional top-level `beats` key of the form, of a markdown scene's frontmatter and of the
 * compiled body, read the way the `drama` block is (SCN-5): refs by cast name or agent id, compile errors with a path, a body that never
 * reads looser than the author wrote.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AuthoringError, AuthoringService } from "../authoring/authoring-service.js";
import { cleanBeats, compileSceneBeats } from "../authoring/scenario-beats.js";
import type { ScenarioBeat } from "../authoring/scenario-beats.js";
import type { ScenarioDrama } from "../authoring/scenario-drama.js";
import { parseScenarioBody } from "../run/scenario-body.js";
import type { ScenarioBody } from "../run/scenario-body.js";

const CAST = [{ id: "ana", displayName: "Ana Clara" }, { id: "bia", displayName: "Bia" }, { id: "caio", displayName: "Caio" }];
const BLOCK: ScenarioDrama = { max_rung: 6, may_target: [["ana", "bia"]], may_die: ["bia"], permadeath: false };
/** `compile(raw)` reads against BLOCK; `compile(raw, undefined)` reads against no block at all. */
const compile = (raw: unknown, ...drama: [] | [ScenarioDrama | undefined]) => compileSceneBeats(raw, CAST, { drama: drama.length > 0 ? drama[0] : BLOCK });

const llm = { provider: "mock" as const, baseUrl: "", apiKeyEnv: "PERFECTMAN_LLM_API_KEY" as const, models: ["mock"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 };
const presetsRoot = fileURLToPath(new URL("../../../../examples/presets", import.meta.url));
const service = new AuthoringService({ llm, apiKey: undefined, presetsRoot });
const bodyOf = (source: string): ScenarioBody => service.compile({ source }).body as ScenarioBody;

describe("compileSceneBeats: the authored script of a scene", () => {
  it("turns the author's seconds, cast refs and skip flag into ms, agent ids and authored_skip, numbered in time order", () => {
    const r = compile([{ at: 170, cut: "fim da festa" }, { at: 90, actor: "ana", verb: "kill", with: "Bia", skip: true }]);
    expect(r.errors).toEqual([]);
    expect(r.beats).toEqual([
      { id: "b1", at_ms: 90_000, kind: "act", actor: "ana", verb: "kill", with: "bia", authored_skip: true },
      { id: "b2", at_ms: 170_000, kind: "cut", reason: "fim da festa" },
    ]);
  });

  it("keeps the order the author wrote for beats at the same second, so the ids are stable", () => {
    const r = compile([{ at: 20, actor: "bia", verb: "glare", with: "ana" }, { at: 20, actor: "ana", verb: "glare", with: "bia" }]);
    expect(r.beats.map((b) => (b.kind === "act" ? b.actor : "cut"))).toEqual(["bia", "ana"]);
    expect(r.beats.map((b) => b.id)).toEqual(["b1", "b2"]);
  });

  it("[SCN-5] refuses what is not a script: not a list, an unknown key, a time off the clock, an unknown person, an unknown verb", () => {
    expect(compile({}).errors.map((e) => e.path)).toEqual(["beats"]);
    expect(compile([{ at: 5, actor: "ana", verb: "glare", with: "bia", loud: true }]).errors.map((e) => e.path)).toEqual(["beats[0].loud"]);
    expect(compile([{ at: -1, cut: "x" }, { at: 4000, cut: "x" }, { cut: "x" }]).errors.map((e) => e.path)).toEqual(["beats[0].at", "beats[1].at", "beats[2].at"]);
    expect(compile([{ at: 5, actor: "zed", verb: "glare", with: "bia" }]).errors.map((e) => e.path)).toEqual(["beats[0].actor"]);
    expect(compile([{ at: 5, actor: "ana", verb: "waltz", with: "bia" }]).errors.map((e) => e.path)).toEqual(["beats[0].verb"]);
  });

  it("[ACT-7] [ACT-8] a verb that needs a target names one, a solo verb does not, and nobody aims at themselves or at @human", () => {
    expect(compile([{ at: 5, actor: "ana", verb: "slap" }]).errors.map((e) => e.path)).toEqual(["beats[0].with"]);
    expect(compile([{ at: 5, actor: "ana", verb: "faint", with: "bia" }]).errors.map((e) => e.path)).toEqual(["beats[0].with"]);
    expect(compile([{ at: 5, actor: "ana", verb: "slap", with: "ana" }]).errors.map((e) => e.path)).toEqual(["beats[0].with"]);
    expect(compile([{ at: 5, actor: "ana", verb: "slap", with: "@human" }]).errors.map((e) => e.path)).toEqual(["beats[0].with"]);
    expect(compile([{ at: 5, actor: "ana", verb: "faint" }]).errors).toEqual([]);
  });

  it("a cut carries a reason of at most 40 characters and nothing else", () => {
    expect(compile([{ at: 30, cut: "y".repeat(60) }]).beats).toEqual([{ id: "b1", at_ms: 30_000, kind: "cut", reason: "y".repeat(40) }]);
    expect(compile([{ at: 30, cut: "" }]).errors.map((e) => e.path)).toEqual(["beats[0].cut"]);
    expect(compile([{ at: 30, cut: "fim", actor: "ana" }]).errors.map((e) => e.path)).toEqual(["beats[0].actor"]);
  });

  it("[SCN-4] an authored skip needs a drama block, even an empty one", () => {
    const skip = [{ at: 5, actor: "ana", verb: "slap", with: "bia", skip: true }];
    expect(compile(skip, undefined).errors.map((e) => e.path)).toEqual(["beats[0].skip"]);
    expect(compile(skip, { max_rung: 4, may_target: [["ana", "bia"]], may_die: [], permadeath: false }).errors).toEqual([]);
  });

  it("[SCN-3] warns on a beat its own block will veto, and stays silent on one it allows", () => {
    const warn = (raw: unknown, ...drama: [] | [ScenarioDrama | undefined]) => compile(raw, ...drama).warnings.map((w) => `${w.path} ${w.message.split(":")[0]}`);
    expect(warn([{ at: 5, actor: "ana", verb: "kill", with: "bia" }])).toEqual([]);
    expect(warn([{ at: 5, actor: "ana", verb: "kill", with: "caio" }])).toEqual(["beats[0] drama.beat_vetoed"]);
    expect(warn([{ at: 5, actor: "caio", verb: "slap", with: "bia" }])).toEqual(["beats[0] drama.beat_vetoed"]);
    expect(warn([{ at: 5, actor: "ana", verb: "punch", with: "bia" }], { ...BLOCK, max_rung: 3 })).toEqual(["beats[0] drama.beat_vetoed"]);
    expect(warn([{ at: 5, actor: "ana", verb: "kill", with: "bia" }], undefined)).toEqual(["beats[0] drama.beat_vetoed"]);
  });

  it("holds at most 40 beats", () => {
    const many = Array.from({ length: 41 }, (_, i) => ({ at: i, cut: "c" }));
    expect(compile(many).errors.map((e) => e.path)).toEqual(["beats"]);
  });
});

describe("cleanBeats: the body's half", () => {
  const ids = ["person-1", "person-2"];
  const kill: ScenarioBeat = { id: "b1", at_ms: 90_000, kind: "act", actor: "person-1", verb: "kill", with: "person-2", authored_skip: true };
  const cut: ScenarioBeat = { id: "b2", at_ms: 170_000, kind: "cut", reason: "fim" };

  it("keeps a good script as it is, and no key at all for an absent or empty one", () => {
    expect(cleanBeats([kill, cut], ids)).toEqual({ beats: [kill, cut] });
    expect(cleanBeats(undefined, ids)).toEqual({});
    expect(cleanBeats([], ids)).toEqual({});
  });

  it("drops a beat that names someone the cast does not have, a verb that does not exist or a time off the clock, and keeps the rest", () => {
    const bad = [{ ...kill, id: "x1", actor: "person-9" }, { ...kill, id: "x2", verb: "waltz" }, { ...cut, id: "x3", at_ms: -5 }, { ...cut, id: "x4", reason: 7 }, 3, null];
    expect(cleanBeats([...bad, cut], ids)).toEqual({ beats: [cut] });
  });

  it("gives every beat one id: a repeated or missing id is numbered again, so a rebuild never plays one twice", () => {
    const out = cleanBeats([kill, { ...cut, id: "b1" }, { ...cut, id: undefined, at_ms: 200_000 }], ids).beats ?? [];
    expect(new Set(out.map((b) => b.id)).size).toBe(3);
    expect(out[0]?.id).toBe("b1");
  });

  it("sorts by time", () => {
    expect(cleanBeats([cut, kill], ids).beats?.map((b) => b.id)).toEqual(["b1", "b2"]);
  });
});

describe("beats through the authoring service and the body", () => {
  it("[SCN-6] the murder preset's beats compile into its body, in agent ids, and the body parses with them", async () => {
    const { source } = await service.preset("assassinato-na-festa");
    const body = bodyOf(source);
    expect(body.beats).toEqual([
      { id: "b1", at_ms: 90_000, kind: "act", actor: "ricardo", verb: "kill", with: "otavio", authored_skip: true },
      { id: "b2", at_ms: 170_000, kind: "cut", reason: "fim da festa" },
    ]);
    const parsed = parseScenarioBody(JSON.parse(JSON.stringify(body)));
    expect(parsed.ok && parsed.body.beats).toEqual(body.beats);
    expect(body.v).toBe(1);
  });

  it("a scene without beats compiles to a body without the key, and a bad beat fails the compile with its path", async () => {
    expect(bodyOf((await service.preset("tapa-na-cara")).source)).not.toHaveProperty("beats");
    const broken = (await service.preset("assassinato-na-festa")).source.replace("verb: kill", "verb: waltz");
    expect(service.validate({ source: broken }).errors.map((e) => e.path)).toEqual(["beats[0].verb"]);
    expect(() => service.compile({ source: broken })).toThrow(AuthoringError);
  });

  it("a builder form carries beats by cast name, and they come out in agent ids (the builder can author a cut now)", () => {
    const form = {
      title: "Duelo", situation: "Dois rivais numa sala.", language: "pt-BR",
      cast: [{ name: "Ana Clara", role: "skeptic" }, { name: "Bia", role: "connector" }],
      drama: { max_rung: "slap", may_target: [["Ana Clara", "Bia"]] },
      beats: [{ at: 60, actor: "Ana Clara", verb: "slap", with: "Bia", skip: true }, { at: 100, cut: "fim" }],
    };
    const body = bodyOf(JSON.stringify(form));
    expect(body.beats).toEqual([
      { id: "b1", at_ms: 60_000, kind: "act", actor: "person-1", verb: "slap", with: "person-2", authored_skip: true },
      { id: "b2", at_ms: 100_000, kind: "cut", reason: "fim" },
    ]);
  });

  it("[SCN-6] a form whose block can kill and whose beats cut the scene validates without drama.no_scene_cut", () => {
    const form = (beats: unknown) => JSON.stringify({ title: "Duelo", situation: "Dois rivais.", cast: [{ name: "Ana" }, { name: "Bia" }], drama: { max_rung: 6, may_target: [["Ana", "Bia"]], may_die: ["Bia"] }, beats });
    const drama = (source: string) => service.validate({ source }).warnings.map((w) => w.message.split(":")[0]).filter((m) => m?.startsWith("drama."));
    expect(drama(form([{ at: 60, cut: "fim" }]))).toEqual([]);
    expect(drama(form(undefined))).toEqual(["drama.no_scene_cut"]);
  });
});
