import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HumanTrace, TraceActor, TraceEvent, Tile } from "./trace.js";

/** `Face` styles on the wire (`Action::Expression` style), by number. */
export const FACE_BY_STYLE: Record<number, string> = { 0: "neutral", 1: "smile", 2: "angry", 3: "sad", 4: "surprised", 5: "sleepy", 6: "fear", 7: "disgust", 8: "smug" };

const GESTURES = new Set(["wave", "thumbs", "laugh", "sign", "blow", "dance"]);

type FrameLine = { dir: "in" | "out"; frame: Record<string, unknown>; ts_ms: number };

function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as T];
      } catch {
        return [];
      }
    });
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/**
 * A real run's folder (`frames.jsonl`, `body-frames.json`, `replay.json`) as a trace. The hotel's `moves` deltas give every position and facing, `typing`
 * deltas the bubble, `chat` deltas the lines (their addressee comes from the sidecar's own frame log, `body-frames.json`), `avatar_action` the faces and
 * the arm gestures, and the sidecar's `actor_cmd` frames what the body was asked to do. Only the run's home room is read.
 */
export function loadRunTrace(dir: string, label?: string): HumanTrace {
  const lines = readJsonl<FrameLine>(join(dir, "frames.jsonl"));
  let replay: { home?: number; run?: number } = {};
  try {
    replay = JSON.parse(readFileSync(join(dir, "replay.json"), "utf8")) as typeof replay;
  } catch {
    /* a folder with no manifest: all rooms */
  }
  let bodyChats: Array<{ atMs: number; agentId: string; toRef?: string }> = [];
  try {
    const bf = JSON.parse(readFileSync(join(dir, "body-frames.json"), "utf8")) as { frames?: Array<{ atMs: number; dir: string; kind: string; data: Record<string, unknown> }> };
    bodyChats = (bf.frames ?? [])
      .filter((f) => f.dir === "out" && f.kind === "chat")
      .map((f) => ({ atMs: f.atMs, agentId: String(f.data["agentId"]), ...(typeof f.data["toRef"] === "string" ? { toRef: f.data["toRef"] as string } : {}) }));
  } catch {
    /* no body frames */
  }

  const t0 = lines[0]?.ts_ms ?? 0;
  const refOfId = new Map<number, string>();
  const nameOfId = new Map<number, string>();
  const actors = new Map<string, TraceActor>();
  const events: TraceEvent[] = [];
  const ref = (id: number): string => refOfId.get(id) ?? `h:${id}`;
  const home = replay.home;
  // `actor_spawned` comes just after the avatar joined: read all of them first so every avatar has its ref from its first frame.
  for (const { dir, frame } of lines) {
    if (dir === "out" && str(frame["t"]) === "actor_spawned") {
      const id = num(frame["actor"]);
      const r = str(frame["ref"]);
      if (id !== undefined && r) refOfId.set(id, r);
    }
  }

  for (const { dir, frame, ts_ms } of lines) {
    const t = ts_ms - t0;
    const kind = str(frame["t"]);
    if (kind === "actor_spawned" && dir === "out") {
      const id = num(frame["actor"]);
      const r = str(frame["ref"]);
      if (id !== undefined && r) refOfId.set(id, r);
      continue;
    }
    if (kind === "actor_spawn" && dir === "in") {
      // The sidecar's spawn request names the actor; the id comes with `actor_spawned`.
      const r = str(frame["ref"]);
      if (r) actors.set(r, { ref: r, name: str(frame["name"]) ?? r, human: false });
      continue;
    }
    if (kind === "actor_cmd" && dir === "in") {
      const cmd = frame["cmd"] as Record<string, unknown> | undefined;
      const id = num(frame["actor"]);
      const k = str(cmd?.["k"]);
      if (id === undefined || !k) continue;
      events.push({ t, kind: "cmd", ref: ref(id), cmd: k === "action" ? `action:${str(cmd?.["action"]) ?? "?"}` : k });
      continue;
    }
    if (kind !== "delta" || dir !== "out") continue;
    if (home !== undefined && num(frame["room"]) !== undefined && num(frame["room"]) !== home) continue;
    const msg = frame["msg"] as Record<string, unknown> | undefined;
    if (!msg) continue;
    switch (str(msg["t"])) {
      case "avatar_joined": {
        const a = msg["avatar"] as Record<string, unknown>;
        const id = num(a["id"]);
        if (id === undefined) break;
        nameOfId.set(id, str(a["name"]) ?? String(id));
        const r = ref(id);
        if (!actors.has(r)) actors.set(r, { ref: r, name: str(a["name"]) ?? r, human: !refOfId.has(id) });
        events.push({ t, kind: "pos", ref: r, tile: [num(a["x"]) ?? 0, num(a["y"]) ?? 0] as Tile, dir: num(a["dir"]) ?? 2, state: str(a["state"]) ?? "stand" });
        break;
      }
      case "moves": {
        for (const mv of (msg["moves"] as Array<Record<string, unknown>> | undefined) ?? []) {
          const id = num(mv["id"]);
          if (id === undefined) continue;
          events.push({ t, kind: "pos", ref: ref(id), tile: [num(mv["x"]) ?? 0, num(mv["y"]) ?? 0] as Tile, dir: num(mv["dir"]) ?? 2, state: str(mv["state"]) ?? "stand" });
        }
        break;
      }
      case "typing": {
        const id = num(msg["id"]);
        if (id !== undefined) events.push({ t, kind: "typing", ref: ref(id), on: msg["on"] === true });
        break;
      }
      case "chat": {
        const id = num(msg["from"]);
        if (id === undefined) break;
        const mode = str(msg["mode"]) ?? "say";
        if (mode === "thought" || mode === "caption") break;
        events.push({ t, kind: "chat", ref: ref(id), text: str(msg["text"]) ?? "", mode });
        break;
      }
      case "avatar_action": {
        const id = num(msg["id"]);
        const a = str(msg["action"]);
        if (id === undefined || !a) break;
        if (a === "expression") events.push({ t, kind: "expression", ref: ref(id), face: FACE_BY_STYLE[num(msg["style"]) ?? 0] ?? "neutral" });
        else if (GESTURES.has(a)) events.push({ t, kind: "gesture", ref: ref(id), a, ...(num(msg["style"]) !== undefined ? { style: num(msg["style"])! } : {}) });
        break;
      }
      default:
        break;
    }
  }

  // Addressees, from the sidecar's own frame log: each chat takes the nearest unused one of the same speaker.
  const used = new Set<number>();
  const chats = events.filter((e): e is Extract<TraceEvent, { kind: "chat" }> => e.kind === "chat");
  for (const c of chats) {
    let best = -1;
    let bestD = 2500;
    bodyChats.forEach((b, i) => {
      if (used.has(i) || b.agentId !== c.ref || b.toRef === undefined) return;
      const d = Math.abs(b.atMs - t0 - c.t);
      if (d < bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best >= 0) {
      used.add(best);
      c.to = bodyChats[best]!.toRef!;
    }
  }

  events.sort((a, b) => a.t - b.t);
  const firstChat = chats[0]?.t ?? 0;
  const last = events.reduce((m, e) => Math.max(m, e.t), 0);
  return {
    run: label ?? (replay.run !== undefined ? String(replay.run) : dir),
    source: "run",
    sceneStartMs: firstChat,
    durationMs: Math.max(0, last - firstChat),
    actors: [...actors.values()],
    events,
  };
}
