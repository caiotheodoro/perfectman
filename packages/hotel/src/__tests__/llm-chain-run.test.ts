import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
    const manifest = JSON.parse(readFileSync(join(b.cfg.dataDir, "runs", "7", "replay.json"), "utf8")) as { counters: Record<string, number> };
    expect(manifest.counters).toMatchObject({ llm_served_b: expect.any(Number), llm_failures_a: expect.any(Number) });
    expect(manifest.counters["llm_served_b"]).toBeGreaterThan(0);
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
});
