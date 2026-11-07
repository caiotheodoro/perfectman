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

/**
 * One raw frame to the normalized `BodyFrame` vocabulary the probes read
 * (`chat`, `human_chat`, `moves`, `avatar_state`, ...). A frame already in
 * `BodyFrame` shape passes through; a raw Director frame is mapped best-effort
 * for the kinds the judge renders (`human_chat`, `actor_cmd` chat and walk).
 */
export function normalizeFrame(raw: Json): BodyFrame | undefined {
  if (typeof raw["kind"] === "string" && num(raw["atMs"]) !== undefined) {
    const dir = raw["dir"] === "out" ? "out" : "in";
    const data = isObj(raw["data"]) ? raw["data"] : {};
    return { atMs: raw["atMs"] as number, dir, kind: raw["kind"], data, ...(raw["room"] !== undefined ? { room: String(raw["room"]) } : {}) };
  }
  const t = raw["t"];
  if (typeof t !== "string") return undefined;
  const atMs = num(raw["atMs"]) ?? num(raw["at"]) ?? num(raw["ts"]) ?? 0;
  const dir = raw["dir"] === "out" ? "out" : "in";
  const room = raw["room"] !== undefined && raw["room"] !== null ? String(raw["room"]) : undefined;
  const base = { atMs, dir, ...(room ? { room } : {}) } as const;
  if (t === "human_chat") {
    const to = raw["to"];
    return {
      ...base,
      kind: "human_chat",
      data: {
        ref: refOfPerson(raw["from"]) ?? "human",
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
    for (const raw of parseNdjson(text, warnings, name)) {
      const n = normalizeFrame(raw);
      if (n) frames.push(n);
      else warnings.push(`${name} has a frame with no kind or t`);
    }
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
