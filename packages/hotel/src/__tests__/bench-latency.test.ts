import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { benchLink, benchPrompt, decide, formatTable, loadPrompt, parseArgs, runBench, runCli } from "../llm/bench-latency.js";
import type { LlmLink } from "../llm/chain-config.js";

/** A scripted clock: each call to now() advances by the next scripted duration. */
function scripted(durations: number[]) {
  let t = 0;
  let i = 0;
  let started = false;
  return {
    now: () => {
      if (!started) {
        started = true;
        return t;
      }
      started = false;
      t += durations[i++ % durations.length] ?? 0;
      return t;
    },
  };
}

describe("D53 allowlist gate", () => {
  it("measures p50 and p95 over the successful calls", async () => {
    const times = Array.from({ length: 20 }, (_, i) => (i + 1) * 100);
    const r = await runBench(async () => undefined, 20, 1, scripted(times).now);
    expect(r).toMatchObject({ n: 20, errors: 0, p50Ms: 1000, p95Ms: 1900 });
  });

  it("allows a model whose p95 is at or under 6 s", () => {
    expect(decide({ n: 30, errors: 0, p50Ms: 2500, p95Ms: 5900, maxMs: 6100 })).toMatchObject({ allow: true });
  });

  it.each([
    [{ n: 30, errors: 0, p50Ms: 3000, p95Ms: 6001, maxMs: 9000 }, /above the 6000 ms budget/],
    [{ n: 30, errors: 6, p50Ms: 1000, p95Ms: 2000, maxMs: 3000 }, /calls failed/],
    [{ n: 8, errors: 0, p50Ms: 1000, p95Ms: 2000, maxMs: 3000 }, /need at least 10/],
  ])("refuses %j", (result, why) => {
    const v = decide(result);
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(why);
  });

  it("builds a prompt of the size a 12-agent pulse sends", () => {
    const { system, user } = benchPrompt(12, 40);
    const approxTokens = (system.length + user.length) / 4;
    expect(approxTokens).toBeGreaterThan(3000);
    expect(user.match(/\[e\d+\]/g)).toHaveLength(40);
  });
});

