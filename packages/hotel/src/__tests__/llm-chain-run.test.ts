import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmEnv } from "../config.js";
import type { Sidecar } from "../sidecar.js";
import type { FakeDirector } from "../testing/fake-director.js";
import { bootSidecar, waitFor } from "../testing/helpers.js";
import type { SidecarFrame } from "../director/index.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
let llm: Server | undefined;

afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  await new Promise<void>((r) => (llm ? llm.close(() => r()) : r()));
  sidecar = fake = llm = undefined;
  delete process.env["TEST_LINK_A_KEY"];
  delete process.env["TEST_LINK_B_KEY"];
  delete process.env["OPENROUTER_API_KEY"];
  vi.unstubAllGlobals();
});

type Status = Extract<SidecarFrame, { t: "run_status" }>;
const lastStatus = (f: FakeDirector): Status | undefined => f.received.filter((x): x is Status => x.t === "run_status").at(-1);

describe("a run through the provider chain (local HTTP, no real model)", () => {
  it("fails over from a dead link 1 to link 2, sends the run id to link 2, serves the reply, and reports usage and latency", async () => {
    const seen: Array<{ path: string; session: string | undefined; auth: string | undefined; model: string }> = [];
    const intent = JSON.stringify({ intentType: "send_message", visibleContent: "oi, tudo bem por aqui!", privateMotiveSummary: "responder", personTargets: [] });
    llm = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as { model?: string; max_tokens?: number };
        seen.push({ path: req.url ?? "", session: req.headers["x-opencode-session"] as string | undefined, auth: req.headers["authorization"], model: parsed.model ?? "" });
        if (req.url?.startsWith("/a/")) {
          // Link 1 is up for the health check and down for every real call.
          if (parsed.max_tokens === 1) res.writeHead(200, { "content-type": "application/json" }).end("{}");
          else res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "upstream" } }));
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: intent } }], usage: { prompt_tokens: 1000, completion_tokens: 50 }, model: "model-b" }));
      });
    });
    await new Promise<void>((r) => llm?.listen(0, "127.0.0.1", () => r()));
    const addr = llm.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.env["TEST_LINK_A_KEY"] = "key-a";
    process.env["TEST_LINK_B_KEY"] = "key-b";
    const chain = [
      { name: "a", baseUrl: `http://127.0.0.1:${port}/a/v1`, apiKeyEnv: "TEST_LINK_A_KEY", model: "model-a", maxContextTokens: 4096 },
      { name: "b", baseUrl: `http://127.0.0.1:${port}/b/v1`, apiKeyEnv: "TEST_LINK_B_KEY", model: "model-b", sessionHeader: "x-opencode-session" },
    ];
    const llmEnv: LlmEnv = { provider: "openai-compatible", baseUrl: chain[0]!.baseUrl, apiKeyEnv: "TEST_LINK_A_KEY", models: ["model-a", "model-b"], chain, prices: { "model-b": { inUsdPerMTok: 1, outUsdPerMTok: 2 } }, concurrency: 3, softCallsPerMin: 600, softTokensPerHour: 5_000_000 };
    const b = await bootSidecar({ config: { llm: llmEnv }, timing: { baseIntervalMs: 60_000 } });
    fake = b.fake;
    sidecar = b.sidecar;
    b.fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => lastStatus(b.fake)?.state === "running", "running");
    await waitFor(() => b.fake.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk"), "the cast walking in");

    b.fake.humanSay(12, 9, "Duda, tudo bem?");
    const reply = await waitFor(() => b.fake.chats.find((c) => c.text.includes("tudo bem por aqui")), "the reply served by link 2", 8000);
    expect(reply.text).toContain("oi, tudo bem");
    expect(seen.filter((s) => s.path.startsWith("/b/") && s.session === "7").length).toBeGreaterThan(0);
    expect(seen.filter((s) => s.path.startsWith("/a/") && s.session !== undefined)).toHaveLength(0);
    expect(seen.find((s) => s.path.startsWith("/b/"))).toMatchObject({ auth: "Bearer key-b", model: "model-b" });

    await waitFor(() => (lastStatus(b.fake)?.llm_calls ?? 0) > 0 && lastStatus(b.fake)?.llm_p50_ms !== undefined, "status with the served call");
    const st = lastStatus(b.fake);
    expect(st?.cost_usd).toBeGreaterThan(0);
    expect(st?.tokens_in).toBeGreaterThanOrEqual(1000);
    expect(st?.llm_p95_ms).toBeGreaterThanOrEqual(0);

    const snap = sidecar.manager?.getRun(7)?.llmChain()?.snapshot();
    expect(snap?.links.map((l) => [l.name, l.served > 0])).toEqual([["a", false], ["b", true]]);
    expect(snap?.links[0]?.failures).toBeGreaterThan(0);
    expect(snap?.failovers).toBeGreaterThan(0);

    b.fake.pmCommand(7, 12, "stop");
    await waitFor(() => b.fake.received.find((f) => f.t === "run_end"), "run_end", 6000);
    await waitFor(() => b.http.registered.length > 0, "artifact registration");
    const manifest = JSON.parse(readFileSync(join(b.cfg.dataDir, "runs", "7", "replay.json"), "utf8")) as { counters: Record<string, number>; llm?: unknown };
    expect(manifest.counters).toMatchObject({ llm_served_b: expect.any(Number), llm_failures_a: expect.any(Number), llm_failreason_a_http_503: expect.any(Number) });
    expect(manifest.counters["llm_served_b"]).toBeGreaterThan(0);
    // which model and tier each link was, for an audit that only has the manifest; no pick, so no picked_* fields
    expect(manifest.llm).toEqual({ links: { a: { model: "model-a", tier: "experimental" }, b: { model: "model-b", tier: "recommended" } } });
  }, 20_000);

  it("writes the compact hotel prompt to a 4K link, and logs an addressed line with its addressee's distance for the earshot probe", async () => {
    const systems: string[] = [];
    const intent = JSON.stringify({ intentType: "send_message", visibleContent: "Ei, vem ver isso aqui.", privateMotiveSummary: "quero ele por perto", personTargets: ["person-2"] });
    llm = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as { messages?: Array<{ role: string; content: string }>; max_tokens?: number };
        if (parsed.max_tokens !== 1) systems.push(parsed.messages?.find((m) => m.role === "system")?.content ?? "");
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content: intent } }], usage: { prompt_tokens: 900, completion_tokens: 50 }, model: "small" }));
      });
    });
    await new Promise<void>((r) => llm?.listen(0, "127.0.0.1", () => r()));
    const addr = llm.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.env["TEST_LINK_A_KEY"] = "key-a";
    const chain = [{ name: "small", baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "TEST_LINK_A_KEY", model: "small", maxContextTokens: 4096 }];
    const llmEnv: LlmEnv = { provider: "openai-compatible", baseUrl: chain[0]!.baseUrl, apiKeyEnv: "TEST_LINK_A_KEY", models: ["small"], chain, prices: {}, concurrency: 3, softCallsPerMin: 600, softTokensPerHour: 5_000_000 };
    const b = await bootSidecar({ config: { llm: llmEnv }, timing: { baseIntervalMs: 60_000 } });
    fake = b.fake;
    sidecar = b.sidecar;
    b.fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => lastStatus(b.fake)?.state === "running", "running");
    await waitFor(() => b.fake.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk"), "the cast walking in");

    b.fake.humanSay(12, 9, "Priya, tudo bem?");
    await waitFor(() => b.fake.chats.find((c) => c.text.includes("vem ver isso")), "the addressed line", 8000);
    expect(systems.length).toBeGreaterThan(0);
    expect(systems[0]).toContain("Who you are");
    expect(systems[0]).not.toContain("Public/private difference");

    const run = sidecar.manager?.getRun(7);
    const frames = await waitFor(() => {
      const f = run?.frameLog.frames.filter((x) => x.kind === "chat");
      return f && f.length > 0 ? f : undefined;
    }, "a chat frame");
    expect(frames[0]?.data).toMatchObject({ mode: "say", toRef: "person-2", sameRoom: true });
    expect(Number(frames[0]?.data["distance"])).toBeGreaterThanOrEqual(0);
  }, 20_000);
  it("counts rejected repeats in the run's counters, with every guard counter present", async () => {
    const same = "Mamão, isso tá frio mesmo! Sente aí junto e vamos criar calor de conversa.";
    let modelCalls = 0;
    llm = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as { max_tokens?: number };
        if (parsed.max_tokens !== 1) modelCalls++;
        const intent = JSON.stringify({ intentType: "send_message", visibleContent: same, channelTarget: "", personTargets: [], privateMotiveSummary: "responder" });
        res.writeHead(200, { "content-type": "application/json" }).end(parsed.max_tokens === 1 ? "{}" : JSON.stringify({ choices: [{ message: { content: intent } }], usage: { prompt_tokens: 900, completion_tokens: 50 }, model: "small" }));
      });
    });
    await new Promise<void>((r) => llm?.listen(0, "127.0.0.1", () => r()));
    const addr = llm.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.env["TEST_LINK_A_KEY"] = "key-a";
    const chain = [{ name: "small", baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "TEST_LINK_A_KEY", model: "small", maxContextTokens: 4096 }];
    const llmEnv: LlmEnv = { provider: "openai-compatible", baseUrl: chain[0]!.baseUrl, apiKeyEnv: "TEST_LINK_A_KEY", models: ["small"], chain, prices: {}, concurrency: 3, softCallsPerMin: 600, softTokensPerHour: 5_000_000 };
    const b = await bootSidecar({ config: { llm: llmEnv }, timing: { baseIntervalMs: 60_000 } });
    fake = b.fake;
    sidecar = b.sidecar;
    b.fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => lastStatus(b.fake)?.state === "running", "running");
    await waitFor(() => b.fake.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk"), "the cast walking in");
    await new Promise((r) => setTimeout(r, 600));
    b.fake.humanSay(12, 9, "Duda, tudo bem?");
    await waitFor(() => b.fake.chats.some((c) => c.text === same), "a line said", 8000);
    const callsBefore = modelCalls;
    b.fake.humanSay(12, 9, "Duda, e o bar, abre quando?");
    // The same line again is flagged when its answer arrives and retried once (a turn gets one retry with the script checks on): two calls past the second line.
    await waitFor(() => modelCalls >= callsBefore + 2, "enough calls for a repeat", 10_000);

    b.fake.pmCommand(7, 12, "stop");
    await waitFor(() => b.fake.received.find((f) => f.t === "run_end"), "run_end", 6000);
    await waitFor(() => b.http.registered.length > 0, "artifact registration");
    const manifest = JSON.parse(readFileSync(join(b.cfg.dataDir, "runs", "7", "replay.json"), "utf8")) as { counters: Record<string, number> };
    for (const key of ["llm_guard_repeat_own", "llm_guard_repeat_room", "llm_guard_phrase_loop", "llm_guard_garble", "llm_guard_repeat_blocked", "llm_guard_garble_dropped", "llm_guard_held_repeat", "llm_stall_nudges"]) {
      expect(manifest.counters[key], key).toEqual(expect.any(Number));
    }
    expect(manifest.counters["llm_guard_repeat_own"]).toBeGreaterThan(0);
    expect(manifest.counters["llm_guard_garble"]).toBe(0);
  }, 30_000);
  it("a model that fills channelTarget with an empty string still answers in the room, again and again (run 29: Leo mute for 40 s)", async () => {
    let n = 0;
    llm = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as { max_tokens?: number };
        const intent = JSON.stringify({ intentType: "send_message", visibleContent: `resposta numero ${++n}, bem diferente da outra`, channelTarget: "", personTargets: [], privateMotiveSummary: "responder" });
        res.writeHead(200, { "content-type": "application/json" }).end(parsed.max_tokens === 1 ? "{}" : JSON.stringify({ choices: [{ message: { content: intent } }], usage: { prompt_tokens: 900, completion_tokens: 50 }, model: "small" }));
      });
    });
    await new Promise<void>((r) => llm?.listen(0, "127.0.0.1", () => r()));
    const addr = llm.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.env["TEST_LINK_A_KEY"] = "key-a";
    const chain = [{ name: "small", baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "TEST_LINK_A_KEY", model: "small", maxContextTokens: 4096 }];
    const llmEnv: LlmEnv = { provider: "openai-compatible", baseUrl: chain[0]!.baseUrl, apiKeyEnv: "TEST_LINK_A_KEY", models: ["small"], chain, prices: {}, concurrency: 3, softCallsPerMin: 600, softTokensPerHour: 5_000_000 };
    const b = await bootSidecar({ config: { llm: llmEnv }, timing: { baseIntervalMs: 60_000 } });
    fake = b.fake;
    sidecar = b.sidecar;
    b.fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => lastStatus(b.fake)?.state === "running", "running");
    await waitFor(() => b.fake.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk"), "the cast walking in");
    await new Promise((r) => setTimeout(r, 600));

    const duda = (): number | undefined => b.fake.avatarByRef("person-1")?.id;
    const spoke = (): number => b.fake.chats.filter((c) => c.actor === duda() && c.mode === "say" && c.text.startsWith("resposta numero")).length;
    const before = spoke();
    b.fake.humanSay(12, 9, "Duda, tudo bem?");
    await waitFor(() => spoke() > before, "Duda's answer to the first line", 8000);
    const mid = spoke();
    b.fake.humanSay(12, 9, "Duda, e o bar, abre quando?");
    await waitFor(() => spoke() > mid, "Duda's answer to the second line", 8000);
  }, 25_000);
  it("writes a failover link its own compact prompt when link 1 (the full prompt) answers with a body that is not JSON, instead of skipping it for its window", async () => {
    const hits: Array<{ link: string; system: string }> = [];
    const intent = JSON.stringify({ intentType: "send_message", visibleContent: "oi, estou aqui!", privateMotiveSummary: "responder", personTargets: [] });
    llm = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        const parsed = JSON.parse(body || "{}") as { messages?: Array<{ role: string; content: string }>; max_tokens?: number };
        const link = req.url?.startsWith("/a/") ? "a" : "b";
        if (parsed.max_tokens !== 1) hits.push({ link, system: parsed.messages?.find((m) => m.role === "system")?.content ?? "" });
        if (link === "a" && parsed.max_tokens !== 1) {
          res.writeHead(200, { "content-type": "application/json" }).end("<html>gateway</html>");
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end(parsed.max_tokens === 1 ? "{}" : JSON.stringify({ choices: [{ message: { content: intent } }], usage: { prompt_tokens: 2500, completion_tokens: 50 }, model: "small" }));
      });
    });
    await new Promise<void>((r) => llm?.listen(0, "127.0.0.1", () => r()));
    const addr = llm.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    process.env["TEST_LINK_A_KEY"] = "key-a";
    process.env["TEST_LINK_B_KEY"] = "key-b";
    // Link 1 has no stated window (the full prompt, 6K budget); link 2 is a 4K model that only the compact prompt fits.
    const chain = [
      { name: "a", baseUrl: `http://127.0.0.1:${port}/a/v1`, apiKeyEnv: "TEST_LINK_A_KEY", model: "big" },
      { name: "b", baseUrl: `http://127.0.0.1:${port}/b/v1`, apiKeyEnv: "TEST_LINK_B_KEY", model: "small", maxContextTokens: 4096 },
    ];
    const llmEnv: LlmEnv = { provider: "openai-compatible", baseUrl: chain[0]!.baseUrl, apiKeyEnv: "TEST_LINK_A_KEY", models: ["big", "small"], chain, prices: { big: { inUsdPerMTok: 0, outUsdPerMTok: 0 }, small: { inUsdPerMTok: 0, outUsdPerMTok: 0 } }, concurrency: 3, softCallsPerMin: 600, softTokensPerHour: 5_000_000 };
    const b = await bootSidecar({ config: { llm: llmEnv }, timing: { baseIntervalMs: 60_000 } });
    fake = b.fake;
    sidecar = b.sidecar;
    b.fake.startRun({ run: 7, room: 12, scenarioVersion: 31 });
    await waitFor(() => lastStatus(b.fake)?.state === "running", "running");
    await waitFor(() => b.fake.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk"), "the cast walking in");
    b.fake.humanSay(12, 9, "Duda, tudo bem?");
    await waitFor(() => b.fake.chats.find((c) => c.text.includes("estou aqui")), "the reply served by link 2", 10_000);
    const first = hits.find((h) => h.link === "a");
    const failover = hits.find((h) => h.link === "b");
    expect(first?.system).not.toContain("Who you are");
    expect(failover?.system).toContain("Who you are");
    const snap = sidecar.manager?.getRun(7)?.llmChain()?.snapshot();
    expect(snap?.links[1]).toMatchObject({ served: expect.any(Number), skipped: {} });
    expect(snap?.links[1]?.served).toBeGreaterThan(0);
    expect(snap?.exhausted).toBe(0);
  }, 25_000);
  it("runs on the model the admin picked, an experimental 8B, and the manifest says which model, its tier and the cast it was picked for", async () => {
    const intent = JSON.stringify({ intentType: "send_message", visibleContent: "oi, tudo certo por aqui!", privateMotiveSummary: "responder", personTargets: [] });
    const asked: string[] = [];
    // The pick goes to OpenRouter; no network in a test, so that host (and only that host) is answered here.
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (!String(input).startsWith("https://openrouter.ai/")) return realFetch(input, init);
      const parsed = JSON.parse(String(init?.body)) as { model: string; max_tokens?: number };
      asked.push(parsed.model);
      if (parsed.max_tokens === 1) return new Response("{}", { status: 200 });
      return new Response(JSON.stringify({ choices: [{ message: { content: intent } }], usage: { prompt_tokens: 900, completion_tokens: 40 }, model: parsed.model }), { status: 200, headers: { "content-type": "application/json" } });
    });
    process.env["OPENROUTER_API_KEY"] = "or-test";
    process.env["TEST_LINK_A_KEY"] = "key-a";
    const chain = [{ name: "a", baseUrl: "http://127.0.0.1:9/a/v1", apiKeyEnv: "TEST_LINK_A_KEY", model: "model-a" }];
    const llmEnv: LlmEnv = { provider: "openai-compatible", baseUrl: chain[0]!.baseUrl, apiKeyEnv: "TEST_LINK_A_KEY", models: ["model-a"], chain, prices: { "model-a": { inUsdPerMTok: 0, outUsdPerMTok: 0 }, "sao10k/l3-lunaris-8b": { inUsdPerMTok: 0.04, outUsdPerMTok: 0.05 } }, concurrency: 3, softCallsPerMin: 600, softTokensPerHour: 5_000_000 };
    const b = await bootSidecar({ config: { llm: llmEnv }, timing: { baseIntervalMs: 60_000 } });
    fake = b.fake;
    sidecar = b.sidecar;
    b.fake.startRun({ run: 7, room: 12, scenarioVersion: 31, model: { id: "sao10k/l3-lunaris-8b", context: 8192, price_in: 0.04, price_out: 0.05 } });
    await waitFor(() => lastStatus(b.fake)?.state === "running", "running");
    await waitFor(() => b.fake.received.some((f) => f.t === "actor_cmd" && f.cmd.k === "walk"), "the cast walking in");
    b.fake.humanSay(12, 9, "Duda, tudo bem?");
    await waitFor(() => b.fake.chats.find((c) => c.text.includes("tudo certo por aqui")), "the reply served by the pick", 8000);
    expect(asked).toContain("sao10k/l3-lunaris-8b");

    b.fake.pmCommand(7, 12, "stop");
    await waitFor(() => b.fake.received.find((f) => f.t === "run_end"), "run_end", 6000);
    await waitFor(() => b.http.registered.length > 0, "artifact registration");
    const manifest = JSON.parse(readFileSync(join(b.cfg.dataDir, "runs", "7", "replay.json"), "utf8")) as { counters: Record<string, number>; llm?: { picked_model?: string; picked_tier?: string; picked_actors?: number; links: Record<string, { model: string; tier: string }> } };
    expect(manifest.llm).toMatchObject({ picked_model: "sao10k/l3-lunaris-8b", picked_tier: "experimental", links: { pick: { model: "sao10k/l3-lunaris-8b", tier: "experimental" }, a: { model: "model-a", tier: "recommended" } } });
    expect(manifest.llm?.picked_actors).toBeGreaterThan(0);
    expect(manifest.counters["llm_served_pick"]).toBeGreaterThan(0);
  }, 25_000);
});
