import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BodyFrameLog } from "@perfectman/shared";
import type { CommittedEvent } from "@perfectman/shared";

export type ReplayManifest = {
  run: number;
  simulationId: string;
  scenarioVersion: number;
  scenarioSha256: string;
  finalState: string;
  stopReason: string;
  startedAt: number;
  endedAt: number;
  pulse: number;
  counters: Record<string, number>;
  /** A pulse did not drain before teardown, as in the HTTP controller's manifest. */
  dirty?: true;
  files: Record<string, string>;
};

export type WrittenArtifacts = { dir: string; files: Record<string, string> };

/**
 * `PERFECTMAN_DATA_DIR/runs/<runId>/` (hotel-package.md 6.4): the evicted and
 * final event log, the (cinematic, empty for now) director track, and the
 * manifest that ties them together. The hotel writes `frames.jsonl` itself.
 * A missing or read-only volume is logged by the caller, never fatal to a stop.
 */
export async function writeRunArtifacts(
  dataDir: string,
  run: number,
  events: readonly CommittedEvent[],
  frameLog: BodyFrameLog,
  manifest: Omit<ReplayManifest, "files">,
): Promise<WrittenArtifacts> {
  const dir = join(dataDir, "runs", String(run));
  await mkdir(dir, { recursive: true });
  const files = { events: "events.jsonl", director: "director.json", replay: "replay.json", body_frames: "body-frames.json" };
  await writeFile(join(dir, files.events), events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));
  await writeFile(join(dir, files.director), JSON.stringify({ track: [] }));
  await writeFile(join(dir, files.body_frames), JSON.stringify(frameLog));
  await writeFile(join(dir, files.replay), JSON.stringify({ ...manifest, files }, null, 2));
  return { dir, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, join(dir, v)])) };
}
