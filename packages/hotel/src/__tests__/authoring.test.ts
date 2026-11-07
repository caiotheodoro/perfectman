import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { AuthoringServer } from "../authoring/authoring-server.js";
import { AuthoringService } from "../authoring/authoring-service.js";
import { parseBundle } from "../authoring/source-bundle.js";
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
    const ok = (await (await call("/authoring/v1/compile", { body: { source: JSON.stringify(form) } })).json()) as { body: { config: { agents: { displayName?: string; id: string }[] }; looks?: Record<string, { figure: string }> } };
    expect(ok.body.config.agents).toHaveLength(4);
    expect(ok.body.looks).toEqual({ "person-1": { figure: "hd-600-1.hr-515-33" } });
    const dup = { ...form, cast: [form.cast[0], { ...form.cast[1], name: "duda" }] };
    const bad = await call("/authoring/v1/compile", { body: { source: JSON.stringify(dup) } });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: "bad_scenario", errors: [{ message: expect.stringContaining("different name") }] });
    expect(await (await call("/authoring/v1/validate", { body: { source: JSON.stringify(dup) } })).json()).toMatchObject({ ok: false });
  });

  it("drafts a scenario with the mock provider, and the draft compiles", async () => {
    const call = await listen();
    const { source } = (await (await call("/authoring/v1/draft", { body: { brief: "tres amigos num lounge", language: "pt-BR" } })).json()) as { source: string };
    expect(parseBundle(source).personas).toHaveLength(3);
    expect((await call("/authoring/v1/compile", { body: { source } })).status).toBe(200);
    expect((await call("/authoring/v1/draft", { body: { brief: "x" } })).status).toBe(400);
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
    const list = (await (await call("/authoring/v1/presets")).json()) as { presets: { key: string }[] };
    expect(list.presets.length).toBeGreaterThan(0);
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
