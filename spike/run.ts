import { writeFileSync } from "node:fs";
import { runExperiment, DEFAULT, pct, type Cfg, type Result } from "./harness.js";

const SEEDS = [1, 2, 3, 4, 5];
const LINES_PER_SEED = 200; // => 1000 injected lines per cell
const PROFILES = [
  { name: "A (med 2.5s / p95 6s)", median: 2500, p95: 6000 },
  { name: "B (med 4s / p95 10s)", median: 4000, p95: 10000 },
];
const f = (ms: number) => (ms / 1000).toFixed(1);

type Pooled = {
  bd: { wait: number; gen: number; tex: number; spc: number; noSp50: number; noSp95: number; callsPerMin: number }; label: string; lat: number[]; n: number; busyPct: number; waitP50: number; waitP95: number; unanswered: number; busyMax: number; busyP99: number; eldMax: number; perPulse: number; results: Result[] };

async function pool(label: string, cfg: Partial<Cfg>): Promise<Pooled> {
  const rs: Result[] = [];
  for (const seed of SEEDS) rs.push(await runExperiment({ ...DEFAULT, nLines: LINES_PER_SEED, seed, ...cfg }));
  const lat = rs.flatMap((r) => r.rawLat);
  const waits = rs.flatMap((r) => (r.breakdown ? [r.breakdown.waitToConsultP50] : []));
  const w95 = rs.flatMap((r) => (r.breakdown ? [r.breakdown.waitToConsultP95] : []));
  const avg = (g: (r: Result) => number) => rs.reduce((s, r) => s + g(r), 0) / rs.length;
  return {
    bd: { wait: avg((r) => r.breakdown?.waitToConsultP50 ?? 0), gen: avg((r) => r.breakdown?.genP50 ?? 0), tex: avg((r) => r.breakdown?.typingExtraP50 ?? 0), spc: avg((r) => r.breakdown?.spacingP50 ?? 0), noSp50: pct(rs.map((r) => r.breakdown?.noSpacingP50 ?? NaN), 50), noSp95: pct(rs.map((r) => r.breakdown?.noSpacingP95 ?? NaN), 50), callsPerMin: avg((r) => r.consults.perMin) },
    label, lat, n: lat.length,
    busyPct: rs.reduce((s, r) => s + r.busyAtArrivalPct, 0) / rs.length,
    waitP50: waits.reduce((s, x) => s + x, 0) / waits.length,
    waitP95: w95.reduce((s, x) => s + x, 0) / w95.length,
    unanswered: rs.reduce((s, r) => s + r.unanswered, 0),
    busyMax: Math.max(...rs.map((r) => r.eventLoop.busyMax)),
    busyP99: pct(rs.map((r) => r.eventLoop.busyP99), 50),
    eldMax: Math.max(...rs.map((r) => r.eventLoop.eldMax)),
    perPulse: rs.reduce((s, r) => s + r.consults.perBasePulse, 0) / rs.length,
    results: rs,
  };
}

const out: string[] = [];
const log = (s = "") => { console.log(s); out.push(s); };
const json: Record<string, unknown> = {};

