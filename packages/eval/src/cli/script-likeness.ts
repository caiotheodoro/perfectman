/**
 * script-likeness: how much a transcript reads like a real script, measured against norms derived from real plays.
 *
 *   pnpm --filter @perfectman/eval script-likeness --run <hotel run dir | events.jsonl | transcript.jsonl | turns.json> [--actors "A,B"] [--lang pt|en] [--json]
 *   pnpm --filter @perfectman/eval script-likeness --fixtures                  the production-style transcripts and summaries (they must score under 60)
 *   pnpm --filter @perfectman/eval script-likeness --validate-corpus <beats.jsonl> [--salts a,b,c]   held-out real beats: the share that reach 80 (local corpus only); --salts repeats it on other held-out sets
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
  validateSalted,
} from "../script-likeness/index.js";
import type { CorpusValidation } from "../script-likeness/index.js";

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
    const beats = readBeats(corpus);
    const v = validateOnCorpus(beats);
    const salts = (value("--salts") ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
    const salted: Array<{ salt: string; v: CorpusValidation }> = salts.map((salt) => ({ salt, v: validateSalted(beats, salt) }));
    if (json) console.log(JSON.stringify({ committed: v, salted }, null, 2));
    else {
      const show = (label: string, x: CorpusValidation): void => {
        console.log(`${label}: ${x.heldOut} held-out real beats`);
        for (const [l, s] of Object.entries(x.byLanguage)) console.log(`  ${l}: ${s.beats} beats, ${s.atLeast80} at ${SCRIPT_LIKE_AT} or over (${pct(s.share)}), median ${s.median}, p10 ${s.p10}, min ${s.min}`);
        console.log(`  all: ${x.total.atLeast80}/${x.total.beats} (${pct(x.total.share)})`);
        console.log(`  whole scenes holding one of them (13+ turns, scored as one run): ${x.scenes.atLeast80}/${x.scenes.scenes} at ${SCRIPT_LIKE_AT} or over (${pct(x.scenes.share)}), median ${x.scenes.median}, p10 ${x.scenes.p10}`);
      };
      show("committed norms", v);
      for (const r of salted) show(`salt "${r.salt}"`, r.v);
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
  const actors = value("--actors")?.split(",").map((x) => x.trim()).filter((x) => x !== "");
  const report = scoreTranscript(run, loadTurns(run, actors ? { actors } : {}), lang ? { language: lang } : {});
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    const s = report.score;
    console.log(`${report.source}`);
    console.log(`script-likeness ${s.score}/100 (${report.verdict}), whole run read next to real ${s.whole.scale === "scene" ? "scenes" : "beats"}, percentile ${s.percentile}; ${s.sayTurns} speech turns (${s.stats.reactions} reactions), ${s.windows.length} window(s) for diagnosis, worst ${s.worst}${s.lowN ? ", too few turns for a verdict" : ""}${s.mediumFallback ? ", medium read as THEATRE" : ""}`);
    console.log(`  sub-scores: ${Object.entries(s.sub).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    for (const [name, sub] of Object.entries(s.whole.sub)) {
      const low = sub?.metrics.filter((m) => m.score < 80) ?? [];
      if (low.length > 0) console.log(`  ${name}: ${low.map((m) => `${m.metric}=${m.value} (limit ${m.good}, zero at ${m.bad}, score ${m.score})`).join("; ")}`);
    }
    for (const h of s.stats.demandLoops) console.log(`  demand loop: ${h.speaker} in ${h.turns.length} turns${h.shared.length > 0 ? ` (${h.shared.join(", ")})` : ""}`);
    for (const h of s.stats.tics) console.log(`  tic: ${h.speaker} says "${h.word}" in ${h.turns.length} turns`);
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
