#!/usr/bin/env node
/**
 * `pnpm --filter @perfectman/hotel bench:latency [-- --n 30 --concurrency 2 --prompt-file f.json]`
 *
 * The D53 allowlist gate, per link of `PERFECTMAN_LLM_CHAIN` (or the legacy single link):
 * measures p50/p95 of each link at the real hotel prompt size, prints a table, and
 * REFUSES a link whose p95 is above 6 s, whose error rate is above 10%, or whose window
 * the prompt does not fit. A model joins the allowlist only through `--allowlist-file`,
 * which is written with the allowed links alone.
 *
 * The prompt is a real rendered one: `fixtures/hotel-prompt.json`, captured from a run of
 * the pt-BR preset `gato-no-telhado` by `pnpm probe:llm` (set `PROBE_PROMPT_OUT`). A link with a
 * compact prompt style (window of 4K or less) is benched with `fixtures/hotel-prompt-compact.json`,
 * captured the same way with `PROBE_STYLE=compact`. With no fixture it falls back to a synthetic
 * prompt of the same size; `--prompt-file` forces one prompt for every link.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { percentile } from "../src/util/stats.ts";
import { linkHeaders, linkInputBudget, linkPromptStyle, parseChain, legacyLink } from "../src/llm/chain-config.ts";
import type { LlmLink } from "../src/llm/chain-config.ts";
import { KNOWN_PRICES } from "../src/llm/chain-config.ts";
import { LLM_P95_BUDGET_MS } from "../src/llm/env.ts";

export type BenchCall = () => Promise<void>;

export type BenchResult = {
  n: number;
  errors: number;
  p50Ms: number | undefined;
  p95Ms: number | undefined;
  maxMs: number | undefined;
};

export type Verdict = { allow: boolean; reason: string };

/** Runs `n` calls with bounded concurrency, timing each with the injected clock. */
export async function runBench(call: BenchCall, n: number, concurrency: number, now: () => number = Date.now): Promise<BenchResult> {
  const times: number[] = [];
  let errors = 0;
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < n) {
      next++;
      const t0 = now();
      try {
        await call();
        times.push(now() - t0);
      } catch {
        errors++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, n) }, worker));
  return { n, errors, p50Ms: percentile(times, 50), p95Ms: percentile(times, 95), maxMs: times.length ? Math.max(...times) : undefined };
}

/** Refuses with fewer than 10 good samples, any error rate over 10%, or p95 above 6 s. */
export function decide(result: BenchResult, budgetMs = LLM_P95_BUDGET_MS): Verdict {
  const ok = result.n - result.errors;
  if (ok < 10) return { allow: false, reason: `only ${ok} successful samples; need at least 10` };
  if (result.errors / result.n > 0.1) return { allow: false, reason: `${result.errors}/${result.n} calls failed` };
  if (result.p95Ms === undefined || result.p95Ms > budgetMs) {
    return { allow: false, reason: `p95 ${result.p95Ms ?? "n/a"} ms is above the ${budgetMs} ms budget` };
  }
  return { allow: true, reason: `p95 ${result.p95Ms} ms <= ${budgetMs} ms` };
}

/** A prompt of the size a hotel pulse sends: 12 agents, 40 events, the body block. */
export function benchPrompt(agents = 12, events = 40): { system: string; user: string } {
  const names = Array.from({ length: agents }, (_, i) => `Person${i + 1}`);
  const lines = Array.from({ length: events }, (_, i) => `[e${i + 1}] ${names[i % agents]}: ${"I keep thinking about what was said earlier, and honestly I am not sure how to feel about it. ".repeat(3)}`);
  const body = names.slice(0, 8).map((n, i) => `- p${i + 1} ${n}: ${i + 1} steps away, standing, facing you.`).join("\n");
  return {
    system:
      "You are a person in a room with others. Stay in character; speak naturally and briefly. " +
      "Reply with one JSON object: intentType, visibleContent, privateMotiveSummary, emotionDrivers, motivationDrivers, body. ".repeat(6),
    user: `People here:\n${names.join(", ")}\n\nRecent events:\n${lines.join("\n")}\n\nYour body and the place:\n${body}\n\nWhat do you do now?`,
  };
}

export type BenchPrompt = { system: string; user: string; inputTokensEstimate: number; source: string };

