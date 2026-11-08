import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { LlmEnv } from "../config.js";
import type { CineConfig } from "../director/cine/types.js";
import type { LlmLink } from "../llm/chain-config.js";
import { LlmGovernor } from "../llm/governor.js";
import { NARRATOR_MAX_OUTPUT_TOKENS, makeNarratorLlm } from "../llm/narrator-llm.js";
import type { Sidecar } from "../sidecar.js";
import type { FakeDirector } from "../testing/fake-director.js";
import { bootSidecar, waitFor } from "../testing/helpers.js";
import { ManualClock } from "../testing/manual-clock.js";

let fake: FakeDirector | undefined;
let sidecar: Sidecar | undefined;
let llm: Server | undefined;

afterEach(async () => {
  await sidecar?.close();
  await fake?.stop();
  await new Promise<void>((r) => (llm ? llm.close(() => r()) : r()));
  sidecar = fake = llm = undefined;
  delete process.env["TEST_NARR_KEY"];
});

const FAST_CINE: Partial<CineConfig> = {
  readingScale: 0.02, introMs: 300, sceneCardMs: 200, fillerAfterMs: 250, fillerMs: 150, minShotMs: 40,
  easeMs: { establishing: 20, two_shot: 20, close_up: 10, tracking: 20, reaction: 10 },
  beatGapMs: 20, cueLeadMs: 10, typingLeadMs: 20, narratorWaitMs: 400, drainMs: 500, pulseMs: 150,
};

const CARD = { title: "Sexta de luz baixa", subtitle: "Duda, Rafa e Gabi", captions: ["Duda ajeita a cadeira e sorri para os outros dois."], idle: ["O ambiente fica em silêncio."] };
const INTENT = JSON.stringify({ intentType: "send_message", visibleContent: "oi, gente!", privateMotiveSummary: "cumprimentar", personTargets: [] });

type Seen = { model: string; maxTokens: number | undefined; responseFormat: unknown; narrator: boolean };

async function serve(narrator: "ok" | "down"): Promise<{ seen: Seen[]; env: LlmEnv }> {
  const seen: Seen[] = [];
  llm = createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      const p = JSON.parse(body || "{}") as { model?: string; max_tokens?: number; response_format?: unknown; messages?: unknown };
      if (p.max_tokens === 1) return void res.writeHead(200, { "content-type": "application/json" }).end("{}");
      const isNarrator = JSON.stringify(p.messages ?? "").includes("You narrate a short film");
      seen.push({ model: p.model ?? "", maxTokens: p.max_tokens, responseFormat: p.response_format, narrator: isNarrator });
      if (isNarrator && narrator === "down") return void res.writeHead(503, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "upstream" } }));
      const content = isNarrator ? JSON.stringify(CARD) : INTENT;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 300, completion_tokens: 40 }, model: p.model }));
    });
  });
  await new Promise<void>((r) => llm?.listen(0, "127.0.0.1", () => r()));
  const addr = llm!.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  process.env["TEST_NARR_KEY"] = "key-narr";
  const chain: LlmLink[] = [{ name: "main", baseUrl: `http://127.0.0.1:${port}/v1`, apiKeyEnv: "TEST_NARR_KEY", model: "main-model" }];
  const env: LlmEnv = { provider: "openai-compatible", baseUrl: chain[0]!.baseUrl, apiKeyEnv: "TEST_NARR_KEY", models: ["main-model"], chain, prices: { "main-model": { inUsdPerMTok: 1, outUsdPerMTok: 2 }, "pick/model": { inUsdPerMTok: 1, outUsdPerMTok: 2 } }, concurrency: 3, softCallsPerMin: 600, softTokensPerHour: 5_000_000 };
  return { seen, env };
}

const titleCard = (f: FakeDirector) => f.received.flatMap((x) => (x.t === "ui_push" && x.ui.k === "card" && x.ui.kind === "title" ? [x.ui] : []))[0];

