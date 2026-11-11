/**
 * cinematic: the cinematic score of a run (arc, dialogue, embodiment, camera, engagement), 0-100, every part explained.
 *
 *   pnpm --filter @perfectman/eval cinematic --run <run dir> [--json] [--judge off|mock|llm] [--model id] [--norms file] [--write-replay] [--require-climax]
 *   pnpm --filter @perfectman/eval cinematic --baseline <runs root> --runs 55-63 [--out-json f.json] [--markdown] [--judge ...]
 *   pnpm --filter @perfectman/eval cinematic --calibrate --grades <file|dir> --runs-root <dir> [--judge mock|llm] [--freeze out.json] [--model id]
 *
 * --judge off (default): the four measured groups only; the overall is "partial" and `deterministic` is the number to compare before and after a change.
 * --judge llm: the engagement judge on a stronger model (CINE_JUDGE_MODEL or --model; key CINE_JUDGE_API_KEY / OPENROUTER_API_KEY; CINE_JUDGE_BASE_URL and
 *   CINE_JUDGE_SESSION_HEADER for OpenCode; cap CINE_JUDGE_MAX_USD, default $0.30 a scene). The judge may not be a model the actors ran on.
 * --judge mock: fixed scores of 3 on every axis, no network. For tests; the engagement number measures nothing.
 * --write-replay: add `cinematic_score` to <run>/replay.json (every other key kept).
 * --require-climax: exit 1 when the run has no physical climax by 4:00.
 *
 * Exit: 0 ok, 1 invariant failed (--require-climax) / calibration not frozen / error, 2 usage or configuration.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import type { DramaJudgeProvider } from "../drama/drama-judge.js";
import {
  ENGAGEMENT_AXES,
  GROUP_NAMES,
  createEngagementProvider,
  createMockEngagementProvider,
  freezeThresholds,
  loadCinemaNorms,
  loadEngagementJudgeConfig,
  loadHumanGrades,
  loadRunBundle,
  scoreBundle,
  sliceBundle,
  writeCinematicToReplay,
  type CinematicScore,
  type CinemaNorms,
  type GroupScore,
  type HumanGrade,
  type JudgedClip,
} from "../cinematic/index.js";

export type CinematicCliDeps = {
  env?: NodeJS.ProcessEnv;
  out?: (text: string) => void;
  err?: (text: string) => void;
  /** Test seam: the model behind `--judge llm`. */
  makeProvider?: (env: NodeJS.ProcessEnv, model?: string) => DramaJudgeProvider;
};

const USAGE = [
  "Usage:",
  "  cinematic --run <run dir> [--json] [--judge off|mock|llm] [--model id] [--norms file] [--write-replay] [--require-climax]",
  "  cinematic --baseline <runs root> --runs 55-63 [--out-json file] [--markdown] [--judge off|mock|llm]",
  "  cinematic --calibrate --grades <file|dir> --runs-root <dir> [--judge mock|llm] [--freeze out.json] [--model id]",
  "Judge: CINE_JUDGE_MODEL (or --model), CINE_JUDGE_API_KEY / OPENROUTER_API_KEY, CINE_JUDGE_BASE_URL, CINE_JUDGE_SESSION_HEADER, CINE_JUDGE_MAX_USD (default 0.30).",
  "Norms: --norms file, CINEMA_NORMS_FILE, or docs/eval/cinema-norms.json when it exists; otherwise priors + script-norms.",
].join("\n");

