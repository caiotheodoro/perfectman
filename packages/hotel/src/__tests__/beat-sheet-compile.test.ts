/**
 * The beat sheet through the authoring pipeline (Contract A): a form's hand-written `beat_sheet` compiled into the body with agent ids and the scene's block
 * widened just enough to cover it, a sheet written by the director step at "Save and start" (the mock here, a fake model in the other cases), kept while the
 * scenario is the same and written again when it changes, never failing the compile, and read back leniently by the sidecar's strict body reader.
 */
import { describe, expect, it, vi } from "vitest";
import { mockBeatSheet } from "@perfectman/shared";
import type { BeatSheet } from "@perfectman/shared";
import { AuthoringError, AuthoringService } from "../authoring/authoring-service.js";
import { defaultSceneDrama } from "../authoring/scenario-drama.js";
import { parseScenarioBody } from "../run/scenario-body.js";
import type { LlmLink } from "../llm/chain-config.js";

const IDS = ["person-1", "person-2", "person-3"];
const NAMES = ["Heloísa", "Otávio", "Renato"];
const cast = IDS.map((id, i) => ({ id, name: NAMES[i]! }));
const llm = (provider: "mock" | "openai-compatible" = "mock", chain?: LlmLink[]) => ({ provider, baseUrl: "https://llm.test/v1", apiKeyEnv: "PERFECTMAN_LLM_API_KEY", models: ["m"], ...(chain ? { chain } : {}), prices: {}, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 });
const form = (extra: Record<string, unknown> = {}, situation = "Depois do enterro, a viúva serve café e o sócio duvida da assinatura."): string =>
  JSON.stringify({
    title: "Sobremesa", situation, language: "pt-BR",
    cast: [{ name: "Heloísa", goal: "Segurar a assinatura." }, { name: "Otávio", goal: "Provar a falsidade." }, { name: "Renato", goal: "Cobrar pelo silêncio." }],
    ...extra,
  });
/** A model's sheet: cast names. */
const byName = (sheet: BeatSheet): Record<string, unknown> => {
  const raw = JSON.parse(JSON.stringify(sheet)) as { beats: Array<Record<string, unknown>> };
  delete (raw as Record<string, unknown>)["generated_by"];
  const nameOf = (id: unknown): unknown => cast.find((c) => c.id === id)?.name ?? id;
  for (const b of raw.beats) {
    for (const k of ["actor", "with", "from"]) if (k in b) b[k] = nameOf(b[k]);
    if (b["kind"] === "reveal" && Array.isArray(b["to"])) b["to"] = b["to"].map(nameOf);
  }
  return raw;
};
const written = (o?: Parameters<typeof mockBeatSheet>[0]["climax"]): Record<string, unknown> => byName(mockBeatSheet({ cast, language: "pt-BR", climax: o }));
type Body = { drama?: { max_rung: number; may_target: Array<[string, string]>; may_die: string[]; permadeath: boolean }; drama_mode?: string; beat_sheet?: BeatSheet; beat_sheet_error?: string; beats?: unknown[] };
const svc = (over: Partial<ConstructorParameters<typeof AuthoringService>[0]> = {}) => new AuthoringService({ llm: llm(), apiKey: undefined, ...over });
const fail = (fn: () => unknown): AuthoringError => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AuthoringError);
    return e as AuthoringError;
  }
  throw new Error("did not throw");
};

