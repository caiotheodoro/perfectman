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
  /**
   * How much the actors' dialogue reads like a real script (docs/plans/script-likeness.md): the 0-100 score, the percentile of real beats it corresponds to, the
   * sub-scores (length, novelty, motif, progress, debt), and what was measured. Absent when the actors said nothing or the norms have no block for the language.
   */
  script_likeness?: {
    score: number;
    percentile: number;
    verdict: string;
    sub: Record<string, number>;
    worst_window: number;
    windows: number;
    say_turns: number;
    language: string;
    medium: string;
    /** The norms had no block for the medium (cinematic runs read the THEATRE norms: no screenplay corpus). */
    medium_fallback: boolean;
    /** Fewer than 4 speech turns: too few for a verdict. */
    low_n: boolean;
    motifs: number;
    unanswered_questions: number;
    norms_built?: string;
  };
  /**
   * The cinematic score (docs/eval/cinematic-score.md): written by `pnpm --filter @perfectman/eval cinematic --run <dir> --write-replay`, not by the run.
   * `groups` are 0-100 or null when a group was not scored (engagement needs the judge); `deterministic` is the mean of the four measured groups.
   */
  cinematic_score?: {
    version: string;
    score: number | null;
    deterministic: number | null;
    partial: boolean;
    capped: boolean;
    groups: Record<string, number | null>;
    climax_by_deadline: { pass: boolean; at_s: number | null; verb: string | null; deadline_s: number };
    engagement?: { judge: string; mock: boolean; mean: number };
    norms: string;
  };
  /** The scene spine of a run with no authored beats: the step it ended on and when each step began, and whether the progress gate or the hold released it. */
  scene_spine?: {
    step: number;
    advances: Array<{ step: number; at_ms: number; via: string }>;
    /** What the spine opened of the ladder (errata P8): the shove at its turn, the slap at its decision, and the steps that found no evidence; each grant with when, who and why. Absent with `PERFECTMAN_SPINE_ESCALATE=0`. */
    unlocks?: { shove: number; slap: number; skipped_no_evidence: number; grants: Array<{ at_ms: number; level: string; aggressor: string; target: string; why: string }> };
  };
  /**
   * The scene's beat sheet as the run played it (Contract A): where it came from, its arc, what became of the climax (the contract's hard invariant is a physical act by 4:00, so
   * `climax.at_ms` is the number to read) and how many beats played, played late or dropped. Absent for a scene that played the generic spine (see `beat_sheet_fallback` in the log).
   */
  beat_sheet?: {
    generated_by?: { model: string; cost_usd: number; ms: number; mock?: true };
    arc: { inciting_at_ms: number; reversal_at_ms?: number; climax_at_ms: number; aftermath_until_ms: number };
    beats: number;
    played: number;
    late: number;
    dropped: Record<string, number>;
    climax: { id: string; planned_ms: number; outcome: "pending" | "played" | "dropped" | "organic"; at_ms?: number; why?: string };
  };
  /** The scenario's drama as the run enforced it: where the block came from (`authored`, `default`, `off`, `free_play`) and what it allowed. */
  drama?: { source: string; max_rung: number; may_target_pairs: number; may_die: number; permadeath: boolean };
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

/** The guards' log, beside events.jsonl: one line per thing a guard did to an actor's line (guard-log.ts). For the operator; no player or replay reads it. */
export const GUARD_LOG_FILE = "guard-log.jsonl";

/** The drama planner's decision log, beside events.jsonl: one line per consult (drama-log.ts). For the operator; no player or replay reads it. */
export const DRAMA_LOG_FILE = "drama-log.jsonl";

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
  // A run whose guards did nothing leaves no guard log.
  const hasGuardLog = await stat(join(dir, GUARD_LOG_FILE)).then((s) => s.isFile(), () => false);
  // A run that never consulted the drama planner leaves no decision log.
  const hasDramaLog = await stat(join(dir, DRAMA_LOG_FILE)).then((s) => s.isFile(), () => false);
  const files: Record<string, string> = { ...base, ...(hasTrack ? { director_track: TRACK_FILE } : {}), ...(hasGuardLog ? { guard_log: GUARD_LOG_FILE } : {}), ...(hasDramaLog ? { drama_log: DRAMA_LOG_FILE } : {}) };
  if (sink) await sink.finish(events);
  else await writeFile(join(dir, base.events), events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : ""));
  await writeFile(join(dir, base.director), JSON.stringify({ track: [] }));
  await writeFile(join(dir, base.body_frames), JSON.stringify(frameLog));
  await writeFile(join(dir, base.replay), JSON.stringify({ ...manifest, files }, null, 2));
  return { dir, files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, join(dir, v)])) };
}