// ---------- Experiment 1: addressed reply latency ----------
type Row = { label: string; cfg: Partial<Cfg> };
const rows: Row[] = [
  { label: "(a) today: sequential PulseScheduler", cfg: { variant: "seq" } },
  { label: "(b) split c=1, focused, debounce 1500 (ADR as written)", cfg: { variant: "split", concurrency: 1, debounceMs: 1500 } },
  { label: "(b) split c=3, focused, debounce 1500 (ADR as written)", cfg: { variant: "split", concurrency: 3, debounceMs: 1500 } },
  { label: "(b) split c=6, focused, debounce 1500 (ADR as written)", cfg: { variant: "split", concurrency: 6, debounceMs: 1500 } },
  { label: "(b') split c=1, debounce 0", cfg: { variant: "split", concurrency: 1, debounceMs: 0 } },
  { label: "(b') split c=3, debounce 0", cfg: { variant: "split", concurrency: 3, debounceMs: 0 } },
  { label: "(b') split c=6, debounce 0", cfg: { variant: "split", concurrency: 6, debounceMs: 0 } },
  { label: "(b') split c=3, debounce 500", cfg: { variant: "split", concurrency: 3, debounceMs: 500 } },
  { label: "(b'') split c=3, debounce 0, early-commit addressed", cfg: { variant: "split_early", concurrency: 3, debounceMs: 0 } },
  { label: "(c) split c=3, debounce 0, parallel focus lane + per-agent locks", cfg: { variant: "split_par", concurrency: 3, debounceMs: 0 } },
  { label: "(c) split c=3, debounce 1500, parallel focus lane + per-agent locks", cfg: { variant: "split_par", concurrency: 3, debounceMs: 1500 } },
  { label: "(d) split c=1, debounce 0, parallel lane + locks + commit-as-complete", cfg: { variant: "split_stream", concurrency: 1, debounceMs: 0 } },
  { label: "(d) split c=3, debounce 0, parallel lane + locks + commit-as-complete", cfg: { variant: "split_stream", concurrency: 3, debounceMs: 0 } },
  { label: "(d) split c=6, debounce 0, parallel lane + locks + commit-as-complete", cfg: { variant: "split_stream", concurrency: 6, debounceMs: 0 } },
  { label: "(d) split c=3, debounce 300, parallel lane + locks + commit-as-complete", cfg: { variant: "split_stream", concurrency: 3, debounceMs: 300 } },
  { label: "(b') split c=3, debounce 0, generateDeadline 8 s (ADR fallback 1)", cfg: { variant: "split", concurrency: 3, debounceMs: 0, deadlineMs: 8000 } },
];
for (const prof of PROFILES) {
  log(`\n### Addressed reply latency, LLM profile ${prof.name}, 12 agents, ~3 ambient consults/base pulse, ${SEEDS.length * LINES_PER_SEED} lines/row\n`);
  log("| variant | p50 s | p95 s | p99 s | p50<=5 | p95<=10 | arrives mid-pulse | consult wait p50/p95 s | p50 parts: wait+gen+typing+spacing s | p50/p95 w/o room spacing | LLM calls/min | unanswered |");
  log("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const p = await pool(r.label, { ...r.cfg, llm: prof });
    const p50 = pct(p.lat, 50), p95 = pct(p.lat, 95), p99 = pct(p.lat, 99);
    log(`| ${r.label} | ${f(p50)} | ${f(p95)} | ${f(p99)} | ${p50 <= 5000 ? "yes" : "NO"} | ${p95 <= 10000 ? "yes" : "NO"} | ${p.busyPct.toFixed(0)}% | ${f(p.waitP50)} / ${f(p.waitP95)} | ${f(p.bd.wait)}+${f(p.bd.gen)}+${f(p.bd.tex)}+${f(p.bd.spc)} | ${f(p.bd.noSp50)} / ${f(p.bd.noSp95)} | ${p.bd.callsPerMin.toFixed(0)} | ${p.unanswered} |`);
    (json[`addr|${prof.name}|${r.label}`] = { p50, p95, p99, busyPct: p.busyPct, waitP50: p.waitP50, waitP95: p.waitP95, unanswered: p.unanswered });
  }
}

// ---------- Experiment 1b: heavier load (6 ambient consults / pulse) ----------
log(`\n### Load sensitivity: profile A, 6 ambient consults per base pulse (busy room)\n`);
log("| variant | p50 s | p95 s | p99 s | arrives mid-pulse | consult wait p50/p95 s |");
log("|---|---|---|---|---|---|");
for (const r of [rows[0]!, rows[2]!, rows[5]!, rows[9]!, rows[12]!]) {
  const p = await pool(r.label, { ...r.cfg, llm: PROFILES[0]!, consultsPerPulse: 6 });
  log(`| ${r.label} | ${f(pct(p.lat, 50))} | ${f(pct(p.lat, 95))} | ${f(pct(p.lat, 99))} | ${p.busyPct.toFixed(0)}% | ${f(p.waitP50)} / ${f(p.waitP95)} |`);
}

