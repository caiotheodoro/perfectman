/**
 * One clip, start to finish: load the recorded run, read its drama events and
 * transcript, cut contact sheets from the mp4, and ask the judge. This is the
 * glue the CLI calls for a single clip and for every clip of a calibration.
 */
import { buildHotelTranscript } from "../hotel/hotel-transcript.js";
import { loadHotelRun, type HotelRunArtifact } from "../hotel/run-artifact.js";
import { buildContactSheets, actMarksFromEvents } from "./contact-sheet.js";
import { assertJudgeSeparation, judgeDramaClip, type DramaJudgeProvider } from "./drama-judge.js";
import { extractDramaEvents } from "./events.js";
import type { ClipLabel } from "./label.js";

export type ClipRunJob = {
  clipId: string;
  clipPath: string;
  runDir: string;
  /** Where the clip starts in run time, seconds. Default 0. */
  clipStartS?: number;
  emotionState?: Record<string, string>;
  actorModels: readonly string[];
  /** Where the contact sheets are written. */
  sheetsDir: string;
};

/** Actor model ids a run recorded in its `replay.json` manifest, under `actorModel(s)` or `actor_model(s)`. */
export function actorModelsFromRun(run: Pick<HotelRunArtifact, "manifest">): string[] {
  const found: string[] = [];
  for (const key of ["actorModel", "actor_model", "actorModels", "actor_models"]) {
    const v = run.manifest?.[key];
    if (typeof v === "string") found.push(v);
    else if (Array.isArray(v)) found.push(...v.filter((x): x is string => typeof x === "string"));
  }
  return found;
}

export async function judgeClipFromRun(job: ClipRunJob, provider: DramaJudgeProvider, opts: { ffmpegPath?: string } = {}): Promise<ClipLabel> {
  // fail on separation before any ffmpeg work or model call
  assertJudgeSeparation(provider.model, job.actorModels);
  const run = loadHotelRun(job.runDir);
  const actorModels = [...job.actorModels, ...actorModelsFromRun(run)];
  assertJudgeSeparation(provider.model, actorModels);

  const clipStartS = job.clipStartS ?? 0;
  const events = extractDramaEvents(run.frames);
  const contactSheets = buildContactSheets({
    clipPath: job.clipPath,
    outDir: job.sheetsDir,
    acts: actMarksFromEvents(events, { clipStartMs: clipStartS * 1000 }),
    ...(opts.ffmpegPath !== undefined ? { ffmpegPath: opts.ffmpegPath } : {}),
  });
  const transcript = buildHotelTranscript(run, { fromS: clipStartS, toS: clipStartS + contactSheets.durationS }).text;

  return judgeDramaClip({
    clipId: job.clipId,
    contactSheets,
    events,
    transcript,
    ...(job.emotionState !== undefined ? { emotionState: job.emotionState } : {}),
    clipStartMs: clipStartS * 1000,
    provider,
    actorModels,
  });
}
