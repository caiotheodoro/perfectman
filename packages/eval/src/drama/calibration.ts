/**
 * Calibration of the drama judge against human clip labels: judge every clip
 * that has a human label, write the judge labels, and report per-axis
 * ordinal-weighted kappa (`labelAgreement`, the hotel calibration's statistic)
 * against a 0.6 bar. An axis with no scored pairs has no verdict and does not
 * pass (quality-rubric.md section 7: no data is not a pass), and a clip the
 * judge could not answer counts against the run instead of being dropped.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { DRAMA_AXES, type DramaAxis } from "./axes.js";
import { DramaJudgeReplyError } from "./drama-judge.js";
import { labelAgreement, type LabelAgreement } from "./kappa.js";
import { parseClipLabel, type ClipLabel } from "./label.js";

export const CALIBRATION_THRESHOLD = 0.6;

export type AxisVerdict = "pass" | "fail" | "no_data";

export function axisVerdict(kappa: number | null, threshold: number): AxisVerdict {
  if (kappa === null) return "no_data";
  return kappa >= threshold ? "pass" : "fail";
}

// ---------------------------------------------------------------------------
// Inputs on disk
// ---------------------------------------------------------------------------

const manifestSchema = z
  .object({
    /** Models the actors ran on, for every clip. */
    actorModels: z.array(z.string().min(1)).optional(),
    clips: z
      .array(
        z
          .object({
            clipId: z.string().min(1),
            /** The mp4, relative to the manifest. */
            clip: z.string().min(1),
            /** The recorded run directory, relative to the manifest. */
            run: z.string().min(1),
            /** Where the clip starts in run time, seconds. Default 0. */
            clipStartS: z.number().min(0).optional(),
            emotionState: z.record(z.string()).optional(),
            actorModels: z.array(z.string().min(1)).optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type ClipJob = {
  clipId: string;
  clipPath: string;
  runDir: string;
  clipStartS?: number;
  emotionState?: Record<string, string>;
  actorModels: string[];
};

const issues = (err: z.ZodError): string => err.issues.slice(0, 4).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");

export function loadClipsManifest(manifestPath: string): ClipJob[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new Error(`clips manifest ${manifestPath} is not readable JSON: ${(err as Error).message}`);
  }
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`clips manifest ${manifestPath}: ${issues(parsed.error)}`);
  const base = dirname(manifestPath);
  const shared = parsed.data.actorModels ?? [];
  return parsed.data.clips.map((c) => ({
    clipId: c.clipId,
    clipPath: resolve(base, c.clip),
    runDir: resolve(base, c.run),
    ...(c.clipStartS !== undefined ? { clipStartS: c.clipStartS } : {}),
    ...(c.emotionState !== undefined ? { emotionState: c.emotionState } : {}),
    actorModels: [...shared, ...(c.actorModels ?? [])],
  }));
}

/** Labels from every `.json` (one label, or an array) and `.jsonl` (one per line) file in a directory, in file name order. */
export function loadHumanLabels(dir: string): ClipLabel[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") || f.endsWith(".jsonl")).sort();
  if (files.length === 0) throw new Error(`no label files (*.json, *.jsonl) in ${dir}`);
  const labels: ClipLabel[] = [];
  const parse = (value: unknown, where: string): void => {
    try {
      labels.push(parseClipLabel(value));
    } catch (err) {
      throw new Error(`${where}: ${err instanceof z.ZodError ? issues(err) : (err as Error).message}`);
    }
  };
  for (const file of files) {
    const text = readFileSync(join(dir, file), "utf8");
    if (file.endsWith(".jsonl")) {
      text.split("\n").forEach((line, i) => {
        if (line.trim() !== "") parse(line, `${file}:${i + 1}`);
      });
    } else {
      let value: unknown;
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error(`${file}: not valid JSON`);
      }
      (Array.isArray(value) ? value : [value]).forEach((v) => parse(v, file));
    }
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export type JudgeClipFn = (job: ClipJob, ctx: { sheetsDir: string }) => Promise<ClipLabel>;

export type DramaCalibrationOptions = {
  manifestPath: string;
  labelsDir: string;
  judgeOutDir: string;
  judge: JudgeClipFn;
  threshold?: number;
};

export type AxisCalibration = {
  kappa: number | null;
  n: number;
  bothNotApplicable: number;
  notApplicableMismatch: number;
  verdict: AxisVerdict;
};

export type DramaCalibrationReport = {
  judge: string;
  threshold: number;
  /** Clips judged and written to the judge output directory, in manifest order. */
  judged: string[];
  failedClips: Array<{ clipId: string; error: string }>;
  /** In the manifest but with no human label: not judged. */
  skippedNoHumanLabel: string[];
  /** Human labels for clips the manifest does not list: not judged. */
  labelsNotInManifest: string[];
  agreement: LabelAgreement;
  axes: Record<DramaAxis, AxisCalibration>;
  meanKappa: number | null;
  pass: boolean;
};

export async function runDramaCalibration(options: DramaCalibrationOptions): Promise<DramaCalibrationReport> {
  const threshold = options.threshold ?? CALIBRATION_THRESHOLD;
  const jobs = loadClipsManifest(options.manifestPath);
  const human = loadHumanLabels(options.labelsDir);
  const humanIds = new Set(human.map((l) => l.clipId));
  const manifestIds = new Set(jobs.map((j) => j.clipId));

  mkdirSync(options.judgeOutDir, { recursive: true });
  const judgeLabels: ClipLabel[] = [];
  const failedClips: DramaCalibrationReport["failedClips"] = [];
  for (const job of jobs) {
    if (!humanIds.has(job.clipId)) continue;
    try {
      const judged = await options.judge(job, { sheetsDir: join(options.judgeOutDir, "sheets", job.clipId) });
      writeFileSync(join(options.judgeOutDir, `${job.clipId}.json`), `${JSON.stringify(judged, null, 2)}\n`);
      judgeLabels.push(judged);
    } catch (err) {
      // only a reply the model could not get right is a property of that clip; anything else (separation, transport, spend cap) stops the run
      if (!(err instanceof DramaJudgeReplyError)) throw err;
      failedClips.push({ clipId: job.clipId, error: err.message });
    }
  }

  const agreement = labelAgreement(human, judgeLabels);
  const axes = Object.fromEntries(
    DRAMA_AXES.map((axis) => {
      const a = agreement.perAxis[axis];
      return [axis, { kappa: a.kappa, n: a.n, bothNotApplicable: a.bothNotApplicable, notApplicableMismatch: a.notApplicableMismatch, verdict: axisVerdict(a.kappa, threshold) }];
    }),
  ) as Record<DramaAxis, AxisCalibration>;
  const pass = failedClips.length === 0 && DRAMA_AXES.every((axis) => axes[axis].verdict === "pass");

  const report: DramaCalibrationReport = {
    judge: judgeLabels[0]?.labeler ?? "unknown",
    threshold,
    judged: judgeLabels.map((l) => l.clipId),
    failedClips,
    skippedNoHumanLabel: jobs.filter((j) => !humanIds.has(j.clipId)).map((j) => j.clipId),
    labelsNotInManifest: human.filter((l) => !manifestIds.has(l.clipId)).map((l) => l.clipId),
    agreement,
    axes,
    meanKappa: agreement.kappa,
    pass,
  };
  writeFileSync(
    join(options.judgeOutDir, "agreement.json"),
    `${JSON.stringify({ judge: report.judge, threshold, pass, meanKappa: report.meanKappa, judged: report.judged, failedClips, axes }, null, 2)}\n`,
  );
  return report;
}

const fmt = (k: number | null): string => (k === null ? "n/a" : k.toFixed(3));

export function formatDramaCalibration(report: DramaCalibrationReport): string {
  const verdictWord: Record<AxisVerdict, string> = { pass: "PASS", fail: "FAIL", no_data: "NO DATA" };
  const lines = [
    `drama judge calibration: ${report.judge} vs human labels`,
    `  ${report.agreement.n} clips scored by both, ${report.failedClips.length} could not be judged, ${report.skippedNoHumanLabel.length} skipped (no human label), ${report.labelsNotInManifest.length} labels not in the manifest`,
  ];
  for (const axis of DRAMA_AXES) {
    const a = report.axes[axis];
    lines.push(`  ${axis.padEnd(24)} kappa ${fmt(a.kappa).padStart(6)}  n=${a.n}  ${verdictWord[a.verdict]}  (not applicable: both ${a.bothNotApplicable}, one side ${a.notApplicableMismatch})`);
  }
  lines.push(`  mean kappa ${fmt(report.meanKappa)} over the axes that have data (threshold ${report.threshold})`);
  if (report.failedClips.length > 0) lines.push(`  ${report.failedClips.length} clip(s) could not be judged: ${report.failedClips.map((c) => c.clipId).join(", ")}`);

  const count = (v: AxisVerdict): number => DRAMA_AXES.filter((a) => report.axes[a].verdict === v).length;
  lines.push(
    report.pass
      ? `PASS: weighted kappa >= ${report.threshold} on all ${DRAMA_AXES.length} axes`
      : `FAIL: weighted kappa >= ${report.threshold} is required on every axis; ${count("pass")} of ${DRAMA_AXES.length} axes pass, ${count("fail")} fail, ${count("no_data")} without data`,
  );
  return lines.join("\n");
}
