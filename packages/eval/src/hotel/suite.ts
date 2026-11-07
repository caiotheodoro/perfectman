/**
 * The `hotel` suite: what `bench --suite hotel` and `pnpm hotel` run.
 *  1. Mock canaries (always, offline): the mock actor must be clean and each broken
 *     stub must be caught by the probes built to catch it.
 *  2. Real-model canaries (`mode: "local"`): any OpenAI-compatible actor.
 *  3. A recorded run (`run`): deterministic checks, then the transcript for the judge.
 *  4. Calibration (`calibrate`): the labeled snippets against the rule baseline or the LLM judge.
 * CI runs step 1 only (and the calibration pipeline against the rule baseline in tests).
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { blurtingStub, confessingStub, loadOpenAiActorConfig, mockActor, obedientStub, openAiActor, type ActorFn } from "./actor-adapter.js";
import { formatCalibration, runHotelCalibration, ruleHotelJudge, type HotelCalibrationReport } from "./calibration.js";
import { formatCanaryReport, runCanarySuite, type CanaryReport } from "./canary-suite.js";
import { judgeHotelTranscript, loadHotelJudgeConfig, SpendMeter, type HotelJudgment } from "./hotel-judge.js";
import { buildHotelTranscript } from "./hotel-transcript.js";
import { checkRecordedRun, type RecordedChecks } from "./recorded-checks.js";
import { loadHotelRun } from "./run-artifact.js";

export type HotelSuiteOptions = {
  /** "mock": offline canaries. "local": also run the real actor from HOTEL_ACTOR_* / OPENROUTER_API_KEY. */
  mode?: "mock" | "local";
  run?: string;
  /** "llm" needs OPENROUTER_API_KEY (or HOTEL_JUDGE_API_KEY). */
  judge?: "off" | "rule" | "llm";
  calibrate?: boolean;
  out?: string;
};

/** Each stub breaks one family; the probes of that family must flag it. */
export const STUB_EXPECTATIONS: Array<{ name: string; actor: ActorFn; metric: keyof CanaryReport["byMetric"] }> = [
  { name: "obedient-stub", actor: obedientStub, metric: "canary-compliance" },
  { name: "confessing-stub", actor: confessingStub, metric: "ai-leak" },
  { name: "blurting-stub", actor: blurtingStub, metric: "whisper-leak" },
];

export type HotelSuiteReport = {
  ok: boolean;
  problems: string[];
  mockCanaries: CanaryReport;
  stubs: Array<{ name: string; caught: number; metric: string }>;
  realCanaries?: CanaryReport;
  recorded?: { runId: string; transcriptLines: number; warnings: string[]; checks: RecordedChecks; judgment?: HotelJudgment };
  calibration?: HotelCalibrationReport;
  spentUsd?: number;
};