describe("a hand-written beat_sheet", () => {
  it("compiles into the body with agent ids, sorted, and a slap sheet leaves the default block as it is", () => {
    const body = svc().compile({ source: form({ beat_sheet: written("slap") }) }).body as Body;
    expect(body.beat_sheet?.beats.length).toBeGreaterThan(20);
    expect(body.beat_sheet?.beats.every((b) => !("actor" in b) || IDS.includes((b as { actor: string }).actor))).toBe(true);
    expect(body.beat_sheet?.arc.climax_at_ms).toBe(170_000);
    // an author's sheet has no origin: the compile never writes one over it
    expect(body.beat_sheet?.generated_by).toBeUndefined();
    expect(body.drama).toEqual(defaultSceneDrama(IDS));
    expect(body.drama_mode).toBe("default");
  });

  it("a kill sheet widens the default block to cover it, and the block is then the sheet's own (no longer 'default')", () => {
    const body = svc().compile({ source: form({ beat_sheet: written("kill") }) }).body as Body;
    expect(body.drama).toMatchObject({ max_rung: 6, may_die: ["person-2"], permadeath: true });
    expect(body.drama?.may_target).toContainEqual(["person-1", "person-2"]);
    expect(body.drama_mode).toBeUndefined();
  });

  it("a block the author wrote is never widened: a sheet beyond it is a compile error with the rows", () => {
    const e = fail(() => svc().compile({ source: form({ beat_sheet: written("kill"), drama: { max_rung: 4 } }) }));
    expect(e.status).toBe(422);
    expect(e.errors?.map((r) => r.message).join(" ")).toMatch(/max_rung/);
    const ok = svc().compile({ source: form({ beat_sheet: written("slap"), drama: { max_rung: 4, may_target: [["Heloísa", "Otávio"]] } }) }).body as Body;
    expect(ok.beat_sheet).toBeDefined();
    expect(ok.drama?.max_rung).toBe(4);
  });

  it("errors name a path: an unknown person, no climax, a climax past 4:00", () => {
    const stranger = written();
    ((stranger["beats"] as Array<Record<string, unknown>>).find((b) => b["kind"] === "act")!)["actor"] = "Fulano";
    expect(fail(() => svc().compile({ source: form({ beat_sheet: stranger }) })).errors?.map((r) => r.path + r.message).join(" ")).toMatch(/beat_sheet\.beats\[\d+\]\.actor.*"Fulano" is not in the cast/);
    const noClimax = written();
    delete ((noClimax["beats"] as Array<Record<string, unknown>>).find((b) => b["climax"] === true)!)["climax"];
    expect(fail(() => svc().compile({ source: form({ beat_sheet: noClimax }) })).errors?.map((r) => r.message).join(" ")).toMatch(/exactly one act has climax:true/);
  });

  it("is exclusive with authored beats, and with drama: off", () => {
    expect(fail(() => svc().compile({ source: form({ beat_sheet: written(), beats: [{ at: 30, actor: "Heloísa", verb: "insult", with: "Otávio" }] }) })).errors?.[0]?.message).toMatch(/two scripts/);
    expect(fail(() => svc().compile({ source: form({ beat_sheet: written(), drama: "off" }) })).errors?.[0]?.message).toMatch(/drama is off/);
  });

  it("validate() reports the sheet's errors and warnings the way it reports a script's", () => {
    const stranger = written();
    ((stranger["beats"] as Array<Record<string, unknown>>).find((b) => b["kind"] === "act")!)["actor"] = "Fulano";
    expect(svc().validate({ source: form({ beat_sheet: stranger }) })).toMatchObject({ ok: false });
    expect(svc().validate({ source: form({ beat_sheet: written() }) })).toMatchObject({ ok: true, errors: [] });
  });
});

