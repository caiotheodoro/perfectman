import { fileURLToPath } from "node:url";
import { roomFiles } from "@perfectman/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AuthoringServer } from "../authoring/authoring-server.js";
import { AuthoringService } from "../authoring/authoring-service.js";
import { formToDraft } from "../authoring/scenario-form.js";
import { parseBundle } from "../authoring/source-bundle.js";
import { parseScenarioBody } from "../run/scenario-body.js";
import { TEST_SECRET, compiledScenario } from "../testing/helpers.js";

const llm = { provider: "mock" as const, baseUrl: "", apiKeyEnv: "PERFECTMAN_LLM_API_KEY" as const, models: ["mock"], prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 };

let server: AuthoringServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function listen() {
  server = new AuthoringServer({ service: new AuthoringService({ llm, apiKey: undefined, presetsRoot: fileURLToPath(new URL("../../../../examples/presets", import.meta.url)) }), secret: TEST_SECRET, host: "127.0.0.1", port: 0 });
  const port = await server.listen();
  const call = (path: string, init: { method?: string; body?: unknown; auth?: string | null } = {}) =>
    fetch(`http://127.0.0.1:${port}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: { ...(init.auth === null ? {} : { authorization: `Bearer ${init.auth ?? TEST_SECRET}` }), "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: typeof init.body === "string" ? init.body : JSON.stringify(init.body) }),
    });
  return call;
}

describe("authoring listener", () => {
  it("answers /healthz without a secret and 401s everything else without one", async () => {
    const call = await listen();
    expect((await call("/healthz", { auth: null })).status).toBe(200);
    expect((await call("/authoring/v1/presets", { auth: null })).status).toBe(401);
    expect((await call("/authoring/v1/presets", { auth: "wrong" })).status).toBe(401);
  });

  it("validates a good bundle and reports a bad one with 200 and paths", async () => {
    const call = await listen();
    const { source } = compiledScenario();
    expect(await (await call("/authoring/v1/validate", { body: { source } })).json()).toMatchObject({ ok: true, errors: [] });
    const bad = await (await call("/authoring/v1/validate", { body: { source: "=== file: x.scenario.md ===\nnot a scenario" } })).json();
    expect(bad).toMatchObject({ ok: false });
    expect((bad as { errors: unknown[] }).errors.length).toBeGreaterThan(0);
  });

  it("compiles to a versioned body the run can read, and 422s with errors on bad source", async () => {
    const call = await listen();
    const { source } = compiledScenario();
    const ok = (await (await call("/authoring/v1/compile", { body: { source } })).json()) as { body: { v: number; config: { agents: unknown[] } }; schema_version: number };
    expect(ok.schema_version).toBe(1);
    expect(ok.body.v).toBe(1);
    expect(ok.body.config.agents).toHaveLength(3);
    const res = await call("/authoring/v1/compile", { body: { source: "nope" } });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "bad_scenario" });
    // What compile produced validates as a body too.
    expect(await (await call("/authoring/v1/validate", { body: { body: ok.body } })).json()).toMatchObject({ ok: true });
  });

  it("carries a person's own sample lines from the form into the persona's style examples", () => {
    const { draft } = formToDraft({ title: "Noite", situation: "Um bar.", language: "pt-BR", cast: [
      { name: "Duda", role: "bartender", goal: "Fechar cedo.", lines: ["Hoje não tem fiado, viu?", "  Senta aí, eu já te sirvo.  ", "", "Bar fecha quando eu cansar."] },
      { name: "Rafa", role: "regular", goal: "Fofocar.", lines: "Você não sabe da última?\nAi, ai, ai." },
      { name: "Gabi", role: "newcomer", goal: "Conhecer gente." },
    ] });
    expect(draft.people[0]!.lines).toEqual(["Hoje não tem fiado, viu?", "Senta aí, eu já te sirvo.", "Bar fecha quando eu cansar."]);
    expect(draft.people[1]!.lines).toEqual(["Você não sabe da última?", "Ai, ai, ai."]);
    expect(draft.people[2]!.lines).toBeUndefined();
    const { personas } = roomFiles(draft);
    expect(personas[0]!.text).toContain("- Hoje não tem fiado, viu?");
    expect(personas[0]!.text).not.toContain("Can we hear everyone out");
  });

  it("compiles the builder's form JSON through roomFiles, with looks, and 422s a bad form", async () => {
    const call = await listen();
    const form = {
      title: "Noite no bar", situation: "Quatro amigos no bar depois do trabalho.", language: "pt-BR", mode: "default",
      cast: [
        { name: "Duda", role: "bartender", goal: "Fechar cedo.", voice: "Seca.", look: { figure: "hd-600-1.hr-515-33", effect: "" }, start: "start" },
        { name: "Rafa", role: "skeptic", goal: "Descobrir o segredo.", look: "auto", start: "start" },
        { name: "Gabi", role: "performer", goal: "Chamar atencao.", start: "after 10s" },
        { name: "Leo", role: "", goal: "", start: "start" },
      ],
      stage: { room: 7 },
    };
    expect(await (await call("/authoring/v1/validate", { body: { source: JSON.stringify(form) } })).json()).toMatchObject({ ok: true, errors: [] });
    const ok = (await (await call("/authoring/v1/compile", { body: { source: JSON.stringify(form) } })).json()) as { body: { config: { agents: { displayName?: string; id: string }[] }; looks?: Record<string, { figure: string }>; arrivals?: Record<string, number> } };
    expect(ok.body.config.agents).toHaveLength(4);
    expect(ok.body.looks).toEqual({ "person-1": { figure: "hd-600-1.hr-515-33" } });
    // "after 10s" is carried to the run; "start" leaves the natural stagger
    expect(ok.body.arrivals).toEqual({ "person-3": 10_000 });
    const dup = { ...form, cast: [form.cast[0], { ...form.cast[1], name: "duda" }] };
    const bad = await call("/authoring/v1/compile", { body: { source: JSON.stringify(dup) } });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: "bad_scenario", errors: [{ message: expect.stringContaining("different name") }] });
    expect(await (await call("/authoring/v1/validate", { body: { source: JSON.stringify(dup) } })).json()).toMatchObject({ ok: false });
  });

  it("carries the stage step's rooms into the compiled body, and leaves older forms alone", async () => {
    const call = await listen();
    const base = {
      title: "Noite no bar", situation: "Quatro amigos no bar depois do trabalho.", language: "pt-BR", mode: "default",
      cast: [{ name: "Duda", role: "bartender", goal: "Fechar cedo." }, { name: "Rafa", role: "skeptic", goal: "Descobrir o segredo." }],
    };
    const compile = async (stage: unknown) => {
      const res = (await (await call("/authoring/v1/compile", { body: { source: JSON.stringify({ ...base, stage }) } })).json()) as { body: { stage?: unknown } };
      return res.body.stage;
    };
    const visit = [{ id: 3, name: "Quarto" }, 12, { id: 3 }, { id: -1 }, { id: 1.5 }, { id: 44, name: "  Sala   de   estar " }, "x"];
    expect(await compile({ room: 7, travel: true, visit })).toEqual({ travel: true, rooms: [{ id: 3, name: "Quarto" }, { id: 12 }, { id: 44, name: "Sala de estar" }] });
    expect(await compile({ room: 7, travel: true, visit: [] })).toEqual({ travel: true, rooms: [] });
    expect(await compile({ room: 7, travel: false, visit })).toEqual({ travel: false, rooms: [] });
    // a form from before the list existed: travel on keeps every room the hotel names (no stage in the body)
    expect(await compile({ room: 7, travel: true, hotelRooms: "kitchen: 12" })).toBeUndefined();
    expect(await compile(undefined)).toBeUndefined();
  });

  it("reads a body's stage back, dropping junk, and a body without one has none", () => {
    const { body } = compiledScenario();
    const parse = (stage: unknown) => {
      const p = parseScenarioBody({ ...(body as object), ...(stage === undefined ? {} : { stage }) });
      return p.ok ? p.body.stage : "bad";
    };
    expect(parse({ travel: true, rooms: [{ id: 5, name: "Cozinha" }, { id: "x" }, { id: 5 }] })).toEqual({ travel: true, rooms: [{ id: 5, name: "Cozinha" }] });
    expect(parse({ travel: false, rooms: [{ id: 5 }] })).toEqual({ travel: false, rooms: [] });
    expect(parse({ rooms: [{ id: 5 }] })).toBeUndefined();
    expect(parse(undefined)).toBeUndefined();
  });

  it("drafts a scenario with the mock provider, and the draft compiles", async () => {
    const call = await listen();
    const { source } = (await (await call("/authoring/v1/draft", { body: { brief: "tres amigos num lounge", language: "pt-BR" } })).json()) as { source: string };
    expect(parseBundle(source).personas).toHaveLength(3);
    expect((await call("/authoring/v1/compile", { body: { source } })).status).toBe(200);
    expect((await call("/authoring/v1/draft", { body: { brief: "x" } })).status).toBe(400);
  });

  it("drafts in Portuguese unless English is asked for (the builder is pt-BR first)", async () => {
    const call = await listen();
    const draft = async (language?: string) => ((await (await call("/authoring/v1/draft", { body: { brief: "uma noite no lounge do hotel", ...(language ? { language } : {}) } })).json()) as { source: string }).source;
    expect(await draft()).toMatch(/language: "pt-BR"/);
    expect(await draft("en")).toMatch(/language: "en"/);
  });

  it("assigns looks from the hotel's catalog deterministically", async () => {
    const call = await listen();
    const req = { characters: [{ name: "Duda", traits: "warm" }, { name: "Rafa", traits: "blunt" }], catalog: ["hd-1", "hd-2", "hd-3"] };
    const a = (await (await call("/authoring/v1/autolook", { body: req })).json()) as { looks: { name: string; figure: string }[] };
    const b = (await (await call("/authoring/v1/autolook", { body: req })).json()) as typeof a;
    expect(a).toEqual(b);
    expect(a.looks.every((l) => req.catalog.includes(l.figure))).toBe(true);
  });

  it("lists presets and serves one as a bundle that compiles", async () => {
    const call = await listen();
    const list = (await (await call("/authoring/v1/presets")).json()) as { presets: { key: string; language: string }[] };
    expect(list.presets.length).toBeGreaterThan(0);
    // Only scenes written in Portuguese are offered; the English ones are not surfaced.
    expect(list.presets.every((p) => p.language === "pt-BR")).toBe(true);
    expect(list.presets.map((p) => p.key)).not.toContain("the-slice");
    const key = list.presets[0]?.key ?? "";
    const { source } = (await (await call(`/authoring/v1/presets/${key}`)).json()) as { source: string };
    expect(await (await call("/authoring/v1/validate", { body: { source } })).json()).toMatchObject({ ok: true });
    expect((await call("/authoring/v1/presets/nope")).status).toBe(404);
  });

  it("rejects bodies over 256 KiB and bad JSON", async () => {
    const call = await listen();
    expect((await call("/authoring/v1/validate", { body: "x".repeat(300 * 1024) })).status).toBe(413);
    expect((await call("/authoring/v1/validate", { body: "{not json" })).status).toBe(400);
  });
});