export async function runHotelSuite(opts: HotelSuiteOptions = {}, log: (s: string) => void = console.log): Promise<HotelSuiteReport> {
  const problems: string[] = [];

  const mockCanaries = await runCanarySuite("mock", mockActor);
  log(formatCanaryReport(mockCanaries));
  if (mockCanaries.failed > 0) problems.push(`mock actor failed ${mockCanaries.failed} canary probes`);
  if (mockCanaries.spoke < mockCanaries.total * 0.8) problems.push("mock actor stayed silent in too many probes, the suite proves little");

  const stubs: HotelSuiteReport["stubs"] = [];
  for (const s of STUB_EXPECTATIONS) {
    const r = await runCanarySuite(s.name, s.actor);
    const caught = r.byMetric[s.metric];
    stubs.push({ name: s.name, caught, metric: s.metric });
    if (caught === 0) problems.push(`${s.name} slipped past ${s.metric}: the probes cannot fail`);
  }
  log(`  broken stubs caught: ${stubs.map((s) => `${s.name} ${s.caught}x ${s.metric}`).join(", ")}`);

  const report: HotelSuiteReport = { ok: true, problems, mockCanaries, stubs };
  let spent = 0;

  if (opts.mode === "local") {
    const cfg = loadOpenAiActorConfig();
    if (!cfg.apiKey) throw new Error("real-model canaries need OPENROUTER_API_KEY (or HOTEL_ACTOR_API_KEY)");
    const actor = openAiActor(cfg);
    const real = await runCanarySuite(cfg.model, actor, { concurrency: 4 });
    spent += actor.meter.spentUsd;
    report.realCanaries = real;
    log(formatCanaryReport(real));
    log(`  actor spend (estimated) $${actor.meter.spentUsd.toFixed(4)} over ${actor.meter.calls} calls`);
    if (real.failed > 0) problems.push(`${cfg.model} failed ${real.failed} canary probes`);
  }

  const judgeCfg = loadHotelJudgeConfig();
  const meter = new SpendMeter(judgeCfg.maxUsd);
  const llmJudge = (text: string): Promise<HotelJudgment> => judgeHotelTranscript(text, judgeCfg, { meter });
  if ((opts.judge === "llm" || opts.calibrate) && opts.judge === "llm" && !judgeCfg.apiKey) {
    throw new Error("--judge llm needs OPENROUTER_API_KEY (or HOTEL_JUDGE_API_KEY)");
  }

  if (opts.run) {
    const run = loadHotelRun(resolve(opts.run));
    const transcript = buildHotelTranscript(run);
    const checks = checkRecordedRun(run);
    log(
      `recorded run ${run.runId}: ${transcript.lines.length} transcript lines, ${checks.actorLines} actor lines, ${checks.humanLines} human lines; ` +
        `canary-compliance ${checks.byMetric["canary-compliance"]} ai-leak ${checks.byMetric["ai-leak"]} whisper-leak ${checks.byMetric["whisper-leak"]} thought-leak ${checks.byMetric["thought-leak"]}`,
    );
    for (const v of checks.violations.slice(0, 10)) log(`  ${v.metric}: ${v.who} ${v.detail}`);
    if (run.warnings.length > 0) log(`  loader warnings: ${run.warnings.slice(0, 5).join("; ")}`);
    const total = checks.violations.length;
    if (total > 0) problems.push(`recorded run ${run.runId} has ${total} deterministic violations`);
    let judgment: HotelJudgment | undefined;
    if (opts.judge === "llm") {
      judgment = await llmJudge(transcript.text);
      log(`  judge ${judgeCfg.model}: ${JSON.stringify(judgment.scores)} (json ${judgment.jsonValid ? "valid" : "INVALID"}, attempts ${judgment.attempts})`);
      log(`  judge scores are reported, not gated, until an axis clears its calibration tier`);
    } else if (opts.judge === "rule") {
      log(`  rule baseline: ${JSON.stringify(ruleHotelJudge(transcript.text))}`);
    }
    report.recorded = { runId: run.runId, transcriptLines: transcript.lines.length, warnings: run.warnings, checks, ...(judgment ? { judgment } : {}) };
  }

  if (opts.calibrate) {
    const useLlm = opts.judge === "llm";
    const calibration = await runHotelCalibration(
      useLlm ? (t) => llmJudge(t) : async (t) => ({ scores: ruleHotelJudge(t), evidence: {}, jsonValid: true, attempts: 1, missingAxes: [] }),
      { judgeName: useLlm ? judgeCfg.model : "rule-baseline" },
    );
    if (useLlm) calibration.spentUsd = meter.spentUsd;
    report.calibration = calibration;
    log(formatCalibration(calibration));
  }
  spent += meter.spentUsd;
  if (spent > 0) report.spentUsd = Math.round(spent * 10000) / 10000;

  report.ok = problems.length === 0;
  for (const p of problems) log(`PROBLEM: ${p}`);
  if (opts.out) {
    const file = resolve(opts.out);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
    log(`report written to ${opts.out}`);
  }
  return report;
}
