#!/usr/bin/env node
/**
 * `pnpm --filter @perfectman/eval label -- --manifest <path> --labels <dir> [--port 4777] [--labeler name]`
 * Starts the local clip labeling tool and prints its URL.
 */
import { resolve } from "node:path";
import { LABEL_USAGE, mergeClipsWithStatuses, parseLabelCliArgs, summarizeProgress } from "./label-session.js";
import { loadClipsFromManifest, readLabelStatuses, startLabelServer } from "./server.js";

async function main(): Promise<void> {
  const args = parseLabelCliArgs(process.argv.slice(2));
  const manifestPath = resolve(args.manifest);
  const labelsDir = resolve(args.labels);
  const clips = await loadClipsFromManifest(manifestPath);
  if (clips.length === 0) throw new Error(`manifest has no clips: ${manifestPath}`);

  const running = await startLabelServer({ clips, labelsDir, labeler: args.labeler, port: args.port });
  const statuses = await readLabelStatuses(clips, labelsDir);
  const progress = summarizeProgress(statuses);
  const pending = mergeClipsWithStatuses(clips, statuses).filter((c) => !c.labeled).length;

  console.log(`clip labeler: ${running.url}`);
  console.log(`  manifest: ${manifestPath} (${clips.length} clips)`);
  console.log(`  labels:   ${labelsDir} (${progress.labeled}/${progress.total} labelled, ${pending} to go)`);
  console.log("  blind mode: judge/model scores are never shown. Ctrl+C to stop.");

  const stop = (): void => {
    void running.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  if (!(err instanceof Error) || !err.message.includes(LABEL_USAGE)) console.error(LABEL_USAGE);
  process.exit(1);
});
