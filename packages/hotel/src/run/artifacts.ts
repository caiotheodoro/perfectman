import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BodyFrameLog } from "@perfectman/shared";
import type { CommittedEvent } from "@perfectman/shared";
import type { ModelTier } from "../llm/chain-config.js";

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
  /** What a replay needs to put the run back on a stage (D39): how it was shown, where it was home, and who was who. */
  mode?: "default" | "cinematic";
  home?: number;
  /** Cast ref (the scenario's agent id) to the avatar id the hotel gave it, which is what the director track and the frame log mention. */
  actors?: Record<string, number>;
  /** Which model answered for each chain link, and the admin's pick. Absent for the mock provider. */
  llm?: {
    /** The model the admin picked for the run (link `pick`), its tier (`experimental` for 8B or an 8K window) and how many characters the scene had. */
    picked_model?: string;
    picked_tier?: ModelTier;
    picked_actors?: number;
    links: Record<string, { model: string; tier: ModelTier }>;
  };
  counters: Record<string, number>;
  /** A pulse did not drain before teardown, as in the HTTP controller's manifest. */
  dirty?: true;
  files: Record<string, string>;
};

/**
 * Streams a run's events to `runs/<id>/events.jsonl` as the in-memory log evicts them
 * (`eventRetention`), so a long run holds a window in memory and the file stays complete.
 * Writes are chained so the order is the order of eviction; a failed write is remembered and
 * rethrown by `finish`, never thrown into the pulse that triggered the eviction.
 */
export class NdjsonEventSink {
  private chain: Promise<void> = Promise.resolve();
  private started = false;
  private failure: unknown;
  /** Events written so far, evicted plus final. */
  written = 0;

  constructor(private readonly file: string, private readonly onError?: (err: unknown) => void) {}

  /** Takes ownership of `events` (an eviction chunk); returns at once. */
  push(events: readonly CommittedEvent[]): void {
    if (events.length === 0) return;
    const text = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const flag = this.started ? "a" : "w";
    this.started = true;
    this.written += events.length;
    this.chain = this.chain.then(async () => {
      try {
        if (flag === "w") await mkdir(dirname(this.file), { recursive: true });
        await appendFile(this.file, text, { flag });
      } catch (err) {
        this.failure ??= err;
        this.onError?.(err);
      }
    });
  }

  /** Appends the final window, waits for every write, and throws the first write failure. */
  async finish(finalEvents: readonly CommittedEvent[]): Promise<void> {
    if (!this.started && finalEvents.length === 0) {
      this.started = true;
      this.chain = this.chain.then(() => mkdir(dirname(this.file), { recursive: true }).then(() => writeFile(this.file, "")));
    }
    this.push(finalEvents);
    await this.chain;
    if (this.failure) throw this.failure instanceof Error ? this.failure : new Error(String(this.failure));
  }
}

/** The cinematic director's streamed track, beside events.jsonl. */
export const TRACK_FILE = "director-track.jsonl";

export type WrittenArtifacts = { dir: string; files: Record<string, string> };

/**
 * `PERFECTMAN_DATA_DIR/runs/<runId>/` (hotel-package.md 6.4): the evicted and
 * final event log (with a `sink`, the evicted part is already on disk and the final window is appended), the director track (`director-track.jsonl`, cinematic runs only, registered as `director_track`), and the
 * manifest that ties them together. The hotel writes `frames.jsonl` itself.
 * A missing or read-only volume is logged by the caller, never fatal to a stop.
 */
export async function writeRunArtifacts(
  dataDir: string,
  run: number,
  events: readonly CommittedEvent[],
  frameLog: BodyFrameLog,
  manifest: Omit<ReplayManifest, "files">,
  sink?: NdjsonEventSink,
): Promise<WrittenArtifacts> {
  const dir = join(dataDir, "runs", String(run));
  await mkdir(dir, { recursive: true });
  const base = { events: "events.jsonl", director: "director.json", replay: "replay.json", body_frames: "body-frames.json" };
  // A cinematic run streams its track here as it plays (cine/track.ts); a default run leaves no file.
  const hasTrack = await stat(join(dir, TRACK_FILE)).then((s) => s.isFile(), () => false);
  const files: Record<string, string> = hasTrack ? { ...base, director_track: TRACK_FILE } : base;
  if (sink) await sink.finish(events);
  else await writeFile(join(dir, base.events), events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));
  await writeFile(join(dir, base.director), JSON.stringify({ track: [] }));
  await writeFile(join(dir, base.body_frames), JSON.stringify(frameLog));
  await writeFile(join(dir, base.replay), JSON.stringify({ ...manifest, files }, null, 2));
  return { dir, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, join(dir, v)])) };
}