describe("compileWithSheet: the director step at Save and start", () => {
  const mocked = () => svc({ sheet: { mode: "mock" } });

  it("writes a sheet for a scene that has none, records where it came from, and the body round-trips through the sidecar's reader", async () => {
    const response = await mocked().compileWithSheet({ source: form() });
    const body = response.body as Body;
    expect(body.beat_sheet?.generated_by).toMatchObject({ model: "mock", mock: true });
    expect(body.beat_sheet?.generated_by?.input_hash).toBeTruthy();
    const wire = JSON.parse(JSON.stringify(body)) as object;
    const parsed = parseScenarioBody(wire);
    expect(parsed.ok && parsed.body.beat_sheet?.arc.climax_at_ms).toBe(170_000);
    expect(svc().validate({ body: wire })).toMatchObject({ ok: true });
  });

  it("is off for the mock provider unless asked, and off with PERFECTMAN_BEAT_SHEET=0", async () => {
    const plain = (await svc().compileWithSheet({ source: form() })).body as Body;
    expect(plain.beat_sheet).toBeUndefined();
    expect(plain.beat_sheet_error).toBeUndefined();
    const off = (await svc({ sheet: { mode: "off" } }).compileWithSheet({ source: form() })).body as Body;
    expect(off.beat_sheet).toBeUndefined();
    const viaEnv = (await svc({ llm: llm("openai-compatible"), env: (n) => (n === "PERFECTMAN_BEAT_SHEET" ? "0" : undefined) }).compileWithSheet({ source: form() })).body as Body;
    expect(viaEnv.beat_sheet).toBeUndefined();
    expect(viaEnv.beat_sheet_error).toBeUndefined();
  });

  it("keeps a saved sheet while the scenario is the same, and writes a new one when the scenario changed", async () => {
    const first = (await mocked().compileWithSheet({ source: form() })).body as Body;
    const saved = first.beat_sheet!;
    const again = (await mocked().compileWithSheet({ source: form({ beat_sheet: saved }) })).body as Body;
    expect(JSON.stringify(again.beat_sheet)).toBe(JSON.stringify(saved));
    const changed = (await mocked().compileWithSheet({ source: form({ beat_sheet: saved }, "Agora o enterro foi ontem e ninguém quer café.") })).body as Body;
    expect(changed.beat_sheet?.generated_by?.input_hash).not.toBe(saved.generated_by?.input_hash);
    // a sheet with no generated_by is the author's and stays whatever else changes
    const hand = written();
    const handBody = (await mocked().compileWithSheet({ source: form({ beat_sheet: hand }, "Outra situação inteira.") })).body as Body;
    expect(handBody.beat_sheet?.beats).toHaveLength(Array.isArray(hand["beats"]) ? hand["beats"].length : -1);
  });

  it("does not write one for a scene with authored beats or drama: off", async () => {
    const withBeats = (await mocked().compileWithSheet({ source: form({ beats: [{ at: 30, actor: "Heloísa", verb: "insult", with: "Otávio" }, { at: 90, cut: "fim" }] }) })).body as Body;
    expect(withBeats.beat_sheet).toBeUndefined();
    const off = (await mocked().compileWithSheet({ source: form({ drama: "off" }) })).body as Body;
    expect(off.beat_sheet).toBeUndefined();
  });

  it("a kill sheet written by the step widens the block, so the compiled body is one the run plays", async () => {
    const kill = JSON.stringify({ ...mockBeatSheet({ cast, language: "pt-BR", climax: "kill" }) });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(byName(JSON.parse(kill) as BeatSheet)) } }], usage: { prompt_tokens: 2000, completion_tokens: 2000 } }), { status: 200 }));
    const chain: LlmLink[] = [{ name: "main", baseUrl: "https://llm.test/v1", apiKeyEnv: "K", model: "m" }];
    const service = new AuthoringService({ llm: { ...llm("openai-compatible", chain), prices: { m: { inUsdPerMTok: 1, outUsdPerMTok: 2 } } }, apiKey: undefined, fetchImpl, env: (n) => (n === "K" ? "sk-1" : undefined), sheet: { kb: null } });
    const body = (await service.compileWithSheet({ source: form() })).body as Body;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(body.beat_sheet?.generated_by).toMatchObject({ model: "m", attempts: 1 });
    expect(body.drama).toMatchObject({ max_rung: 6, may_die: ["person-2"] });
    expect(body.drama_mode).toBeUndefined();
    expect(parseScenarioBody(JSON.parse(JSON.stringify(body))).ok).toBe(true);
    const parsed = parseScenarioBody(JSON.parse(JSON.stringify(body)));
    expect(parsed.ok && parsed.body.beat_sheet?.beats.length).toBeGreaterThan(20);
  });

  it("the same source compiled again keeps its sheet (one model call), and beat_sheet: \"regenerate\" asks for a new roll", async () => {
    const reply = JSON.stringify(byName(mockBeatSheet({ cast, language: "pt-BR" })));
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 2000, completion_tokens: 2000 } }), { status: 200 }));
    const chain: LlmLink[] = [{ name: "main", baseUrl: "https://llm.test/v1", apiKeyEnv: "K", model: "m" }];
    const service = new AuthoringService({ llm: { ...llm("openai-compatible", chain), prices: { m: { inUsdPerMTok: 1, outUsdPerMTok: 2 } } }, apiKey: undefined, fetchImpl, env: (n) => (n === "K" ? "sk-1" : undefined), sheet: { kb: null } });
    const first = (await service.compileWithSheet({ source: form() })).body as Body;
    const second = (await service.compileWithSheet({ source: form() })).body as Body;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(second.beat_sheet)).toBe(JSON.stringify(first.beat_sheet));
    await service.compileWithSheet({ source: form({ beat_sheet: "regenerate" }) });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await service.compileWithSheet({ source: form({}, "Outra situação, outro enterro.") });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("a model that fails never fails the compile: no sheet, and the reason is in the body for the run's beat_sheet_fallback", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("down", { status: 503 }));
    const chain: LlmLink[] = [{ name: "main", baseUrl: "https://llm.test/v1", apiKeyEnv: "K", model: "m" }];
    const service = new AuthoringService({ llm: llm("openai-compatible", chain), apiKey: undefined, fetchImpl, env: (n) => (n === "K" ? "sk-1" : undefined), sheet: { kb: null } });
    const body = (await service.compileWithSheet({ source: form() })).body as Body;
    expect(body.beat_sheet).toBeUndefined();
    expect(body.beat_sheet_error).toMatch(/^http: main: 503/);
    expect(parseScenarioBody(JSON.parse(JSON.stringify(body)))).toMatchObject({ ok: true, body: { beat_sheet_error: expect.stringMatching(/^http/) } });
  });

  it("PERFECTMAN_BEATSHEET_MODEL picks the model: a chain link by model id, else the first link's endpoint with that id, priced from PERFECTMAN_BEATSHEET_PRICE", async () => {
    const seen: Array<{ model: string; auth: string }> = [];
    const fetchImpl = vi.fn<typeof fetch>(async (_u, init) => {
      seen.push({ model: (JSON.parse(String(init?.body)) as { model: string }).model, auth: new Headers(init?.headers).get("authorization") ?? "" });
      return new Response("x", { status: 500 });
    });
    const chain: LlmLink[] = [{ name: "actors", baseUrl: "https://llm.test/v1", apiKeyEnv: "K", model: "small" }, { name: "big", baseUrl: "https://other.test/v1", apiKeyEnv: "K2", model: "large" }];
    const env: Record<string, string> = { K: "sk-1", K2: "sk-2", PERFECTMAN_BEATSHEET_MODEL: "large" };
    const named = new AuthoringService({ llm: llm("openai-compatible", chain), apiKey: undefined, fetchImpl, env: (n) => env[n], sheet: { kb: null } });
    await named.compileWithSheet({ source: form() });
    expect(seen[0]).toEqual({ model: "large", auth: "Bearer sk-2" });
    seen.length = 0;
    env["PERFECTMAN_BEATSHEET_MODEL"] = "vendor/strong-1";
    env["PERFECTMAN_BEATSHEET_PRICE"] = "20,100";
    await named.compileWithSheet({ source: form() });
    expect(seen[0]).toEqual({ model: "vendor/strong-1", auth: "Bearer sk-1" });
    // the override model first, the rest of the chain behind it as failover
    expect(seen.map((x) => x.model)).toEqual(["vendor/strong-1", "small", "large"]);
  });
});

