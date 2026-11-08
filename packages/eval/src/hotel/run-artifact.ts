/**
 * Hotel run recorder input format (eval-plan.md section 6, hotel-package.md 6.4).
 *
 * A run directory is what `writeRunArtifacts` leaves behind plus an optional
 * hotel frame log:
 *   events.jsonl        committed events, one `CommittedEvent` per line (required)
 *   body-frames.json    `BodyFrameLog` (frames + snapshots) written by the sidecar
 *   frames.jsonl        optional NDJSON frame log: one `BodyFrame` per line, or raw
 *                       Director frames (`{t, ...}`) as the hotel server logs them
 *   replay.json         manifest (run id, counters)
 *   cast.json           optional `{ actors: [{ref, name, card?, language?}], humans: [{ref, name, language?}] }`
 *
 * Loading is tolerant: a malformed line is counted in `warnings`, never thrown,
 * so one bad frame cannot hide a whole recording from the judge.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, basename } from "node:path";
import type { BodyFrame, BodyFrameLog, CommittedEvent } from "@perfectman/shared";

export type HotelCastMember = {
  ref: string;
  name: string;
  kind: "actor" | "human";
  /** Persona card shown to the judge; actors only. */
  card?: string;
  language?: "pt" | "en";
};

export type HotelRunArtifact = {
  runId: string;
  dir?: string;
  manifest?: Record<string, unknown>;
  events: CommittedEvent[];
  frames: BodyFrame[];
  snapshots: BodyFrameLog["snapshots"];
  cast: HotelCastMember[];
  warnings: string[];
};

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);