/** The captured real prompt when there is one, else the synthetic one. `estimate` is chars/4, as the prompt builder counts. */
export function loadPrompt(file: string | undefined): BenchPrompt {
  if (file && existsSync(file)) {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { system?: unknown; user?: unknown };
    if (typeof raw.system === "string" && typeof raw.user === "string") {
      return { system: raw.system, user: raw.user, inputTokensEstimate: Math.ceil((raw.system.length + raw.user.length) / 4), source: file };
    }
    throw new Error(`${file} is not a prompt fixture (system and user strings)`);
  }
  const { system, user } = benchPrompt();
  return { system, user, inputTokensEstimate: Math.ceil((system.length + user.length) / 4), source: "synthetic" };
}

export type LinkBench = BenchResult & {
  link: string;
  model: string;
  promptTokens: number;
  budget: number;
  fits: boolean;
  jsonOkPct: number | undefined;
  costUsd: number;
  verdict: Verdict;
};

/** Times `n` real calls to one link with the given prompt. A call that gets any non-2xx answer is an error. */
export async function benchLink(
  link: LlmLink,
  prompt: BenchPrompt,
  o: { n: number; concurrency: number; key: string | undefined; sessionId: string; fetchImpl?: typeof fetch; now?: () => number; ignoreFit?: boolean },
): Promise<LinkBench> {
  const doFetch = o.fetchImpl ?? ((i: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(i, init));
  const budget = linkInputBudget(link);
  const fits = prompt.inputTokensEstimate <= budget;
  const price = KNOWN_PRICES[link.model];
  let json = 0;
  let judged = 0;
  let cost = 0;
  const call: BenchCall = async () => {
    const res = await doFetch(`${link.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...linkHeaders(link, o.sessionId), ...(o.key ? { authorization: `Bearer ${o.key}` } : {}) },
      body: JSON.stringify({
        model: link.model,
        messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
        max_tokens: 400,
        temperature: 0.8,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(link.timeoutMs ?? 30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
    judged++;
    try {
      const parsed: unknown = JSON.parse(data.choices?.[0]?.message?.content ?? "");
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json++;
    } catch {
      /* counted as not valid */
    }
    cost += typeof data.usage?.cost === "number" ? data.usage.cost : price ? ((data.usage?.prompt_tokens ?? 0) * price.inUsdPerMTok + (data.usage?.completion_tokens ?? 0) * price.outUsdPerMTok) / 1e6 : 0;
  };
  const result = await runBench(call, o.n, o.concurrency, o.now);
  const latency = decide(result);
  const verdict: Verdict = !fits
    ? { allow: false, reason: `prompt ${prompt.inputTokensEstimate} est. tokens does not fit the ${budget} budget${o.ignoreFit ? `; latency alone: ${latency.reason}` : ""}` }
    : latency;
  return { ...result, link: link.name, model: link.model, promptTokens: prompt.inputTokensEstimate, budget, fits, jsonOkPct: judged ? Math.round((1000 * json) / judged) / 10 : undefined, costUsd: Math.round(cost * 1e6) / 1e6, verdict };
}

export function formatTable(rows: readonly LinkBench[]): string {
  const head = ["link", "model", "prompt", "budget", "n", "err", "p50 ms", "p95 ms", "max ms", "json %", "cost $", "verdict"];
  const cell = (v: unknown): string => (v === undefined ? "-" : String(v));
  const body = rows.map((r) => [r.link, r.model, r.promptTokens, r.budget, r.n, r.errors, r.p50Ms, r.p95Ms, r.maxMs, r.jsonOkPct, r.costUsd.toFixed(4), `${r.verdict.allow ? "ALLOW" : "REFUSE"}: ${r.verdict.reason}`].map(cell));
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((b) => b[i]!.length)));
  const line = (cols: string[]): string => cols.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...body.map(line)].join("\n");
}

type Args = { n: number; concurrency: number; promptFile: string | undefined; only: string[]; allowlistFile: string | undefined; ignoreFit: boolean; links: LlmLink[] };

export function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  let links: LlmLink[];
  const model = get("model");
  if (model) {
    // One link from flags: the old interface.
    const baseUrl = get("base-url") ?? env["PERFECTMAN_LLM_BASE_URL"] ?? "";
    if (!baseUrl) throw new Error("--base-url or PERFECTMAN_LLM_BASE_URL is required with --model");
    links = [legacyLink(baseUrl, get("key-env") ?? "PERFECTMAN_LLM_API_KEY", model)];
  } else if (env["PERFECTMAN_LLM_CHAIN"]) {
    const problems: string[] = [];
    links = parseChain(env["PERFECTMAN_LLM_CHAIN"], problems);
    if (problems.length > 0) throw new Error(problems.join("; "));
  } else if (env["PERFECTMAN_LLM_BASE_URL"] && env["PERFECTMAN_LLM_MODELS"]) {
    links = env["PERFECTMAN_LLM_MODELS"].split(",").map((m) => m.trim()).filter(Boolean).map((m) => legacyLink(env["PERFECTMAN_LLM_BASE_URL"]!, "PERFECTMAN_LLM_API_KEY", m));
  } else throw new Error("set PERFECTMAN_LLM_CHAIN (or PERFECTMAN_LLM_BASE_URL and PERFECTMAN_LLM_MODELS, or pass --model and --base-url)");
  const only = (get("link") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const allowlistFile = get("allowlist-file");
  return {
    n: Number(get("n") ?? 30),
    concurrency: Number(get("concurrency") ?? 2),
    promptFile: get("prompt-file") ?? env["PERFECTMAN_BENCH_PROMPT"],
    only,
    allowlistFile,
    ignoreFit: argv.includes("--ignore-fit"),
    links: only.length > 0 ? links.filter((l) => only.includes(l.name)) : links,
  };
}

export async function runCli(argv: string[], env: NodeJS.ProcessEnv, log: (line: string) => void, fetchImpl?: typeof fetch): Promise<number> {
  const args = parseArgs(argv, env);
  if (args.links.length === 0) throw new Error("no link matches --link");
  const fixture = (name: string): string => new URL(`../fixtures/${name}`, import.meta.url).pathname;
  const full = loadPrompt(args.promptFile ?? fixture("hotel-prompt.json"));
  const compact = args.promptFile ? full : loadPrompt(existsSync(fixture("hotel-prompt-compact.json")) ? fixture("hotel-prompt-compact.json") : fixture("hotel-prompt.json"));
  const promptFor = (link: LlmLink): BenchPrompt => (linkPromptStyle(link) === "compact" ? compact : full);
  log(`prompt: ${full.source}, ${full.inputTokensEstimate} est. tokens${compact === full ? "" : `; compact links: ${compact.source}, ${compact.inputTokensEstimate} est. tokens`}; ${args.n} calls per link, concurrency ${args.concurrency}`);
  const rows: LinkBench[] = [];
  for (const link of args.links) {
    const key = env[link.apiKeyEnv];
    const prompt = promptFor(link);
    if (!key) {
      rows.push({ link: link.name, model: link.model, n: 0, errors: 0, p50Ms: undefined, p95Ms: undefined, maxMs: undefined, promptTokens: prompt.inputTokensEstimate, budget: linkInputBudget(link), fits: false, jsonOkPct: undefined, costUsd: 0, verdict: { allow: false, reason: `${link.apiKeyEnv} is not set` } });
      continue;
    }
    rows.push(await benchLink(link, prompt, { n: args.n, concurrency: args.concurrency, key, sessionId: `bench-${Date.now()}`, ignoreFit: args.ignoreFit, ...(fetchImpl ? { fetchImpl } : {}) }));
  }
  log(formatTable(rows));
  const allowed = rows.filter((r) => r.verdict.allow);
  for (const r of rows.filter((x) => !x.verdict.allow)) log(`REFUSED ${r.link} (${r.model}): ${r.verdict.reason}`);
  if (args.allowlistFile) {
    const existing = existsSync(args.allowlistFile) ? readFileSync(args.allowlistFile, "utf8").split("\n").map((l) => l.trim()) : [];
    for (const r of allowed) if (!existing.includes(r.model)) appendFileSync(args.allowlistFile, `${r.model}\n`);
    if (allowed.length > 0) log(`ALLOWED: ${allowed.map((r) => r.model).join(", ")} written to ${args.allowlistFile}`);
  } else if (allowed.length > 0) log(`ALLOWED: ${allowed.map((r) => r.model).join(", ")}`);
  return allowed.length > 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2), process.env, (l) => console.log(l)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
