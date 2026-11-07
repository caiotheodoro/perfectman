/**
 * Replay (D39): a finished run's artifacts become a timed list of things to do, with no model anywhere.
 *
 * Sources, best first (the files `writeRunArtifacts` leaves in `runs/<id>/`):
 *  - `body-frames.json`: every `actor_cmd` the sidecar sent, with its wall-clock time. This is the world side:
 *    moves, faces, gestures, lines, thoughts, pair acts, door trips.
 *  - `director-track.jsonl` (cinematic runs): every cue, cut and line, in film time. This is the audience side.
 *    Its clock starts when the film started, which is not in the manifest, so it is lined up with the frame
 *    log by the spoken lines the two share.
 *  - `events.jsonl`: the committed events. Only used for the lines when neither of the above has them.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { BodyFrame } from "@perfectman/shared";
import type { ActorCmd, PerfectmanUi } from "../director/index.js";
import { parseTrack } from "../director/cine/track.js";
import type { TrackEntry } from "../director/cine/types.js";
import type { CommittedEvent } from "@perfectman/shared";
import type { ReplayManifest } from "./artifacts.js";

export class ReplayError extends Error {
  constructor(readonly code: "replay_not_found" | "replay_corrupt" | "replay_bad_args", message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

export type ReplayStep =
  | { at: number; k: "cmd"; ref: string; cmd: ActorCmd; room?: number }
  | { at: number; k: "ui"; ui: PerfectmanUi };

export type ReplayPlan = {
  /** Sorted by `at` (ms from the first thing that happened). */
  steps: ReplayStep[];
  durationMs: number;
  /** Everyone who does something, with the time of their first act, so they can walk in when they did. */
  cast: Array<{ ref: string; firstAt: number }>;
  /** The avatar ids the recording mentions, by cast ref, for rewriting cues and targets. */
  avatarRefs: Record<number, string>;
  home: number | undefined;
  hasTrack: boolean;
  /** Where the lines came from. */
  linesFrom: "frames" | "track" | "events" | "none";
  warnings: string[];
};

export type ReplayArtifacts = {
  manifest: ReplayManifest;
  frames: BodyFrame[];
  track: TrackEntry[];
  events: CommittedEvent[];
};

const readOptional = (path: string): Promise<string | undefined> => readFile(path, "utf8").then((t) => t, () => undefined);

/** Reads `runs/<run>/`. A run with no manifest was never finished, which is `replay_not_found`. */
export async function loadReplayArtifacts(dataDir: string, run: number): Promise<ReplayArtifacts> {
  if (!Number.isInteger(run) || run <= 0) throw new ReplayError("replay_bad_args", "the run id is not a number");
  const dir = join(dataDir, "runs", String(run));
  const manifestText = await readOptional(join(dir, "replay.json"));
  if (manifestText === undefined) throw new ReplayError("replay_not_found", `run ${run} left no replay.json`);
  let manifest: ReplayManifest;
  try {
    manifest = JSON.parse(manifestText) as ReplayManifest;
  } catch {
    throw new ReplayError("replay_corrupt", `run ${run}: replay.json is not valid JSON`);
  }
  if (typeof manifest !== "object" || manifest === null || typeof manifest.scenarioVersion !== "number") {
    throw new ReplayError("replay_corrupt", `run ${run}: replay.json has no scenario version`);
  }
  let frames: BodyFrame[] = [];
  const framesText = await readOptional(join(dir, "body-frames.json"));
  if (framesText) {
    try {
      const parsed = JSON.parse(framesText) as { frames?: BodyFrame[] };
      frames = Array.isArray(parsed.frames) ? parsed.frames : [];
    } catch {
      throw new ReplayError("replay_corrupt", `run ${run}: body-frames.json is not valid JSON`);
    }
  }
  let track: TrackEntry[] = [];
  const trackText = await readOptional(join(dir, "director-track.jsonl"));
  if (trackText) {
    try {
      track = parseTrack(trackText);
    } catch {
      throw new ReplayError("replay_corrupt", `run ${run}: director-track.jsonl has a line that is not JSON`);
    }
  }
  let events: CommittedEvent[] = [];
  const eventsText = await readOptional(join(dir, "events.jsonl"));
  if (eventsText) {
    events = eventsText.split("\n").filter((l) => l.trim().length > 0).flatMap((l) => {
      try {
        return [JSON.parse(l) as CommittedEvent];
      } catch {
        return []; // a torn last line from a crash
      }
    });
  }
  return { manifest, frames, track, events };
}

type CmdFrame = { at: number; ref: string; cmd: ActorCmd; room: number | undefined };

