/**
 * narrate — reruns every scenario with the live LLM, narrates each scene,
 * and renders the spectator novela page (roleplay.html).
 *
 * Usage (DeepSeek):
 *   PERFECTMAN_LLM_PROVIDER=deepseek \
 *   PERFECTMAN_LLM_API_KEY=sk-... \
 *   pnpm --filter @perfectman/eval narrate [--out docs/eval/evidence/deepseek]
 *
 * Local (Ollama-compatible):
 *   PERFECTMAN_LLM_BASE_URL=http://localhost:11434/v1 PERFECTMAN_LLM_MODEL=qwen3:8b \
 *   pnpm --filter @perfectman/eval narrate
 */

import { writeFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { generateEvidence, evidenceRowToLineInput, type ScenarioEvidence } from "./evidence.js";
import { formatTranscriptLine } from "../transcript/render-transcript.js";
import { narrateTranscript, type Narration } from "../narrator/narrator.js";
import { renderHtmlPage } from "../render/html.js";

/** Loads previously generated evidence JSONs (resumable chunked runs). */
export function loadEvidenceFromDisk(outDir: string): {
  evidence: ScenarioEvidence[];
  novela?: ScenarioEvidence;
} {
  const dir = resolve(outDir, "scenarios");
  const evidence: ScenarioEvidence[] = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith(".json"))) {
    evidence.push(JSON.parse(readFileSync(join(dir, file), "utf8")) as ScenarioEvidence);
  }
  evidence.sort((a, b) => a.scenarioId.localeCompare(b.scenarioId));
  const novelaPath = resolve(outDir, "novela-run.json");
  const novela = readFileSync(novelaPath, "utf8") ? JSON.parse(readFileSync(novelaPath, "utf8")) as ScenarioEvidence : undefined;
  return { evidence, novela };
}

function transcriptText(e: ScenarioEvidence): string {
  // Same canonical line the live narrator path renders (render-transcript.ts).
  return e.transcript
    .map(t => formatTranscriptLine(evidenceRowToLineInput(t), { motives: "model" }))
    .join("\n");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 4,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function runNarrate(opts: {
  out?: string;
  scenarios?: string[];
  fromEvidence?: boolean;
}): Promise<string> {
  const outDir = resolve(opts.out ?? "docs/eval/evidence/deepseek");
  let evidence: ScenarioEvidence[];
  let novela: ScenarioEvidence | undefined;
  if (opts.fromEvidence) {
    ({ evidence, novela } = loadEvidenceFromDisk(outDir));
    if (opts.scenarios && opts.scenarios.length > 0) {
      evidence = evidence.filter(e => opts.scenarios!.includes(e.scenarioId));
    }
  } else {
    ({ evidence, novela } = await generateEvidence({
      out: outDir,
      scenarios: opts.scenarios,
      llmMode: "local",
      novela: true,
    }));
  }

  const narrations: Record<string, Narration> = {};
  const targets = evidence.filter(e => !opts.scenarios || opts.scenarios.includes(e.scenarioId));
  const entries = await mapWithConcurrency(targets, async e => {
    const narration = await narrateTranscript(
      transcriptText(e),
      e.name,
      e.description,
      e.scenarioId,
    );
    return { id: e.scenarioId, narration };
  });
  for (const { id, narration } of entries) {
    narrations[id] = narration;
    console.log(`narrated ${id} [${narration.narrator}]`);
  }

  let novelaNarration: Narration | undefined;
  if (novela) {
    novelaNarration = await narrateTranscript(
      transcriptText(novela),
      novela.name,
      novela.description,
      novela.scenarioId,
    );
    narrations[novela.scenarioId] = novelaNarration;
    console.log(`narrated ${novela.scenarioId} [${novelaNarration.narrator}]`);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    resolve(outDir, "narrations.json"),
    JSON.stringify({ version: "narrations-v1", generatedAt: new Date().toISOString(), narrations }, null, 2),
    "utf8",
  );

  const html = renderHtmlPage({
    evidence,
    narrations,
    novela,
    novelaNarration,
    mode: "deepseek",
    model: process.env.PERFECTMAN_LLM_MODEL ?? "deepseek-chat",
    generatedAt: new Date().toISOString(),
  });
  const htmlPath = resolve(outDir, "roleplay.html");
  writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

export async function main(): Promise<void> {
  const htmlPath = await runNarrate({
    out: argValue("--out"),
    scenarios: argValue("--scenarios")?.split(",").filter(Boolean),
    fromEvidence: args.includes("--from-evidence"),
  });
  console.log(`\nroleplay page written to ${htmlPath}`);
}

if (process.argv[1]?.endsWith("narrate.js") || process.argv[1]?.endsWith("narrate.ts")) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