// ---------- Experiment 2: dog-pile ----------
log(`\n### Dog-pile rate (>=2 agents answer one unaddressed human line), ${SEEDS.length * LINES_PER_SEED} lines/cell\n`);
log("| LLM profile | variant | arbiter | dog-pile rate | mean answers/line | lines with 0 answers | gate-blocked calls per line |");
log("|---|---|---|---|---|---|---|");
const dpVariants: Array<[string, Partial<Cfg>]> = [
  ["seq (today)", { variant: "seq" }],
  ["split c=1", { variant: "split", concurrency: 1 }],
  ["split c=3", { variant: "split", concurrency: 3 }],
  ["split c=6", { variant: "split", concurrency: 6 }],
];
for (const prof of PROFILES) {
  for (const [vl, vc] of dpVariants) {
    for (const arb of ["none", "adr", "one", "claim"] as const) {
      const rs: Result[] = [];
      for (const seed of SEEDS) rs.push(await runExperiment({ ...DEFAULT, nLines: LINES_PER_SEED, seed, lineKind: "unaddressed", arbiter: arb, llm: prof, ...vc }));
      const counts = rs.flatMap((r) => r.rawAnswers);
      const dog = counts.filter((c) => c >= 2).length / counts.length;
      const mean = counts.reduce((s, c) => s + c, 0) / counts.length;
      const zero = counts.filter((c) => c === 0).length / counts.length;
      const blocked = rs.reduce((s, r) => s + (r.dogpile?.wastedCalls ?? 0), 0) / counts.length;
      log(`| ${prof.name.split(" ")[0]} | ${vl} | ${arb} | ${(100 * dog).toFixed(1)}% | ${mean.toFixed(2)} | ${(100 * zero).toFixed(0)}% | ${blocked.toFixed(2)} |`);
      json[`dog|${prof.name}|${vl}|${arb}`] = { dog, mean, zero, blocked };
    }
  }
}

// dog-pile sensitivity to the agent-behaviour priors (profile A, arbiter one/none, split c=3 vs seq)
log(`\n### Dog-pile sensitivity to priors (profile A): qSee = P(consult on an open line), pFresh/pAnswered = P(speak | no/some answer visible)\n`);
log("| qSee | pFresh/pAnswered | variant | arbiter | dog-pile rate |");
log("|---|---|---|---|---|");
for (const [q, pf, pa] of [[0.15, 0.5, 0.1], [0.35, 0.5, 0.1], [0.35, 0.8, 0.3], [0.6, 0.5, 0.1]] as const) {
  for (const [vl, vc] of [dpVariants[0]!, dpVariants[2]!]) {
    for (const arb of ["none", "one"] as const) {
      const rs: Result[] = [];
      for (const seed of SEEDS) rs.push(await runExperiment({ ...DEFAULT, nLines: LINES_PER_SEED, seed, lineKind: "unaddressed", arbiter: arb, qSee: q, pFresh: pf, pAnswered: pa, llm: PROFILES[0]!, ...vc }));
      const counts = rs.flatMap((r) => r.rawAnswers);
      log(`| ${q} | ${pf}/${pa} | ${vl} | ${arb} | ${(100 * counts.filter((c) => c >= 2).length / counts.length).toFixed(1)}% |`);
    }
  }
}

// ---------- Experiment 1c: sensitivity of the recommended variant ----------
log(`\n### Recommended variant (d) c=3, debounce 0: base interval sweep and no-arbiter ambient chatter, profile A\n`);
log("| base interval s | arbiter | p50 s | p95 s | p99 s | LLM calls/min | consult wait p50/p95 s |");
log("|---|---|---|---|---|---|---|");
for (const [iv, arb] of [[4000, "one"], [5000, "one"], [6000, "one"], [8000, "one"], [5000, "none"]] as const) {
  const p = await pool("d", { variant: "split_stream", concurrency: 3, debounceMs: 0, baseIntervalMs: iv, arbiter: arb, llm: PROFILES[0]! });
  log(`| ${iv / 1000} | ${arb} | ${f(pct(p.lat, 50))} | ${f(pct(p.lat, 95))} | ${f(pct(p.lat, 99))} | ${p.bd.callsPerMin.toFixed(0)} | ${f(p.waitP50)} / ${f(p.waitP95)} |`);
}

// ---------- Experiment 3: event-loop ----------
log(`\n### Event-loop blocking (virtual-time runs, real CPU: real runEngineStep, in-memory repos, no I/O)\n`);
log("| variant | per-instant busy p99 ms | worst single block ms | monitorEventLoopDelay max ms |");
log("|---|---|---|---|");
for (const r of [rows[0]!, rows[2]!, rows[3]!, rows[12]!]) {
  const p = await pool(r.label, { ...r.cfg, llm: PROFILES[0]! });
  log(`| ${r.label} | ${p.busyP99.toFixed(1)} | ${p.busyMax.toFixed(1)} | ${p.eldMax.toFixed(1)} |`);
}

writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(json, null, 1));
writeFileSync(new URL("./tables.md", import.meta.url), out.join("\n") + "\n");
