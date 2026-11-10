/**
 * script-likeness: how much a transcript reads like a real script, measured against norms derived from real plays.
 *
 *   pnpm --filter @perfectman/eval script-likeness --run <hotel run dir | events.jsonl | turns.json> [--lang pt|en] [--json]
 *   pnpm --filter @perfectman/eval script-likeness --fixtures                  the three production-style transcripts (they must score under 60)
 *   pnpm --filter @perfectman/eval script-likeness --validate-corpus <beats.jsonl>   held-out real beats: the share that reach 80 (local corpus only)
 *   pnpm --filter @perfectman/eval script-likeness --guard-rates <beats.jsonl> [--beats 300]  how often the novelty and motif checks would flag real dialogue
 *
 * Deterministic, no network. Exit 1 when `--fixtures` finds a fixture at 60 or over, or `--validate-corpus` finds fewer than 80% of the
 * held-out beats at 80 or over. The norms are `packages/shared/src/script-likeness/script-norms.json`, regenerated from the local corpus
 * with `pnpm --filter @perfectman/kb ... node dist/cli.js export-norms`.
 */
import {
  NOT_SCRIPT_LIKE_BELOW,
  SCRIPT_LIKE_AT,
  guardRatesOnCorpus,
  loadTurns,
  readBeats,
  scoreFixtures,
  scoreTranscript,
  validateOnCorpus,
} from "../script-likeness/index.js";

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

export async function runScriptLikenessCli(args: string[]): Promise<void> {
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const json = args.includes("--json");
  const lang = value("--lang");
  if (lang !== undefined && lang !== "pt" && lang !== "en") {
    console.error(`unknown --lang ${lang} (expected pt|en)`);
    process.exit(2);
  }

  if (args.includes("--fixtures")) {
    const rows = scoreFixtures();
    if (json) console.log(JSON.stringify(rows, null, 2));
    else for (const r of rows) console.log(`${r.id.padEnd(14)} ${String(r.score).padStart(5)}  ${r.verdict.padEnd(16)} ${r.note}  ${JSON.stringify(r.sub)}`);
    if (rows.some((r) => r.score >= NOT_SCRIPT_LIKE_BELOW)) process.exit(1);
    return;
  }

  const corpus = value("--validate-corpus");
  if (corpus) {
    const v = validateOnCorpus(readBeats(corpus));
    if (json) console.log(JSON.stringify(v, null, 2));
    else {
      console.log(`held-out real beats: ${v.heldOut}`);
      for (const [l, s] of Object.entries(v.byLanguage)) console.log(`  ${l}: ${s.beats} beats, ${s.atLeast80} at ${SCRIPT_LIKE_AT} or over (${pct(s.share)}), median ${s.median}, p10 ${s.p10}, min ${s.min}`);
      console.log(`  all: ${v.total.atLeast80}/${v.total.beats} (${pct(v.total.share)})`);
    }
    if (v.total.share < 0.8) process.exit(1);
    return;
  }

  const rates = value("--guard-rates");
  if (rates) {
    const beats = readBeats(rates);
    const count = Number(value("--beats") ?? 150);
    const out = (["pt", "en"] as const).map((l) => ({ lang: l, ...guardRatesOnCorpus(beats, l, { count }) }));
    if (json) console.log(JSON.stringify(out, null, 2));
    else
      for (const r of out)
        console.log(
          `${r.lang}: ${r.beats} beats, ${r.turns} turns, floor ${r.floor.toFixed(3)}: novelty ${r.novelty} (${pct(r.novelty / r.turns)}), motif ${r.motif} (${pct(r.motif / r.turns)}), either ${r.either} (${pct(r.either / r.turns)}), beats with a flag ${r.beatsFlagged}/${r.beats}; over the length cap ${pct(r.overCap / r.turns)} (by design)`,
        );
    return;
  }

  const run = value("--run");
  if (!run) {
    console.error("usage: script-likeness --run <run dir | events.jsonl | turns.json> | --fixtures | --validate-corpus <beats.jsonl> | --guard-rates <beats.jsonl>");
    process.exit(2);
  }
  const report = scoreTranscript(run, loadTurns(run), lang ? { language: lang } : {});
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    const s = report.score;
    console.log(`${report.source}`);
    console.log(`script-likeness ${s.score}/100 (${report.verdict}), percentile ${s.percentile} of real beats; ${s.sayTurns} speech turns, ${s.windows.length} window(s), worst ${s.worst}${s.lowN ? ", too few turns for a verdict" : ""}${s.mediumFallback ? ", medium read as THEATRE" : ""}`);
    console.log(`  sub-scores: ${Object.entries(s.sub).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    for (const [i, w] of s.windows.entries())
      for (const [name, sub] of Object.entries(w.sub)) {
        const low = sub?.metrics.filter((m) => m.score < 80) ?? [];
        if (low.length > 0) console.log(`  window ${i + 1} ${name}: ${low.map((m) => `${m.metric}=${m.value} (worse than ${m.percentile}% of real beats, score ${m.score})`).join("; ")}`);
      }
    for (const h of s.stats.motifs.filter((m) => m.family !== "word")) console.log(`  motif: ${h.key.slice(2)} in ${h.turns.length} turns by ${h.speakers.join(", ")}`);
    if (s.stats.debt.unanswered > 0) console.log(`  ${s.stats.debt.unanswered} of ${s.stats.debt.questions} questions went unanswered`);
  }
}

if (process.argv[1]?.endsWith("script-likeness.js") || process.argv[1]?.endsWith("script-likeness.ts")) {
  runScriptLikenessCli(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
