#!/usr/bin/env node
/**
 * `pnpm --filter @perfectman/hotel bench:latency -- --model <name>`
 *
 * The D53 allowlist gate: measures p50/p95 of one model at our prompt size
 * (12 agents, 40-event window, the body block) and REFUSES allowlisting above
 * 6 s p95. A model joins `PERFECTMAN_LLM_MODELS` only through this script's
 * `--allowlist-file`, which it will not write on a refusal.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { percentile } from "../util/stats.js";
import { LLM_P95_BUDGET_MS } from "./env.js";

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

type Args = { model: string; n: number; concurrency: number; baseUrl: string; keyEnv: string; allowlistFile?: string };

function parseArgs(argv: string[], env: NodeJS.ProcessEnv): Args {
  const get = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const model = get("model");
  if (!model) throw new Error("--model <name> is required");
  const baseUrl = get("base-url") ?? env["PERFECTMAN_LLM_BASE_URL"] ?? "";
  if (!baseUrl) throw new Error("--base-url or PERFECTMAN_LLM_BASE_URL is required");
  const allowlistFile = get("allowlist-file");
  return {
    model,
    n: Number(get("n") ?? 30),
    concurrency: Number(get("concurrency") ?? 3),
    baseUrl,
    keyEnv: get("key-env") ?? "PERFECTMAN_LLM_API_KEY",
    ...(allowlistFile ? { allowlistFile } : {}),
  };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2), process.env);
  const key = process.env[args.keyEnv];
  const { system, user } = benchPrompt();
  const call: BenchCall = async () => {
    const res = await fetch(`${args.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        max_tokens: 300,
        temperature: 0.8,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await res.json();
  };
  const result = await runBench(call, args.n, args.concurrency);
  const verdict = decide(result);
  console.log(JSON.stringify({ model: args.model, ...result, ...verdict }, null, 2));
  if (!verdict.allow) {
    console.error(`REFUSED: ${verdict.reason}. The model is not added to the allowlist.`);
    return 1;
  }
  if (args.allowlistFile) {
    const existing = existsSync(args.allowlistFile) ? readFileSync(args.allowlistFile, "utf8").split("\n").map((l) => l.trim()) : [];
    if (!existing.includes(args.model)) appendFileSync(args.allowlistFile, `${args.model}\n`);
    console.log(`ALLOWED: ${args.model} written to ${args.allowlistFile}`);
  } else console.log(`ALLOWED: add "${args.model}" to PERFECTMAN_LLM_MODELS`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(2);
    },
  );
}
