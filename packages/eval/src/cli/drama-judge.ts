/**
 * drama-judge: a vision + log LLM judge for physical-drama quality.
 *
 *   pnpm --filter @perfectman/eval drama-judge --clip <clip.mp4> --run <run-dir> [--out label.json] [--model id]
 *   pnpm --filter @perfectman/eval drama-judge --calibrate --clips-manifest <manifest.json> --labels <human-labels-dir> --judge-out <dir>
 *
 * The judge model comes from DRAMA_JUDGE_MODEL (or --model); there is no default.
 * Keys come from the variables the hotel judge reads (DRAMA_JUDGE_API_KEY,
 * HOTEL_JUDGE_API_KEY, OPENROUTER_API_KEY). The judge refuses to run when its
 * model is also an actor model (--actor-model, DRAMA_ACTOR_MODELS, the manifest,
 * or the run's replay.json). Exit code: 0 ok / calibration PASS, 1 failure or
 * calibration FAIL, 2 usage or configuration.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import { DEFAULT_HOTEL_JUDGE_BASE_URL, SpendMeter } from "../hotel/hotel-judge.js";
import { formatDramaCalibration, runDramaCalibration } from "../drama/calibration.js";
import type { DramaJudgeProvider } from "../drama/drama-judge.js";
import { judgeClipFromRun } from "../drama/judge-clip.js";
import { createChatCompletionProvider, loadDramaJudgeConfig, type DramaJudgeConfig } from "../drama/judge-provider.js";

export type DramaJudgeCliDeps = {
  env?: NodeJS.ProcessEnv;
  out?: (text: string) => void;
  err?: (text: string) => void;
  /** Test seam: the model behind the judge. Default is the chat-completion provider over the configured endpoint. */
  makeProvider?: (config: DramaJudgeConfig, meter: SpendMeter) => DramaJudgeProvider;
  ffmpegPath?: string;
};

const USAGE = [
  "Usage:",
  "  drama-judge --clip <clip.mp4> --run <run-dir> [--out label.json] [--model id] [--actor-model id]... [--clip-id id] [--clip-start-s n] [--sheets-dir dir]",
  "  drama-judge --calibrate --clips-manifest <manifest.json> --labels <human-labels-dir> --judge-out <dir> [--model id] [--actor-model id]...",
  "Environment: DRAMA_JUDGE_MODEL (judge model, no default), DRAMA_ACTOR_MODELS (comma separated), DRAMA_JUDGE_BASE_URL,",
  "  key from DRAMA_JUDGE_API_KEY, HOTEL_JUDGE_API_KEY or OPENROUTER_API_KEY, DRAMA_JUDGE_MAX_USD (spend cap, default 1),",
  "  DRAMA_JUDGE_MAX_TOKENS (reply limit, default 2500; a cut-off reply is retried once with double, up to 8000), DRAMA_JUDGE_TIMEOUT_MS.",
  "  DRAMA_JUDGE_HEADERS (optional JSON object of extra string headers; Authorization, Content-Type, Host and newlines are refused).",
  "  DRAMA_JUDGE_SESSION_HEADER (optional header name that carries one pm-judge-<random> id for the whole run, e.g. x-opencode-session).",
  "  OpenCode Go: DRAMA_JUDGE_BASE_URL=https://opencode.ai/zen/go/v1 DRAMA_JUDGE_SESSION_HEADER=x-opencode-session",
].join("\n");

function defaultMakeProvider(config: DramaJudgeConfig, meter: SpendMeter): DramaJudgeProvider {
  if (!config.apiKey && config.baseUrl === DEFAULT_HOTEL_JUDGE_BASE_URL) {
    throw new Error("the judge needs an API key: set DRAMA_JUDGE_API_KEY, HOTEL_JUDGE_API_KEY or OPENROUTER_API_KEY (or point DRAMA_JUDGE_BASE_URL at a local endpoint)");
  }
  return createChatCompletionProvider(config, { meter });
}

export async function runDramaJudgeCli(args: string[], deps: DramaJudgeCliDeps = {}): Promise<number> {
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
  const values = (flag: string): string[] => args.flatMap((a, i) => (a === flag && args[i + 1] !== undefined ? [args[i + 1]!] : []));

  const calibrate = args.includes("--calibrate");
  const required = calibrate ? ["--clips-manifest", "--labels", "--judge-out"] : ["--clip", "--run"];
  if (!calibrate && value("--clip") === undefined && value("--run") === undefined) return fail(2, USAGE);
  const missing = required.filter((f) => value(f) === undefined);
  if (missing.length > 0) return fail(2, `missing ${missing.join(", ")}\n${USAGE}`);

  const clipStartRaw = value("--clip-start-s");
  const clipStartS = clipStartRaw === undefined ? undefined : Number(clipStartRaw);
  if (clipStartS !== undefined && !(Number.isFinite(clipStartS) && clipStartS >= 0)) return fail(2, `--clip-start-s must be a number of seconds, got "${clipStartRaw}"`);

  let config: DramaJudgeConfig;
  let provider: DramaJudgeProvider;
  try {
    config = loadDramaJudgeConfig(env, { model: value("--model") });
    provider = (deps.makeProvider ?? defaultMakeProvider)(config, new SpendMeter(config.maxUsd));
  } catch (e) {
    return fail(2, e instanceof Error ? e.message : String(e));
  }

  const actorModels = [...(env["DRAMA_ACTOR_MODELS"] ?? "").split(",").map((m) => m.trim()).filter((m) => m !== ""), ...values("--actor-model")];
  const ffmpeg = deps.ffmpegPath !== undefined ? { ffmpegPath: deps.ffmpegPath } : {};

  try {
    if (calibrate) {
      const report = await runDramaCalibration({
        manifestPath: value("--clips-manifest")!,
        labelsDir: value("--labels")!,
        judgeOutDir: value("--judge-out")!,
        judge: (job, ctx) => judgeClipFromRun({ ...job, actorModels: [...actorModels, ...job.actorModels], sheetsDir: ctx.sheetsDir }, provider, ffmpeg),
      });
      out(`${formatDramaCalibration(report)}\n`);
      return report.pass ? 0 : 1;
    }

    const clipPath = value("--clip")!;
    const clipId = value("--clip-id") ?? basename(clipPath, extname(clipPath));
    const outFile = value("--out");
    const sheetsDir = value("--sheets-dir") ?? (outFile !== undefined ? join(dirname(outFile), `${clipId}-sheets`) : mkdtempSync(join(tmpdir(), "drama-sheets-")));
    const label = await judgeClipFromRun(
      { clipId, clipPath, runDir: value("--run")!, ...(clipStartS !== undefined ? { clipStartS } : {}), actorModels, sheetsDir },
      provider,
      ffmpeg,
    );
    const json = `${JSON.stringify(label, null, 2)}\n`;
    if (outFile !== undefined) {
      mkdirSync(dirname(outFile), { recursive: true });
      writeFileSync(outFile, json);
      err(`${label.labeler} judged ${clipId}: pass=${label.pass}, failure codes [${label.failureCodes.join(", ")}], written to ${outFile}\n`);
    } else out(json);
    return 0;
  } catch (e) {
    return fail(1, e instanceof Error ? e.message : String(e));
  }
}

if (process.argv[1]?.endsWith("drama-judge.js") || process.argv[1]?.endsWith("drama-judge.ts")) {
  runDramaJudgeCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    },
  );
}