describe("D53 gate per chain link", () => {
  const MYTHO: LlmLink = { name: "mythomax", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "gryphe/mythomax-l2-13b", maxContextTokens: 4096 };
  const LUNARIS: LlmLink = { name: "lunaris", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "sao10k/l3-lunaris-8b", maxContextTokens: 8192 };
  const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 3000, completion_tokens: 100 } }), { status: 200 });
  const prompt = { system: "s".repeat(4000), user: "u".repeat(8000), inputTokensEstimate: 3000, source: "test" };
  const fixed = (ms: number) => {
    let t = 0;
    let started = false;
    return () => ((started = !started) ? t : (t += ms));
  };

  it("allows a link whose prompt fits and whose p95 is within 6 s, and counts how often it answers valid JSON", async () => {
    const seen: Array<{ model: string; headers: Headers }> = [];
    const fetchImpl: typeof fetch = async (_u, init) => {
      seen.push({ model: (JSON.parse(String(init?.body)) as { model: string }).model, headers: new Headers(init?.headers) });
      return reply(seen.length % 4 === 0 ? "not json" : "{\"intentType\":\"no_op\"}");
    };
    const r = await benchLink(LUNARIS, prompt, { n: 12, concurrency: 1, key: "k", sessionId: "bench-1", fetchImpl, now: fixed(1200) });
    expect(r).toMatchObject({ link: "lunaris", n: 12, errors: 0, p50Ms: 1200, p95Ms: 1200, fits: true, budget: 7168, jsonOkPct: 75 });
    expect(r.verdict.allow).toBe(true);
    expect(seen[0]?.headers.get("x-title")).toBe("CMB");
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer k");
    // 3000 tokens in at $0.04/M and 100 out at $0.05/M, twelve times.
    expect(r.costUsd).toBeCloseTo(12 * (3000 * 0.04 + 100 * 0.05) / 1e6, 6);
  });

  it("refuses a slow link, and a link whose window the prompt does not fit, even when it is fast", async () => {
    const fetchImpl: typeof fetch = async () => reply("{}");
    const slow = await benchLink(LUNARIS, prompt, { n: 12, concurrency: 1, key: "k", sessionId: "s", fetchImpl, now: fixed(7000) });
    expect(slow.verdict).toMatchObject({ allow: false, reason: expect.stringMatching(/p95 7000 ms is above the 6000 ms budget/) });
    // MythoMax at 4096 with its measured tokenizer ratio takes 2720: a 3000-token prompt does not fit.
    const tight = await benchLink({ ...MYTHO, tokenRatio: 1.25 }, prompt, { n: 12, concurrency: 1, key: "k", sessionId: "s", fetchImpl, now: fixed(900), ignoreFit: true });
    expect(tight).toMatchObject({ fits: false, budget: 2720 });
    expect(tight.verdict).toMatchObject({ allow: false, reason: expect.stringMatching(/does not fit the 2720 budget; latency alone: p95 900 ms <= 6000 ms/) });
  });

  it("an HTTP error is an error, and a quota-spent link is refused", async () => {
    const fetchImpl: typeof fetch = async () => new Response("{}", { status: 429 });
    const r = await benchLink(LUNARIS, prompt, { n: 12, concurrency: 1, key: "k", sessionId: "s", fetchImpl, now: fixed(10) });
    expect(r).toMatchObject({ errors: 12 });
    expect(r.verdict.allow).toBe(false);
  });

  it("reads the chain from the env, runs every link, prints a table and writes only the allowed models", async () => {
    const chain = JSON.stringify([MYTHO, LUNARIS]);
    const args = parseArgs(["--n", "10"], { PERFECTMAN_LLM_CHAIN: chain });
    expect(args.links.map((l) => l.name)).toEqual(["mythomax", "lunaris"]);
    expect(parseArgs(["--link", "lunaris"], { PERFECTMAN_LLM_CHAIN: chain }).links.map((l) => l.name)).toEqual(["lunaris"]);
    expect(() => parseArgs([], {})).toThrow(/PERFECTMAN_LLM_CHAIN/);

    const dir = mkdtempSync(join(tmpdir(), "bench-"));
    const file = join(dir, "prompt.json");
    writeFileSync(file, JSON.stringify({ system: prompt.system, user: prompt.user }));
    expect(loadPrompt(file)).toMatchObject({ inputTokensEstimate: 3000, source: file });
    expect(loadPrompt(join(dir, "missing.json")).source).toBe("synthetic");
    const allow = join(dir, "allow.txt");
    const out: string[] = [];
    const code = await runCli(["--n", "10", "--prompt-file", file, "--allowlist-file", allow], { PERFECTMAN_LLM_CHAIN: chain, OR_KEY: "k" }, (l) => out.push(l), async () => reply("{}"));
    expect(code).toBe(0);
    const text = out.join("\n");
    expect(text).toMatch(/link\s+model\s+prompt\s+budget/);
    expect(text).toMatch(/REFUSED mythomax .*does not fit/);
    expect(readFileSync(allow, "utf8")).toBe("sao10k/l3-lunaris-8b\n");
    expect(formatTable([])).toContain("verdict");
  });

  it("benches a compact-style link with the compact prompt, so the 4K link is judged on what it is really sent", async () => {
    const out: string[] = [];
    const code = await runCli(["--n", "10"], { PERFECTMAN_LLM_CHAIN: JSON.stringify([MYTHO, LUNARIS]), OR_KEY: "k" }, (l) => out.push(l), async () => reply("{}"));
    const text = out.join("\n");
    expect(code).toBe(0);
    expect(text).toMatch(/compact links: .*hotel-prompt-compact\.json/);
    expect(text).not.toMatch(/REFUSED mythomax/);
    expect(text).toMatch(/ALLOWED: gryphe\/mythomax-l2-13b, sao10k\/l3-lunaris-8b/);
  });
});