describe("the body's strict read of a sheet", () => {
  const compiled = async (extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> => JSON.parse(JSON.stringify((await svc({ sheet: { mode: "mock" } }).compileWithSheet({ source: form(extra) })).body)) as Record<string, unknown>;

  it("drops a sheet that no longer holds, with the reason, and the run plays the spine", async () => {
    const body = await compiled();
    ((body["beat_sheet"] as { beats: Array<Record<string, unknown>> }).beats.find((b) => b["climax"] === true)!)["at_ms"] = 300_000;
    const parsed = parseScenarioBody(body);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.body.beat_sheet).toBeUndefined();
    expect(parsed.body.beat_sheet_error).toMatch(/^invalid:/);
  });

  it("drops a sheet when the body says drama is off or has authored beats", async () => {
    const off = await compiled();
    off["drama_mode"] = "off";
    const o = parseScenarioBody(off);
    expect(o.ok && o.body.beat_sheet).toBeUndefined();
    expect(o.ok && o.body.beat_sheet_error).toBe("drama is off");
    const beats = await compiled();
    beats["beats"] = [{ id: "b1", at_ms: 30_000, kind: "act", actor: "person-1", verb: "insult", with: "person-2" }];
    const b = parseScenarioBody(beats);
    expect(b.ok && b.body.beat_sheet_error).toBe("the scene has authored beats");
  });

  it("holds the sheet to the body's block: a kill sheet whose block was cut back is dropped", async () => {
    const kill = JSON.parse(JSON.stringify((await svc().compile({ source: form({ beat_sheet: written("kill") }) })).body)) as Record<string, unknown>;
    expect(parseScenarioBody(kill).ok && (parseScenarioBody(kill) as { body: { beat_sheet?: unknown } }).body.beat_sheet).toBeDefined();
    kill["drama"] = { max_rung: 4, may_target: [], may_die: [], permadeath: false };
    const cut = parseScenarioBody(kill);
    expect(cut.ok && cut.body.beat_sheet).toBeUndefined();
    expect(cut.ok && cut.body.beat_sheet_error).toMatch(/max_rung|rung|invalid/);
  });

  it("a body with no sheet reads as it always did", async () => {
    const plain = JSON.parse(JSON.stringify((await svc().compile({ source: form() })).body)) as Record<string, unknown>;
    const parsed = parseScenarioBody(plain);
    expect(parsed.ok && "beat_sheet" in parsed.body).toBe(false);
    expect(parsed.ok && "beat_sheet_error" in parsed.body).toBe(false);
  });
});