describe("the cinematic narrator in production wiring (local HTTP, no real model)", () => {
  it("hands the narrator a model call without any injection: the opening card and caption are the model's, written by the run's picked model", async () => {
    const { seen, env } = await serve("ok");
    // No `narratorLlm` option anywhere: bootSidecar -> startSidecar is the production path.
    const b = await bootSidecar({ config: { llm: env }, timing: { cine: FAST_CINE, baseIntervalMs: 60_000 } });
    fake = b.fake;
    sidecar = b.sidecar;
    b.fake.startRun({ run: 7, room: 12, scenarioVersion: 31, mode: "cinematic", model: { id: "pick/model", context: 1_048_576, reasoning: "none" } });
    await waitFor(() => titleCard(b.fake), "the title card", 8000);
    expect(titleCard(b.fake)).toMatchObject({ title: CARD.title, subtitle: CARD.subtitle });
    await waitFor(() => b.fake.received.some((f) => f.t === "ui_push" && f.ui.k === "caption" && f.ui.text === CARD.captions[0]), "the narrator's caption", 4000);

    const asked = seen.filter((s) => s.narrator);
    expect(asked.length).toBeGreaterThan(0);
    // The pick is link 1 but this test has no OpenRouter key, so it fails over to the configured link: the card still arrives.
    // The call is cheap (short answer) and plain text (no intent schema).
    expect(asked[0]).toMatchObject({ model: "main-model" });
    expect(asked[0]!.maxTokens).toBeLessThanOrEqual(NARRATOR_MAX_OUTPUT_TOKENS);
    expect(asked[0]!.responseFormat).toBeUndefined();
    const chain = sidecar.manager?.getRun(7)?.narratorLlmChain();
    expect(chain?.snapshot().links.map((l) => l.name)).toEqual(["pick", "main"]);
    expect(chain?.snapshot().links[0]?.failures).toBeGreaterThan(0);
    expect(chain?.snapshot().links[1]?.served).toBeGreaterThan(0);
    expect(chain?.snapshot().failovers).toBeGreaterThan(0);
  }, 30_000);

  it("keeps the deterministic fallback card when every link fails, and the film goes on", async () => {
    const { seen, env } = await serve("down");
    const b = await bootSidecar({ config: { llm: env }, timing: { cine: FAST_CINE, baseIntervalMs: 60_000 } });
    fake = b.fake;
    sidecar = b.sidecar;
    b.fake.startRun({ run: 8, room: 12, scenarioVersion: 31, mode: "cinematic" });
    const card = await waitFor(() => titleCard(b.fake), "the title card", 8000);
    expect(card.title).not.toBe(CARD.title);
    expect(card.title.length).toBeGreaterThan(0);
    expect(seen.some((s) => s.narrator)).toBe(true);
    expect(sidecar.manager?.getRun(8)?.state).toBe("running");
  }, 30_000);

  it("a mock-provider run has no model to ask: no narrator chain, fallback text", async () => {
    const b = await bootSidecar({ timing: { cine: FAST_CINE } });
    fake = b.fake;
    sidecar = b.sidecar;
    b.fake.startRun({ run: 9, room: 12, scenarioVersion: 31, mode: "cinematic" });
    await waitFor(() => titleCard(b.fake), "the title card", 8000);
    expect(sidecar.manager?.getRun(9)?.narratorLlmChain()).toBeUndefined();
  }, 30_000);
});

describe("makeNarratorLlm", () => {
  const link: LlmLink = { name: "a", baseUrl: "http://llm.test/v1", apiKeyEnv: "K", model: "m" };
  const reply = { content: JSON.stringify(CARD), usage: { inputTokens: 200, outputTokens: 60 }, latencyMs: 10, model: "m" };
  const make = (over: { maxCalls?: number; maxCostUsd?: number; prices?: Record<string, { inUsdPerMTok: number; outUsdPerMTok: number }> } = {}) => {
    const clock = new ManualClock();
    const calls: number[] = [];
    const n = makeNarratorLlm({
      links: [link], clock, runId: 1, governor: new LlmGovernor(clock), prices: over.prices ?? { m: { inUsdPerMTok: 1, outUsdPerMTok: 1 } },
      env: { K: "k" } as NodeJS.ProcessEnv,
      makeProvider: (config) => ({ generateIntent: async () => (calls.push(config.maxOutputTokens), reply) }),
      ...(over.maxCalls !== undefined ? { maxCalls: over.maxCalls } : {}), ...(over.maxCostUsd !== undefined ? { maxCostUsd: over.maxCostUsd } : {}),
    });
    return { n: n!, calls };
  };
  const req = { system: "s", user: "u", maxTokens: 9999 };

  it("has nothing to call without links (the mock provider)", () => {
    const clock = new ManualClock();
    expect(makeNarratorLlm({ links: [], clock, runId: 1, governor: new LlmGovernor(clock), prices: {} })).toBeUndefined();
  });

  it("caps the answer at the narrator's own short limit whatever the request asks", async () => {
    const { n, calls } = make();
    await n.call(req, new AbortController().signal);
    expect(calls).toEqual([NARRATOR_MAX_OUTPUT_TOKENS]);
  });

  it("stops asking once its call budget is spent, and once its cost budget is", async () => {
    const byCount = make({ maxCalls: 2 });
    await byCount.n.call(req, new AbortController().signal);
    await byCount.n.call(req, new AbortController().signal);
    await expect(byCount.n.call(req, new AbortController().signal)).rejects.toThrow(/budget/);
    expect(byCount.calls).toHaveLength(2);

    const byCost = make({ maxCostUsd: 0.0001, prices: { m: { inUsdPerMTok: 1000, outUsdPerMTok: 1000 } } });
    await byCost.n.call(req, new AbortController().signal);
    await expect(byCost.n.call(req, new AbortController().signal)).rejects.toThrow(/budget/);
  });
});