/** Parses NDJSON, reporting (not throwing on) lines that are not JSON objects. */
export function parseNdjson(text: string, warnings: string[], label: string): Json[] {
  const out: Json[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    try {
      const v: unknown = JSON.parse(line);
      if (isObj(v)) out.push(v);
      else warnings.push(`${label}:${i + 1} is not an object`);
    } catch {
      warnings.push(`${label}:${i + 1} is not valid JSON`);
    }
  }
  return out;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const refOfPerson = (p: unknown): string | undefined => {
  if (typeof p === "string") return p;
  if (!isObj(p)) return undefined;
  const v = p["ref"] ?? p["name"] ?? p["id"] ?? p["user"];
  return v === undefined ? undefined : String(v);
};

type Stamp = { atMs: number; dir: "in" | "out" };

/**
 * One raw frame to the normalized `BodyFrame` vocabulary the probes read
 * (`chat`, `human_chat`, `moves`, `avatar_state`, ...). A frame already in
 * `BodyFrame` shape passes through; a raw Director frame is mapped best-effort
 * for the kinds the judge renders (`human_chat`, `actor_cmd` chat and walk).
 *
 * The hotel server's own `frames.jsonl` wraps every Director frame as
 * `{conn, dir, frame: {t, ...}, run, ts_ms}`. That wrapper is unwrapped here:
 * `dir` comes from the wrapper (the frame's own `dir` can be an avatar
 * orientation), `atMs` is the wrapper's `ts_ms` (the same wall clock the event
 * log's `createdAt` uses, so the two stay mergeable), and everything else is
 * mapped exactly like a raw frame. Note that wrapper `dir` is the hotel
 * server's view of the wire, which is the sidecar's view reversed.
 */
export function normalizeFrame(raw: Json): BodyFrame | undefined {
  if (typeof raw["kind"] === "string" && num(raw["atMs"]) !== undefined) {
    const dir = raw["dir"] === "out" ? "out" : "in";
    const data = isObj(raw["data"]) ? raw["data"] : {};
    return { atMs: raw["atMs"] as number, dir, kind: raw["kind"], data, ...(raw["room"] !== undefined ? { room: String(raw["room"]) } : {}) };
  }
  const inner = raw["t"] === undefined && isObj(raw["frame"]) ? raw["frame"] : undefined;
  if (inner) {
    const stamp: Stamp = { atMs: num(raw["ts_ms"]) ?? num(inner["at"]) ?? 0, dir: raw["dir"] === "out" ? "out" : "in" };
    return normalizeDirectorFrame(inner, stamp);
  }
  return normalizeDirectorFrame(raw, { atMs: num(raw["atMs"]) ?? num(raw["at"]) ?? num(raw["ts"]) ?? 0, dir: raw["dir"] === "out" ? "out" : "in" });
}

function normalizeDirectorFrame(raw: Json, stamp: Stamp): BodyFrame | undefined {
  const t = raw["t"];
  if (typeof t !== "string") return undefined;
  const { atMs, dir } = stamp;
  const room = raw["room"] !== undefined && raw["room"] !== null ? String(raw["room"]) : undefined;
  const base = { atMs, dir, ...(room ? { room } : {}) } as const;
  if (t === "human_chat") {
    const to = raw["to"];
    const from = raw["from"];
    const fromId = isObj(from) && from["id"] !== undefined ? String(from["id"]) : undefined;
    // The hotel names a human `h:<id>` everywhere else (event log, body log); a bare name is only the fallback.
    const ref = fromId !== undefined ? `h:${fromId}` : (refOfPerson(from) ?? "human");
    return {
      ...base,
      kind: "human_chat",
      data: {
        ref,
        ...(fromId !== undefined ? { fromId } : {}),
        text: String(raw["text"] ?? ""),
        mode: String(raw["mode"] ?? "say"),
        ...(to !== undefined && to !== null ? { toRef: String(to) } : {}),
      },
    };
  }
  if (t === "actor_cmd" && isObj(raw["cmd"])) {
    const cmd = raw["cmd"];
    const agentId = String(raw["actor"] ?? "");
    if (cmd["k"] === "chat") {
      const to = cmd["to"];
      return {
        ...base,
        dir: "in",
        kind: "chat",
        data: { agentId, mode: String(cmd["mode"] ?? "say"), text: String(cmd["text"] ?? ""), ...(to !== undefined && to !== null ? { toRef: String(to) } : {}) },
      };
    }
    return { ...base, kind: "actor_cmd", data: { agentId, cmd } };
  }
  const { t: _t, ...rest } = raw;
  return { ...base, kind: t, data: rest };
}

/**
 * A line the sidecar's body log and the hotel's wire log both carry is the same line, if the two stamps are this close.
 * The sidecar's log keeps no `text` in recorded runs, so a missing text on either side matches.
 */
const MIRROR_WINDOW_MS = 5_000;

const speakerOf = (f: BodyFrame): string => String(f.data[f.kind === "chat" ? "agentId" : "ref"] ?? "");
const isSpeech = (f: BodyFrame): boolean => f.kind === "chat" || f.kind === "human_chat";
const mirrors = (a: BodyFrame, b: BodyFrame): boolean =>
  a.kind === b.kind &&
  a.dir !== b.dir &&
  speakerOf(a) === speakerOf(b) &&
  String(a.data["mode"] ?? "say") === String(b.data["mode"] ?? "say") &&
  (a.data["text"] === undefined || b.data["text"] === undefined || a.data["text"] === b.data["text"]) &&
  Math.abs(a.atMs - b.atMs) <= MIRROR_WINDOW_MS;

/**
 * Brings frames read from the hotel's wire log (`frames.jsonl`) into the
 * vocabulary of the sidecar's body log:
 *  - numeric avatar ids (`-701`, a human's `28`) become actor refs / human names, learned
 *    from the run's own `actor_spawned` and `human_chat` frames; unknown ids stay as they are;
 *  - `delta` `moves` and `avatar_action` become the per-actor `moves` / `avatar_action`
 *    frames the body probes and the transcript read (other deltas stay `delta`);
 *  - speech that `mirrored` (frames already loaded from `body-frames.json`) already has is dropped
 *    from the result. The sidecar's log keeps no `text` in recorded runs, so the copy in `mirrored`
 *    takes the wire copy's text (that array is updated in place) and keeps its own tile/distance data.
 */
export function alignWireFrames(frames: readonly BodyFrame[], mirrored: BodyFrame[] = []): BodyFrame[] {
  const names = new Map<string, string>();
  for (const f of frames) {
    if (f.kind === "actor_spawned" && f.data["actor"] !== undefined && typeof f.data["ref"] === "string") names.set(String(f.data["actor"]), f.data["ref"]);
    if (f.kind === "human_chat" && typeof f.data["fromId"] === "string") names.set(f.data["fromId"], String(f.data["ref"]));
  }
  const name = (id: unknown): string => {
    const key = String(id);
    return names.get(key) ?? key;
  };
  const out: BodyFrame[] = [];
  for (const f of frames) {
    // Derived body events are hotel-to-sidecar, `in` in the sidecar log's vocabulary the probes filter on.
    const base = { atMs: f.atMs, dir: "in" as const, ...(f.room !== undefined ? { room: f.room } : {}) };
    if (f.kind === "delta" && isObj(f.data["msg"])) {
      const msg = f.data["msg"];
      if (msg["t"] === "moves" && Array.isArray(msg["moves"])) {
        for (const m of msg["moves"]) {
          if (!isObj(m) || num(m["x"]) === undefined || num(m["y"]) === undefined) continue;
          out.push({ ...base, kind: "moves", data: { agentId: name(m["id"]), tile: [m["x"], m["y"]], dir: num(m["dir"]) ?? 0, state: String(m["state"] ?? "walk") } });
        }
        continue;
      }
      if (msg["t"] === "avatar_action" && typeof msg["action"] === "string") {
        out.push({ ...base, kind: "avatar_action", data: { agentId: name(msg["id"]), a: msg["action"] } });
        continue;
      }
    }
    if (f.kind === "chat") {
      const { toRef, ...rest } = f.data;
      out.push({ ...f, data: { ...rest, agentId: name(f.data["agentId"]), ...(toRef !== undefined ? { toRef: name(toRef) } : {}) } });
      continue;
    }
    if (f.kind === "actor_cmd") {
      out.push({ ...f, data: { ...f.data, agentId: name(f.data["agentId"]) } });
      continue;
    }
    out.push(f);
  }
  return out.filter((f) => {
    if (!isSpeech(f)) return true;
    const i = mirrored.findIndex((m) => mirrors(f, m));
    if (i < 0) return true;
    const twin = mirrored[i]!;
    if (twin.data["text"] === undefined && f.data["text"] !== undefined) mirrored[i] = { ...twin, data: { ...twin.data, text: f.data["text"] } };
    return false;
  });
}

function loadCast(dir: string, warnings: string[]): HotelCastMember[] {
  const file = join(dir, "cast.json");
  if (!existsSync(file)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (!isObj(parsed)) throw new Error("not an object");
    const members: HotelCastMember[] = [];
    for (const kind of ["actors", "humans"] as const) {
      const list = parsed[kind];
      if (!Array.isArray(list)) continue;
      for (const m of list) {
        if (!isObj(m) || typeof m["ref"] !== "string") continue;
        members.push({
          ref: m["ref"],
          name: typeof m["name"] === "string" ? m["name"] : m["ref"],
          kind: kind === "actors" ? "actor" : "human",
          ...(typeof m["card"] === "string" ? { card: m["card"] } : {}),
          ...(m["language"] === "pt" || m["language"] === "en" ? { language: m["language"] } : {}),
        });
      }
    }
    return members;
  } catch (err) {
    warnings.push(`cast.json unreadable: ${(err as Error).message}`);
    return [];
  }
}

/** Loads a run directory. Throws only when there is nothing judgeable (no events and no frames). */
export function loadHotelRun(dir: string): HotelRunArtifact {
  const warnings: string[] = [];
  const read = (name: string): string | undefined => {
    const file = join(dir, name);
    return existsSync(file) ? readFileSync(file, "utf8") : undefined;
  };

  const eventsText = read("events.jsonl");
  const events = eventsText === undefined ? [] : (parseNdjson(eventsText, warnings, "events.jsonl") as unknown as CommittedEvent[]);

  const frames: BodyFrame[] = [];
  let snapshots: BodyFrameLog["snapshots"] = [];
  const bodyFrames = read("body-frames.json");
  if (bodyFrames !== undefined) {
    try {
      const log: unknown = JSON.parse(bodyFrames);
      if (isObj(log) && Array.isArray(log["frames"])) {
        for (const f of log["frames"]) {
          const n = isObj(f) ? normalizeFrame(f) : undefined;
          if (n) frames.push(n);
        }
        if (Array.isArray(log["snapshots"])) snapshots = log["snapshots"] as BodyFrameLog["snapshots"];
      } else warnings.push("body-frames.json has no frames array");
    } catch {
      warnings.push("body-frames.json is not valid JSON");
    }
  }
  for (const name of ["frames.jsonl", "body-frames.jsonl"]) {
    const text = read(name);
    if (text === undefined) continue;
    const fromFile: BodyFrame[] = [];
    for (const raw of parseNdjson(text, warnings, name)) {
      const n = normalizeFrame(raw);
      if (n) fromFile.push(n);
      else warnings.push(`${name} has a frame with no kind or t`);
    }
    frames.push(...alignWireFrames(fromFile, frames));
  }

  if (events.length === 0 && frames.length === 0) {
    throw new Error(`nothing to judge in ${dir}: no events.jsonl lines and no frame log`);
  }

  let manifest: Record<string, unknown> | undefined;
  const replay = read("replay.json");
  if (replay !== undefined) {
    try {
      const m: unknown = JSON.parse(replay);
      if (isObj(m)) manifest = m;
    } catch {
      warnings.push("replay.json is not valid JSON");
    }
  }

  frames.sort((a, b) => a.atMs - b.atMs);
  const runId = manifest && manifest["run"] !== undefined ? String(manifest["run"]) : basename(dir);
  return { runId, dir, ...(manifest ? { manifest } : {}), events, frames, snapshots, cast: loadCast(dir, warnings), warnings };
}
