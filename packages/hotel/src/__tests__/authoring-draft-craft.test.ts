/**
 * A drafted story that carries a script ships as files the hotel's own loader accepts: the drama block derived from the beats, the beats
 * as acts of the 18 verbs, a cut after a death, and never `@human`. The model is mocked; nothing here calls out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthoringError, AuthoringService } from "../authoring/authoring-service.js";
import { parseBundle } from "../authoring/source-bundle.js";
import { parseScenarioBody } from "../run/scenario-body.js";

const llm = { provider: "openai-compatible" as const, baseUrl: "https://llm.test/v1", apiKeyEnv: "PERFECTMAN_LLM_API_KEY" as const, models: ["m"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 };
const person = (name: string, standing: "high" | "low") => ({ name, role: "connector", goal: `Fazer ${name === "Rocha" ? "a Dalila" : "o Rocha"} responder.`, obstacle: "O outro vira as costas.", method: "insiste, mais perto", standing, flips: standing === "low", voice: "Seca.", lines: ["Olha pra mim.", "Responde.", "Eu conferi."] });
const story = (beats: unknown) => ({ title: "O livro-caixa", situation: "Fim do expediente. A conta não fecha.", language: "pt-BR", people: [person("Rocha", "high"), person("Dalila", "low"), person("Kleber", "low")], beats });
const service = (reply: unknown) => new AuthoringService({ llm, apiKey: "sk-test", fetchImpl: vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status: 200 })) });
/** What the run reads: the compiled body, parsed the way a run parses it. */
const compiled = (svc: AuthoringService, source: string) => {
  const parsed = parseScenarioBody(svc.compile({ source }).body);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  return parsed.body;
};

afterEach(() => vi.restoreAllMocks());

describe("AuthoringService.draft applies the drafting skill", () => {
  it("a kiss: the loader accepts it, rung 2, nobody may die, no warnings of the block", async () => {
    const svc = service(story([{ at: 20, actor: "Rocha", verb: "insult", with: "Dalila" }, { at: 70, actor: "Dalila", verb: "kiss", with: "Rocha" }, { at: 100, actor: "Kleber", verb: "freeze_gasp" }]));
    const { source } = await svc.draft({ brief: "uma contadora e o chefe, fim do expediente", language: "pt-BR" });
    const body = compiled(svc, source);
    expect(body.drama).toEqual({ max_rung: 2, may_target: [], may_die: [], permadeath: false });
    expect(body.beats?.map((b) => (b.kind === "act" ? b.verb : "cut"))).toEqual(["insult", "kiss", "freeze_gasp"]);
    expect(svc.validate({ source }).warnings.filter((w) => /drama\.(beat_vetoed|no_scene_cut)/.test(w.message))).toEqual([]);
    expect(parseBundle(source).personas).toHaveLength(3);
  });

  it("a kill: max_rung 6, one pair, the victim only, an authored skip on the peak, a cut after the death", async () => {
    const svc = service(story([{ at: 20, actor: "Rocha", verb: "insult", with: "Dalila" }, { at: 55, actor: "Dalila", verb: "glare", with: "Rocha" }, { at: 115, actor: "Dalila", verb: "kill", with: "Rocha" }, { at: 150, cut: "o escritório fica em silêncio" }]));
    const { source } = await svc.draft({ brief: "uma contadora e o chefe, fim do expediente" });
    const body = compiled(svc, source);
    expect(body.drama).toEqual({ max_rung: 6, may_target: [["person-2", "person-1"]], may_die: ["person-1"], permadeath: true });
    expect(body.beats?.find((b) => b.kind === "act" && b.verb === "kill")).toMatchObject({ actor: "person-2", with: "person-1", authored_skip: true });
    expect(body.beats?.at(-1)).toMatchObject({ kind: "cut" });
    expect(svc.validate({ source }).warnings.filter((w) => /drama\.(beat_vetoed|no_scene_cut)/.test(w.message))).toEqual([]);
  });

  it("a model that writes a second kill, @human, an unknown verb and a 20 s collision still yields a script the loader takes whole", async () => {
    const svc = service(story([
      { at: 5, actor: "Rocha", verb: "insult", with: "Dalila" },
      { at: 30, actor: "Rocha", verb: "stab", with: "Dalila" },
      { at: 35, actor: "Rocha", verb: "slap", with: "@human" },
      { at: 40, actor: "Dalila", verb: "slap", with: "Rocha" },
      { at: 45, actor: "Dalila", verb: "kill", with: "Rocha" },
      { at: 60, actor: "Kleber", verb: "kill", with: "Dalila" },
    ]));
    const { source } = await svc.draft({ brief: "uma contadora e o chefe, fim do expediente" });
    expect(source).not.toContain("@human");
    const body = compiled(svc, source);
    const acts = (body.beats ?? []).filter((b) => b.kind === "act");
    expect(acts.filter((b) => b.verb === "kill")).toHaveLength(1);
    expect(body.drama?.may_die).toEqual(["person-1"]);
    const physical = acts.filter((b) => ["shove", "slap", "punch", "kill"].includes(b.verb)).map((b) => b.at_ms);
    for (let i = 1; i < physical.length; i += 1) expect(physical[i]! - physical[i - 1]!).toBeGreaterThanOrEqual(20_000);
    expect((body.beats ?? []).some((b) => b.kind === "cut" && b.at_ms > (acts.find((a) => a.verb === "kill")?.at_ms ?? Infinity))).toBe(true);
  });

  it("if the loader refuses the script anyway, the story ships without it (free play) rather than a file that breaks", async () => {
    const svc = service(story([{ at: 20, actor: "Rocha", verb: "insult", with: "Dalila" }, { at: 70, actor: "Dalila", verb: "kiss", with: "Rocha" }]));
    const real: (s: string) => unknown = Reflect.get(svc, "compileSource").bind(svc);
    let calls = 0;
    Reflect.set(svc, "compileSource", (s: string) => {
      calls += 1;
      if (calls === 1) throw new AuthoringError(422, "bad_scenario", "scenario did not compile", [{ path: "beats[1]", message: "refused" }]);
      return real(s);
    });
    const { source } = await svc.draft({ brief: "uma contadora e o chefe, fim do expediente" });
    expect(source).not.toMatch(/drama:|beats:/);
    expect(compiled(svc, source).beats).toBeUndefined();
  });

  it("a story with no physical moment is as before: no drama block, no beats", async () => {
    const svc = service(story([]));
    const { source } = await svc.draft({ brief: "uma contadora e o chefe, fim do expediente" });
    expect(source).not.toMatch(/drama:|beats:/);
    expect(compiled(svc, source).drama).toBeUndefined();
  });
});