function cmdFrames(frames: readonly BodyFrame[]): CmdFrame[] {
  const out: CmdFrame[] = [];
  for (const f of frames) {
    if (f.dir !== "out" || f.kind !== "actor_cmd") continue;
    const ref = f.data["actor"];
    const cmd = f.data["cmd"] as ActorCmd | undefined;
    if (typeof ref !== "string" || !cmd || typeof cmd !== "object" || typeof (cmd as { k?: unknown }).k !== "string") continue;
    const room = f.room !== undefined ? Number(f.room) : undefined;
    out.push({ at: f.atMs, ref, cmd, room: room !== undefined && Number.isInteger(room) ? room : undefined });
  }
  return out.sort((a, b) => a.at - b.at);
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/**
 * When the film's clock started, in the frame log's clock: the lines the track and the log both have agree on it.
 * Without any (or without frames), the manifest's start is the best there is.
 */
export function alignTrack(track: readonly TrackEntry[], chats: readonly CmdFrame[], fallback: number): number {
  const lines = track.filter((e): e is Extract<TrackEntry, { k: "line" }> => e.k === "line");
  const used = new Set<number>();
  const offsets: number[] = [];
  for (const line of lines) {
    const i = chats.findIndex((c, j) => !used.has(j) && c.ref === line.ref && c.cmd.k === "chat" && c.cmd.text === line.text);
    const hit = i >= 0 ? chats[i] : undefined;
    if (!hit) continue;
    used.add(i);
    offsets.push(hit.at - line.t);
  }
  return offsets.length > 0 ? median(offsets) : fallback;
}

export type PlanOptions = {
  /** Show the director track's cues and cuts to the audience. */
  cinematic: boolean;
};

export function buildReplayPlan(a: ReplayArtifacts, opts: PlanOptions): ReplayPlan {
  const warnings: string[] = [];
  const cmds = cmdFrames(a.frames);
  const chats = cmds.filter((c) => c.cmd.k === "chat");
  const hasTrack = a.track.length > 0;
  const lineEntries = a.track.filter((e): e is Extract<TrackEntry, { k: "line" }> => e.k === "line");
  const filmStart = hasTrack ? alignTrack(a.track, chats, a.manifest.startedAt) : a.manifest.startedAt;

  // Avatar ids by ref: the manifest knows them all; the track's lines name the speakers of older runs.
  const avatarRefs: Record<number, string> = {};
  for (const [ref, id] of Object.entries(a.manifest.actors ?? {})) avatarRefs[id] = ref;
  for (const l of lineEntries) if (l.avatar !== null && avatarRefs[l.avatar] === undefined) avatarRefs[l.avatar] = l.ref;

  // The world side, with the lines from the best source that has them.
  type Raw = { at: number; ref: string; cmd: ActorCmd; room?: number };
  const raw: Raw[] = cmds.map((c) => ({ at: c.at, ref: c.ref, cmd: c.cmd, ...(c.room !== undefined ? { room: c.room } : {}) }));
  let linesFrom: ReplayPlan["linesFrom"] = chats.length > 0 ? "frames" : "none";
  if (chats.length === 0 && lineEntries.length > 0) {
    linesFrom = "track";
    for (const l of lineEntries) raw.push({ at: filmStart + l.t, ref: l.ref, cmd: { k: "chat", mode: l.mode as "say", text: l.text }, room: l.room });
  } else if (chats.length === 0) {
    const spoken = a.events.filter((e) => (e.type === "message_sent" || e.type === "reply_sent") && typeof (e.payload as { content?: unknown }).content === "string" && (a.manifest.actors ?? {})[e.actorId] !== undefined);
    if (spoken.length > 0) {
      linesFrom = "events";
      const t0 = Math.min(...spoken.map((e) => e.createdAt));
      for (const e of spoken) {
        raw.push({ at: a.manifest.startedAt + (e.createdAt - t0), ref: e.actorId, cmd: { k: "chat", mode: "say", text: String((e.payload as { content: string }).content) } });
      }
      warnings.push("no frame log: only the lines are replayed");
    }
  }

  const ui: Array<{ at: number; ui: PerfectmanUi }> = [];
  if (opts.cinematic) {
    if (!hasTrack) warnings.push("the run left no director track: nothing to show the audience");
    for (const e of a.track) {
      if (e.k === "cue") {
        // Cues went out `in_ms` before the audience saw them (t is when they were seen).
        const lead = "in_ms" in e.ui && typeof e.ui.in_ms === "number" ? e.ui.in_ms : 0;
        ui.push({ at: filmStart + e.t - lead, ui: e.ui });
      } else if (e.k === "cut") {
        ui.push({ at: filmStart + e.t, ui: { k: "cut", room: e.room } });
      }
    }
  }

  const all = [...raw.map((r) => r.at), ...ui.map((u) => u.at)];
  if (all.length === 0) throw new ReplayError("replay_corrupt", "the run recorded nothing to replay");
  const origin = Math.min(...all);
  const steps: ReplayStep[] = [
    ...raw.map((r): ReplayStep => ({ at: Math.round(r.at - origin), k: "cmd", ref: r.ref, cmd: r.cmd, ...(r.room !== undefined ? { room: r.room } : {}) })),
    ...ui.map((u): ReplayStep => ({ at: Math.round(u.at - origin), k: "ui", ui: u.ui })),
  ].sort((x, y) => x.at - y.at);

  const first = new Map<string, number>();
  for (const s of steps) if (s.k === "cmd" && !first.has(s.ref)) first.set(s.ref, s.at);
  for (const ref of Object.keys(a.manifest.actors ?? {})) if (!first.has(ref)) first.set(ref, 0);
  const home = typeof a.manifest.home === "number" ? a.manifest.home : (cmds.find((c) => c.room !== undefined)?.room ?? lineEntries[0]?.room);
  return {
    steps,
    durationMs: steps.at(-1)?.at ?? 0,
    cast: [...first].map(([ref, firstAt]) => ({ ref, firstAt })).sort((x, y) => x.firstAt - y.firstAt),
    avatarRefs,
    home,
    hasTrack,
    linesFrom,
    warnings,
  };
}
