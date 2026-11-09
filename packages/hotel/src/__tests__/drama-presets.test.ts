/**
 * The five telenovela presets (examples/presets/scenes) through the authoring service: the `drama` block of a markdown scenario's frontmatter is read
 * the way a form's is (SCN-5), compiled into the body in agent ids, and warns what the contract says it should (SCN-6, `drama.disabled`).
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AuthoringError, AuthoringService } from "../authoring/authoring-service.js";
import { compileSceneDrama } from "../authoring/scenario-drama.js";
import { parseScenarioBody } from "../run/scenario-body.js";

const llm = { provider: "mock" as const, baseUrl: "", apiKeyEnv: "PERFECTMAN_LLM_API_KEY" as const, models: ["mock"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 };
const presetsRoot = fileURLToPath(new URL("../../../../examples/presets", import.meta.url));
const service = (drama: boolean) => new AuthoringService({ llm, apiKey: undefined, presetsRoot, drama });

const KEYS = ["tapa-na-cara", "confronto-da-traicao", "assassinato-na-festa", "reencontro-abraco", "anuncio-do-desmaio"] as const;
const CAST = [{ id: "ana", displayName: "Ana Clara" }, { id: "bia", displayName: "Bia" }, { id: "caio", displayName: "Caio" }];

describe("compileSceneDrama: a markdown scene's drama block", () => {
  it("[SCN-5] reads agent ids the way a form reads cast names, and gives agent ids back", () => {
    const r = compileSceneDrama({ max_rung: "slap", may_target: [["ana", "bia"], ["caio", "@human"]], may_die: ["bia", "@human"] }, CAST, { sceneCuts: 1 });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.drama).toEqual({ max_rung: 4, may_target: [["ana", "bia"], ["caio", "@human"]], may_die: ["bia", "@human"], permadeath: false });
  });

  it("[SCN-5] reads cast names too, and refuses a person who is not in the cast, an @human aggressor and an unknown key", () => {
    expect(compileSceneDrama({ may_target: [["Ana Clara", "Bia"]] }, CAST).drama?.may_target).toEqual([["ana", "bia"]]);
    expect(compileSceneDrama({ may_target: [["ana", "zed"]] }, CAST).errors.map((e) => e.path)).toEqual(["drama.may_target[0][1]"]);
    expect(compileSceneDrama({ may_target: [["@human", "bia"]] }, CAST).errors.map((e) => e.path)).toEqual(["drama.may_target[0][0]"]);
    expect(compileSceneDrama({ hug: true }, CAST).errors.map((e) => e.path)).toEqual(["drama.hug"]);
  });

  it("[SCN-6] a scene that can kill and authors no cut warns drama.no_scene_cut; one that authors a cut does not", () => {
    expect(compileSceneDrama({ may_die: ["bia"] }, CAST, { sceneCuts: 0 }).warnings.map((w) => w.message.split(":")[0])).toEqual(["drama.no_scene_cut"]);
    expect(compileSceneDrama({ may_die: ["bia"] }, CAST, { sceneCuts: 1 }).warnings).toEqual([]);
  });
});

describe("the presets through the authoring service", () => {
  it("lists the five among the Portuguese presets", async () => {
    const keys = (await service(true).presets()).presets.map((p) => p.key);
    for (const k of KEYS) expect(keys).toContain(k);
  });

  it.each(KEYS)("%s compiles, and its body carries the scene's drama block in agent ids", async (key) => {
    const { source } = await service(true).preset(key);
    const { body } = service(true).compile({ source });
    const ids = body.config.agents.map((a) => a.id);
    expect(body.drama).toBeDefined();
    for (const [a, v] of body.drama!.may_target) {
      expect(ids).toContain(a);
      expect(v === "@human" || ids.includes(v)).toBe(true);
    }
    for (const id of body.drama!.may_die) expect(ids).toContain(id);
    const parsed = parseScenarioBody(JSON.parse(JSON.stringify(body)));
    expect(parsed.ok ? parsed.body.drama : undefined).toEqual(body.drama);
  });

  it("[SCN-5] the blocks are the ones the scenes were written with", async () => {
    const drama = async (key: string) => service(true).compile({ source: (await service(true).preset(key)).source }).body.drama;
    expect(await drama("tapa-na-cara")).toEqual({ max_rung: 4, may_target: [["beatriz", "ricardo"]], may_die: [], permadeath: false });
    expect(await drama("assassinato-na-festa")).toEqual({ max_rung: 6, may_target: [["ricardo", "otavio"]], may_die: ["otavio"], permadeath: false });
    expect(await drama("reencontro-abraco")).toEqual({ max_rung: 0, may_target: [], may_die: [], permadeath: false });
  });

  it("[SCN-6] the murder scene authors its cut, so it validates with no drama.no_scene_cut; with the sidecar's drama off every preset says drama.disabled", async () => {
    const murder = (await service(true).preset("assassinato-na-festa")).source;
    expect(service(true).validate({ source: murder })).toEqual({ ok: true, errors: [], warnings: [] });
    const off = service(false).validate({ source: murder });
    expect(off.ok).toBe(true);
    expect(off.warnings.map((w) => w.message.split(":")[0])).toEqual(["drama.disabled"]);
  });

  it("[SCN-5] a bad block in the frontmatter fails the compile with its path, as a form's would", async () => {
    const murder = (await service(true).preset("assassinato-na-festa")).source.replace("max_rung: 6", "max_rung: 9");
    const v = service(true).validate({ source: murder });
    expect(v.ok).toBe(false);
    expect(v.errors.map((e) => e.path)).toEqual(["drama.max_rung"]);
    expect(() => service(true).compile({ source: murder })).toThrow(AuthoringError);
  });

  it("the older presets carry no drama block and compile to a body without one", async () => {
    const { source } = await service(true).preset("gato-no-telhado");
    const { body } = service(true).compile({ source });
    expect(body.drama).toBeUndefined();
    expect(service(false).validate({ source }).warnings).toEqual([]);
  });
});
