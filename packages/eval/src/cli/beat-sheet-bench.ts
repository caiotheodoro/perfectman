#!/usr/bin/env node
/**
 * Benchmarks the beat sheet's director step: the same briefs through each candidate model, reporting validity, attempts, cost and latency.
 *
 *   pnpm --filter @perfectman/eval beat-sheet:bench -- --base-url https://openrouter.ai/api/v1 --key-env OPENROUTER_API_KEY \
 *       --models deepseek/deepseek-v4.1-flash,vendor/model-b,vendor/model-c \
 *       [--price vendor/model-b=3,15 ...] [--third confronto-da-traicao] [--runs 1] [--out report.json]
 *   pnpm --filter @perfectman/eval beat-sheet:bench -- --mock          the deterministic sheet, to check the harness (no network, no cost)
 *
 * The key is read from the environment variable named by --key-env and never printed. A model with no --price is assumed to cost $3 / $15 per million tokens, so
 * the $0.30 cap still binds; give real prices for real numbers. Exit 0 whatever the models did: this reports, it does not gate.
 */
import { writeFileSync } from "node:fs";
import { generateBeatSheet } from "@perfectman/hotel/drama";
import type { SheetLink, SheetResult } from "@perfectman/hotel/drama";
import { loadSlimKbFromEnv } from "@perfectman/server/hotel";
import { benchBriefs } from "../bench/sheet-briefs.js";

function flags(args: readonly string[], name: string): string[] {
  const out: string[] = [];
  args.forEach((a, i) => a === `--${name}` && args[i + 1] !== undefined && out.push(args[i + 1]!));
  return out;
}

type Row = { model: string; scene: string; run: number; ok: boolean; reason?: string; attempts: number; cost_usd: number; ms: number; beats?: number; climax_ms?: number; kinds?: Record<string, number>; warnings?: number; detail?: string };

const median = (xs: number[]): number => (xs.length === 0 ? 0 : [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!);

async function main(argv: readonly string[]): Promise<number> {
  const args = argv.filter((a) => a !== "--");
  const mock = args.includes("--mock");
  const baseUrl = flags(args, "base-url")[0] ?? "https://openrouter.ai/api/v1";
  const keyEnv = flags(args, "key-env")[0] ?? "OPENROUTER_API_KEY";
  const models = (flags(args, "models")[0] ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const runs = Number(flags(args, "runs")[0] ?? 1);
  const prices = new Map(flags(args, "price").map((p) => [p.split("=")[0]!, (p.split("=")[1] ?? "").split(",").map(Number)] as const));
  const apiKey = process.env[keyEnv]?.trim();
  if (!mock && (models.length === 0 || !apiKey)) {
    console.error(`usage: beat-sheet:bench -- --models a,b,c [--base-url url] [--key-env ENV] [--price model=in,out] | --mock   (${keyEnv} ${apiKey ? "is set" : "is NOT set"})`);
    return 2;
  }
  const briefs = await benchBriefs(flags(args, "third")[0] ?? "confronto-da-traicao");
  const kb = loadSlimKbFromEnv() ?? null;
  const rows: Row[] = [];
  for (const model of mock ? ["mock"] : models) {
    const p = prices.get(model);
    const link: SheetLink = { name: model, baseUrl, model, apiKey: apiKey ?? "", ...(p && p.length === 2 && p.every(Number.isFinite) ? { price: { inUsdPerMTok: p[0]!, outUsdPerMTok: p[1]! } } : {}) };
    for (const { id, brief } of briefs) {
      for (let run = 1; run <= runs; run += 1) {
        const r: SheetResult = await generateBeatSheet(brief, { links: mock ? [] : [link], mock, kb });
        const kinds: Record<string, number> = {};
        if (r.ok) for (const b of r.sheet.beats) kinds[b.kind] = (kinds[b.kind] ?? 0) + 1;
        rows.push(
          r.ok
            ? { model, scene: id, run, ok: true, attempts: r.attempts, cost_usd: r.cost_usd, ms: r.ms, beats: r.sheet.beats.length, climax_ms: r.sheet.arc.climax_at_ms, kinds, warnings: r.warnings.length }
            : { model, scene: id, run, ok: false, reason: r.reason, attempts: r.attempts, cost_usd: r.cost_usd, ms: r.ms, detail: r.detail.slice(0, 160) },
        );
        const last = rows.at(-1)!;
        console.log(`${model.padEnd(36)} ${id.padEnd(22)} ${last.ok ? "valid" : `FAIL ${last.reason}`}  attempts ${last.attempts}  $${last.cost_usd.toFixed(4)}  ${(last.ms / 1000).toFixed(1)} s${last.beats ? `  ${last.beats} beats, climax ${(last.climax_ms! / 1000).toFixed(0)} s` : ""}`);
      }
    }
  }
  console.log("\nmodel".padEnd(38) + "valid   first-try  mean $   p50 s   max $");
  for (const model of mock ? ["mock"] : models) {
    const mine = rows.filter((r) => r.model === model);
    const valid = mine.filter((r) => r.ok);
    console.log(
      `${model.padEnd(37)} ${`${valid.length}/${mine.length}`.padEnd(7)} ${`${mine.filter((r) => r.ok && r.attempts === 1).length}/${mine.length}`.padEnd(10)} ${(mine.reduce((s, r) => s + r.cost_usd, 0) / Math.max(1, mine.length)).toFixed(4).padEnd(8)} ${(median(mine.map((r) => r.ms)) / 1000).toFixed(1).padEnd(7)} ${Math.max(0, ...mine.map((r) => r.cost_usd)).toFixed(4)}`,
    );
  }
  const out = flags(args, "out")[0];
  if (out) writeFileSync(out, `${JSON.stringify({ at: new Date().toISOString(), baseUrl, models, rows }, null, 2)}\n`);
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  },
);
