/**
 * Asks the real chain for one cinematic run's opening card and caption (D19), against a fake Director.
 *
 *   set -a; source llm.env; set +a
 *   NARRATOR_PICK=sao10k/l3-lunaris-8b NARRATOR_MAX_USD=0.02 pnpm --filter @perfectman/hotel probe:narrator
 *
 * The actors are never asked (the pulse interval is huge), so the only spend is the narrator's own chain:
 * the picked model is link 1 and `PERFECTMAN_LLM_CHAIN` stays behind it. Fails if the card is the fallback text.
 */
import { describe, expect, it } from "vitest";
import type { LlmEnv } from "../src/config.ts";
import type { CineConfig } from "../src/director/cine/types.ts";
import { KNOWN_PRICES, parseChain } from "../src/llm/chain-config.ts";
import { startSidecar } from "../src/sidecar.ts";
import { FakeDirector } from "../src/testing/fake-director.ts";
import { compiledScenario, fakeHotelHttp, testConfig, TEST_SECRET, waitFor } from "../src/testing/helpers.ts";
import type { Logger } from "../src/util/log.ts";

const env = process.env;
const PICK = env["NARRATOR_PICK"] ?? "sao10k/l3-lunaris-8b";
const MAX_USD = Number(env["NARRATOR_MAX_USD"] ?? 0.02);
/** Only the narrator's own warnings (an unusable reply, a failed link) reach the console. */
const warnings: Logger = { info: () => undefined, error: () => undefined, warn: (msg, data) => console.warn(msg, JSON.stringify(data)) };
const CINE: Partial<CineConfig> = { introMs: 4000, narratorWaitMs: 20_000, pulseMs: 500 };

describe("the narrator against the real chain", () => {
  it("writes a pt-BR opening card and caption through the picked model", async () => {
    const raw = env["PERFECTMAN_LLM_CHAIN"];
    if (!raw) throw new Error("PERFECTMAN_LLM_CHAIN is not set (source the llm.env first)");
    const problems: string[] = [];
    const chain = parseChain(raw, problems);
    if (problems.length) throw new Error(problems.join("; "));
    const prices = { ...KNOWN_PRICES, ...(env["PERFECTMAN_LLM_PRICES"] ? (JSON.parse(env["PERFECTMAN_LLM_PRICES"]) as LlmEnv["prices"]) : {}) };
    const llm: LlmEnv = { provider: "openai-compatible", baseUrl: chain[0]!.baseUrl, apiKeyEnv: chain[0]!.apiKeyEnv, models: chain.map((l) => l.model), chain, prices, concurrency: 3, softCallsPerMin: 60, softTokensPerHour: 100_000 };
    const fake = await FakeDirector.start({ secret: TEST_SECRET, tickMs: 4 });
    fake.addRoom(12);
    fake.addHuman(12, 9, "ana", 6, 5);
    const http = fakeHotelHttp({ 31: compiledScenario().body });
    const sidecar = await startSidecar(testConfig(fake.url, { llm }), { fetchImpl: http.fetchImpl, timing: { baseIntervalMs: 600_000, cine: CINE }, statusIntervalMs: 1000, logger: warnings });
    try {
      await waitFor(() => fake.received.some((f) => f.t === "hello_ack"), "hello_ack", 10_000);
      fake.startRun({ run: 7, room: 12, scenarioVersion: 31, mode: "cinematic", model: { id: PICK, context: 8192, reasoning: "none" } });
      const card = await waitFor(() => fake.received.flatMap((f) => (f.t === "ui_push" && f.ui.k === "card" && f.ui.kind === "title" ? [f.ui] : []))[0], "the title card", 60_000);
      const caption = await waitFor(() => fake.received.flatMap((f) => (f.t === "ui_push" && f.ui.k === "caption" ? [f.ui.text] : []))[0], "the first caption", 20_000);
      const snap = sidecar.manager?.getRun(7)?.narratorLlmChain()?.snapshot();
      const spent = (snap?.links ?? []).reduce((n, l) => n + l.costUsd, 0);
      console.log(JSON.stringify({ card, caption, links: snap?.links.map((l) => ({ name: l.name, model: l.model, calls: l.calls, failures: l.failures, served: l.served, tokensIn: l.tokensIn, tokensOut: l.tokensOut, costUsd: l.costUsd })), spentUsd: spent }, null, 2));
      expect(snap?.links.some((l) => l.served > 0)).toBe(true);
      expect(spent).toBeLessThanOrEqual(MAX_USD);
    } finally {
      await sidecar.close();
      await fake.stop();
    }
  }, 120_000);
});