/** "55-63" or "55,57,60-62" to a sorted list. */
export function parseRunList(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(",")) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
    if (!m) throw new Error(`bad run list "${spec}" (expected 55-63 or 55,57,60-62)`);
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (b < a || b - a > 1000) throw new Error(`bad range ${part}`);
    for (let n = a; n <= b; n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const f1 = (v: number | null): string => (v === null ? "-" : v.toFixed(1));

export function formatReport(s: CinematicScore): string {
  const out: string[] = [];
  const head = s.score === null ? "no score" : `${s.score.toFixed(1)}/100`;
  out.push(`run ${s.run} (${mmss(s.durationS)}): cinematic ${head}${s.partial ? ` PARTIAL, ${s.missing.join(" + ")} not scored (deterministic ${f1(s.deterministic)})` : ""}${s.capped ? `, capped from ${f1(s.raw)} (no climax by ${mmss(s.invariants.climaxByDeadline.deadlineS)})` : ""}`);
  const c = s.invariants.climaxByDeadline;
  out.push(`  physical climax by ${mmss(c.deadlineS)}: ${c.pass ? "PASS" : "FAIL"} (${c.reason})`);
  out.push(`  groups: ${GROUP_NAMES.map((n) => `${n} ${f1(s.groups[n].score)}${s.weights[n] !== undefined ? ` (w ${s.weights[n]}%)` : ""}`).join(" | ")}`);
  for (const n of GROUP_NAMES) {
    const g = s.groups[n];
    const low = g.readings.filter((r) => r.score !== null && r.score < 60 && r.weight > 0).sort((a, b) => a.score! - b.score!);
    if (low.length > 0) out.push(`  ${n} weak: ${low.slice(0, 4).map((r) => `${r.metric} ${r.score} (${r.note})`).join("; ")}`);
    if (g.score === null) out.push(`  ${n}: not scored (${String(g.detail["reason"] ?? "no data")})`);
  }
  out.push(`  norms: ${s.norms.origin} (${s.norms.fromCinemaNorms} metrics from cinema norms, ${s.norms.priors} priors)`);
  if (s.engagement) out.push(`  engagement judge ${s.engagement.judge}${s.engagement.mock ? " (MOCK: measures nothing)" : ""}: mean ${s.engagement.mean}/5${s.engagement.notes ? ` - ${s.engagement.notes}` : ""}`);
  return out.join("\n");
}

export type BaselineRow = {
  run: string;
  durationS: number;
  score: number | null;
  deterministic: number | null;
  groups: Record<string, number | null>;
  climax: { pass: boolean; atS: number | null; verb: string | null };
  acts: number;
  lines: number;
  scriptLikeness: number | null;
};

export function baselineRow(s: CinematicScore): BaselineRow {
  const det = s.groups.dialogue.detail["scriptLikeness"] as { score?: number } | undefined;
  return {
    run: s.run,
    durationS: s.durationS,
    score: s.score,
    deterministic: s.deterministic,
    groups: Object.fromEntries(GROUP_NAMES.map((n) => [n, s.groups[n].score])),
    climax: { pass: s.invariants.climaxByDeadline.pass, atS: s.invariants.climaxByDeadline.atS, verb: s.invariants.climaxByDeadline.verb },
    acts: Number(s.groups.embodiment.detail["acts"] ?? 0),
    lines: Number(s.groups.dialogue.detail["lines"] ?? 0),
    scriptLikeness: det?.score ?? null,
  };
}

export function baselineMarkdown(rows: BaselineRow[]): string {
  const head = "| run | length | lines | acts | climax by 4:00 | arc | dialogue | embodiment | camera | deterministic | script-likeness |\n|---|---|---|---|---|---|---|---|---|---|---|";
  const body = rows.map(
    (r) =>
      `| ${r.run} | ${mmss(r.durationS)} | ${r.lines} | ${r.acts} | ${r.climax.pass ? `pass (${r.climax.verb} ${mmss(r.climax.atS!)})` : r.climax.atS === null ? "fail (none)" : `fail (${r.climax.verb} ${mmss(r.climax.atS)})`} | ${f1(r.groups["arc"] ?? null)} | ${f1(r.groups["dialogue"] ?? null)} | ${f1(r.groups["embodiment"] ?? null)} | ${f1(r.groups["camera"] ?? null)} | ${f1(r.deterministic)} | ${f1(r.scriptLikeness)} |`,
  );
  return `${head}\n${body.join("\n")}`;
}

export async function runCinematicCli(args: string[], deps: CinematicCliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((s: string): void => void process.stdout.write(s));
  const err = deps.err ?? ((s: string): void => void process.stderr.write(s));
  const fail = (code: number, message: string): number => {
    err(`${message}\n`);
    return code;
  };
  const value = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const json = args.includes("--json");

  const judgeMode = value("--judge") ?? "off";
  if (!["off", "mock", "llm"].includes(judgeMode)) return fail(2, `--judge must be off, mock or llm, got "${judgeMode}"`);
  const model = value("--model");

  let norms: CinemaNorms;
  try {
    norms = loadCinemaNorms(value("--norms"), env);
  } catch (e) {
    return fail(2, e instanceof Error ? e.message : String(e));
  }

  let provider: DramaJudgeProvider | undefined;
  let meterOf: (() => { spentUsd: number; calls: number }) | undefined;
  if (judgeMode === "mock") provider = createMockEngagementProvider(3);
  else if (judgeMode === "llm") {
    try {
      if (deps.makeProvider) provider = deps.makeProvider(env, model);
      else {
        const config = loadEngagementJudgeConfig(env, model ? { model } : {});
        if (!config.apiKey && /openrouter\.ai/.test(config.baseUrl)) throw new Error("the judge needs an API key: set CINE_JUDGE_API_KEY or OPENROUTER_API_KEY (or point CINE_JUDGE_BASE_URL at another endpoint)");
        const made = createEngagementProvider(config);
        provider = made.provider;
        meterOf = () => made.meter;
      }
    } catch (e) {
      return fail(2, e instanceof Error ? e.message : String(e));
    }
  }
  const judgeFor = (extra: { fromS?: number; toS?: number } = {}) =>
    provider ? { provider, mock: judgeMode === "mock", ...(env["CINE_ACTOR_MODELS"] ? { actorModels: env["CINE_ACTOR_MODELS"].split(",").map((m) => m.trim()).filter(Boolean) } : {}), ...extra } : undefined;

  try {
    // ---- one run
    const runDir = value("--run");
    if (runDir !== undefined) {
      const bundle = loadRunBundle(runDir);
      const judge = judgeFor();
      const score = await scoreBundle(bundle, { norms, ...(judge ? { judge } : {}) });
      if (args.includes("--write-replay") && !writeCinematicToReplay(runDir, score)) err(`no replay.json in ${runDir}: nothing written\n`);
      out(json ? `${JSON.stringify(score, null, 2)}\n` : `${formatReport(score)}\n`);
      if (meterOf) err(`judge spend: $${meterOf().spentUsd.toFixed(4)} in ${meterOf().calls} call(s)\n`);
      return args.includes("--require-climax") && !score.invariants.climaxByDeadline.pass ? 1 : 0;
    }

    // ---- baseline over a list of runs
    const root = value("--baseline");
    if (root !== undefined) {
      const spec = value("--runs");
      if (!spec) return fail(2, `--baseline needs --runs\n${USAGE}`);
      const rows: BaselineRow[] = [];
      const full: CinematicScore[] = [];
      for (const n of parseRunList(spec)) {
        const dir = join(root, String(n));
        if (!existsSync(dir)) {
          err(`run ${n}: ${dir} does not exist, skipped\n`);
          continue;
        }
        const judge = judgeFor();
        const score = await scoreBundle(loadRunBundle(dir), { norms, ...(judge ? { judge } : {}) });
        full.push(score);
        rows.push(baselineRow(score));
      }
      const doc = { version: "cinematic-baseline-v1", norms: norms.origin, judge: judgeMode === "off" ? null : judgeMode, runs: full.map((s) => ({ ...baselineRow(s), score: s.score, raw: s.raw, capped: s.capped, groups: s.groups, invariants: s.invariants, weights: s.weights })) };
      const file = value("--out-json");
      if (file) {
        mkdirSync(dirname(resolve(file)), { recursive: true });
        writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
      }
      out(args.includes("--markdown") ? `${baselineMarkdown(rows)}\n` : json ? `${JSON.stringify(doc, null, 2)}\n` : `${rows.map((r) => `run ${r.run}: deterministic ${f1(r.deterministic)} | arc ${f1(r.groups["arc"] ?? null)} dialogue ${f1(r.groups["dialogue"] ?? null)} embodiment ${f1(r.groups["embodiment"] ?? null)} camera ${f1(r.groups["camera"] ?? null)} | climax ${r.climax.pass ? "pass" : "FAIL"}`).join("\n")}\n`);
      return 0;
    }

    // ---- calibration against human grades
    if (args.includes("--calibrate")) {
      const gradesPath = value("--grades");
      const runsRoot = value("--runs-root");
      if (!gradesPath || !runsRoot) return fail(2, `--calibrate needs --grades and --runs-root\n${USAGE}`);
      if (judgeMode === "off") return fail(2, "--calibrate needs --judge mock or llm (the engagement judge is what is calibrated)");
      const humans = loadHumanGrades(gradesPath);
      const clips = [...new Map(humans.map((h) => [h.clipId, h])).values()];
      const judged = new Map<string, JudgedClip>();
      const scores = new Map<string, { overall: number | null; deterministic: number | null }>();
      let judgeName: string | undefined;
      for (const g of clips) {
        if (g.run === undefined) return fail(2, `grade "${g.clipId}" has no "run": cannot tell which run it was cut from`);
        const dir = /^\d+$/.test(g.run) ? join(runsRoot, g.run) : isAbsolute(g.run) ? g.run : resolve(runsRoot, g.run);
        let bundle = loadRunBundle(dir);
        if (g.fromS !== undefined || g.toS !== undefined) bundle = sliceBundle(bundle, g.fromS ?? 0, g.toS ?? bundle.durationS);
        const judge = judgeFor();
        const s = await scoreBundle(bundle, { norms, ...(judge ? { judge } : {}) });
        scores.set(g.clipId, { overall: s.score, deterministic: s.deterministic });
        if (s.engagement) {
          judgeName = s.engagement.judge;
          const axes = (s.groups.engagement.readings as GroupScore["readings"]).reduce<JudgedClip>((acc, r) => {
            if ((ENGAGEMENT_AXES as readonly string[]).includes(r.metric) && r.value !== null) acc[r.metric as (typeof ENGAGEMENT_AXES)[number]] = r.value;
            return acc;
          }, {});
          judged.set(g.clipId, axes);
        }
      }
      const frozen = freezeThresholds({ humans, judged, scores, ...(judgeName ? { judge: judgeName } : {}), normsOrigin: norms.origin });
      const target = value("--freeze");
      if (target) {
        mkdirSync(dirname(resolve(target)), { recursive: true });
        writeFileSync(target, `${JSON.stringify(frozen, null, 2)}\n`);
      }
      out(json || !target ? `${JSON.stringify(frozen, null, 2)}\n` : `${frozen.status}: ${frozen.reasons.join("; ") || "ok"}; written to ${target}\n`);
      if (judgeMode === "mock") err("NOTE: the mock judge measures nothing; do not freeze real thresholds from this run.\n");
      return frozen.status === "frozen" ? 0 : 1;
    }
  } catch (e) {
    return fail(1, e instanceof Error ? e.message : String(e));
  }
  return fail(2, USAGE);
}

if (process.argv[1]?.endsWith("cinematic.js") || process.argv[1]?.endsWith("cinematic.ts")) {
  runCinematicCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    },
  );
}

export type { HumanGrade };
