/**
 * The cinematic scorer's view of a run: everything it measures, read once from a run directory into plain data.
 *
 * Sources (all optional except that one of events/frames/track must exist):
 *  - `events.jsonl`          lines (message_sent / reply_sent), the actors' private motives, memories, exits
 *  - `frames.jsonl`          the wire log: acts (act_started / act_beat / act_reaction / act_done), body commands, arrivals, spawns
 *  - `director-track.jsonl`  the camera: shots, lines as staged, drops
 *  - `replay.json`           start / end clock, models
 *
 * Acts live in frames.jsonl, NOT in events.jsonl. Camera cues live in director-track.jsonl. Times are seconds since the run's start
 * (replay.startedAt, else the run_start frame, else the first event); the director track keeps its own clock (ms since the director started).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type Line = {
  tS: number;
  speaker: string;
  ref: string;
  text: string;
  eventId?: string;
  replyToEventId?: string;
  mode?: string;
  /** The speaker's private motive for this line (private_motive_summary of the same intent), when the log has it. */
  motive?: string;
};

export type ActRecord = {
  id: string;
  tS: number;
  verb: string;
  actor: string;
  target?: string;
  origin?: string;
  rung?: number;
  intensity?: number;
  /** landed / dodged / blocked / declined / timeout / aborted; absent when the act never finished. */
  outcome?: string;
  /** The act reached contact (an act_beat was logged). */
  contact: boolean;
  owed: number;
  owedMissed: number;
  reactions: number;
  witnesses: number;
};

export type BodyCmd = { tS: number; actor: string; kind: string; detail?: string };
export type Arrival = { tS: number; actor: string; x: number; y: number };
export type Exit = { tS: number; actor: string; via: string };
export type Memory = { tS: number; intensity: number; tone: string; unresolved: boolean };

export type CameraCue = { tMs: number; shot: string; targetKind: "avatar" | "pair" | "room" | "other"; avatar?: number; pair?: number[]; room?: number; easeMs: number; holdMs: number };
export type StagedLine = { tMs: number; ms: number; avatar: number | null; room?: number; text?: string };
export type CameraDrop = { tMs: number; why: string; item?: string };
export type Camera = {
  /** Length of the track, ms. */
  durationMs: number;
  cues: CameraCue[];
  lines: StagedLine[];
  drops: CameraDrop[];
  roomCuts: number;
  /** Every cue the track shows (camera, captions, cards, sfx ...): what a drop is a share of. */
  cueCount: number;
  /** Camera cues and room cuts in track order, to find the shot that was on when a line started. */
  timeline: Array<{ tMs: number; kind: "cue" | "cut"; cue?: CameraCue; room?: number }>;
};

export type RunBundle = {
  runId: string;
  dir?: string;
  durationS: number;
  cast: string[];
  language: "pt" | "en";
  lines: Line[];
  acts: ActRecord[];
  bodyCmds: BodyCmd[];
  arrivals: Arrival[];
  entrances: Array<{ actor: string; tS: number }>;
  exits: Exit[];
  memories: Memory[];
  camera?: Camera;
  /** Models the actors ran on (replay.json), for the judge's separation rule. */
  actorModels: string[];
  /** Which sources the loader found. */
  sources: { events: boolean; frames: boolean; track: boolean; replay: boolean };
};

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

export function readJsonLines(file: string): Json[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .flatMap((l) => {
      try {
        const v: unknown = JSON.parse(l);
        return isObj(v) ? [v] : [];
      } catch {
        return [];
      }
    });
}

function readJson(file: string): Json | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const v: unknown = JSON.parse(readFileSync(file, "utf8"));
    return isObj(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

/** Acts that count as a physical-contact beat for the climax invariant. */
export const PHYSICAL_ACT_VERBS: ReadonlySet<string> = new Set(["shove", "slap", "punch", "kill", "die", "faint", "restrain", "hug", "kiss"]);
/** Acts one actor aims at another to hurt or threaten (the ones initiative can swap on). */
export const AGGRESSIVE_ACT_VERBS: ReadonlySet<string> = new Set(["glare", "insult", "shove", "slap", "punch", "kill"]);

/** Acts that did not play out are not on screen, so they do not count as embodiment. */
export const isVisibleAct = (a: ActRecord): boolean => a.outcome === undefined || a.outcome === "landed" || a.outcome === "dodged" || a.outcome === "blocked";

const LANG_PT = /\b(que|não|voce|você|uma|para|com|está|ele|ela|meu|minha|seu|sua|isso|mas|então|já|tá|né)\b/i;
function guessLanguage(texts: string[], hint?: string): "pt" | "en" {
  if (hint?.toLowerCase().startsWith("pt")) return "pt";
  if (hint?.toLowerCase().startsWith("en")) return "en";
  const hits = texts.filter((t) => LANG_PT.test(t) || /[ãõçé]/i.test(t)).length;
  return texts.length > 0 && hits / texts.length >= 0.3 ? "pt" : "en";
}

export function loadRunBundle(dir: string): RunBundle {
  const events = readJsonLines(join(dir, "events.jsonl"));
  const frames = readJsonLines(join(dir, "frames.jsonl"));
  const trackRows = readJsonLines(join(dir, "director-track.jsonl"));
  const replay = readJson(join(dir, "replay.json"));
  if (events.length === 0 && frames.length === 0 && trackRows.length === 0) throw new Error(`nothing to score in ${dir}: no events.jsonl, frames.jsonl or director-track.jsonl lines`);

  const frameTs = frames.map((r) => num(r["ts_ms"])).filter((v): v is number => v !== undefined);
  const eventTs = events.map((e) => num(e["createdAt"])).filter((v): v is number => v !== undefined);
  const runStartFrame = frames.find((r) => isObj(r["frame"]) && r["frame"]["t"] === "run_start");
  const startedAt = num(replay?.["startedAt"]);
  const t0 = startedAt ?? num(runStartFrame?.["ts_ms"]) ?? (eventTs.length > 0 ? Math.min(...eventTs) : frameTs.length > 0 ? Math.min(...frameTs) : 0);
  const lastTs = Math.max(0, ...frameTs, ...eventTs);
  const endedAt = num(replay?.["endedAt"]);
  const trackEnd = trackRows.map((r) => num(r["t"]) ?? 0).reduce((m, v) => Math.max(m, v), 0);
  const endMs = Math.max(endedAt ?? 0, lastTs);
  const durationS = Math.max(endMs > t0 ? (endMs - t0) / 1000 : 0, trackEnd / 1000);
  const rel = (ms: number): number => Math.round(((ms - t0) / 1000) * 1000) / 1000;

  // ---- who is who (frames: actor_spawn has ref + name, actor_spawned has the avatar id) -----------------------------------------------
  const nameOfRef = new Map<string, string>();
  const refOfAvatar = new Map<string, string>();
  for (const r of frames) {
    const f = r["frame"];
    if (!isObj(f)) continue;
    if (f["t"] === "actor_spawn" && str(f["ref"]) && str(f["name"])) nameOfRef.set(String(f["ref"]), String(f["name"]));
    if (f["t"] === "actor_spawned" && str(f["ref"]) && f["actor"] !== undefined) refOfAvatar.set(String(f["actor"]), String(f["ref"]));
  }
  const who = (avatar: unknown): string => {
    if (avatar === undefined || avatar === null) return "?";
    const ref = refOfAvatar.get(String(avatar));
    return ref !== undefined ? (nameOfRef.get(ref) ?? ref) : /^\d+$/.test(String(avatar)) ? `h:${String(avatar)}` : String(avatar);
  };

  // ---- lines and motives (events) ------------------------------------------------------------------------------------------------------
  const motiveOfIntent = new Map<string, string>();
  for (const e of events) {
    if (e["type"] !== "private_motive_summary") continue;
    const p = isObj(e["payload"]) ? e["payload"] : {};
    const intent = str(e["sourceIntentId"]);
    const summary = str(p["summary"]);
    if (intent && summary) motiveOfIntent.set(intent, summary);
  }
  const lines: Line[] = [];
  const castFromEvents = new Set<string>();
  for (const e of events) {
    const type = e["type"];
    if (type !== "message_sent" && type !== "reply_sent") continue;
    const vis = isObj(e["visibility"]) ? e["visibility"] : {};
    if (e["actorId"] === "host" || vis["visibilityReason"] === "admin_whisper") continue;
    const p = isObj(e["payload"]) ? e["payload"] : {};
    const content = str(p["content"]);
    const at = num(e["createdAt"]);
    if (content === undefined || at === undefined) continue;
    const ref = String(e["actorId"] ?? "");
    const speaker = str(p["senderName"]) ?? nameOfRef.get(ref) ?? ref;
    castFromEvents.add(speaker);
    const intent = str(e["sourceIntentId"]);
    lines.push({
      tS: rel(at),
      speaker,
      ref,
      text: content,
      ...(str(e["id"]) ? { eventId: String(e["id"]) } : {}),
      ...(str(p["replyToEventId"]) ? { replyToEventId: String(p["replyToEventId"]) } : {}),
      ...(str(p["mode"]) ? { mode: String(p["mode"]) } : {}),
      ...(intent && motiveOfIntent.has(intent) ? { motive: motiveOfIntent.get(intent)! } : {}),
    });
  }
  lines.sort((a, b) => a.tS - b.tS);

  const memories: Memory[] = [];
  const exits: Exit[] = [];
  for (const e of events) {
    const at = num(e["createdAt"]);
    if (at === undefined) continue;
    const p = isObj(e["payload"]) ? e["payload"] : {};
    if (e["type"] === "memory_written") {
      memories.push({ tS: rel(at), intensity: num(p["intensity"]) ?? 0, tone: str(p["emotionalTone"]) ?? "", unresolved: p["unresolved"] === true });
    } else if (e["type"] === "agent_left") {
      exits.push({ tS: rel(at), actor: nameOfRef.get(String(e["actorId"])) ?? String(e["actorId"] ?? ""), via: "agent_left" });
    }
  }

  // ---- acts, body commands, arrivals (frames) ----------------------------------------------------------------------------------
  type Partial_ = { started?: Json; ts?: number; beat?: Json; reactions: number; done?: Json };
  const byAct = new Map<string, Partial_>();
  const bodyCmds: BodyCmd[] = [];
  const arrivals: Arrival[] = [];
  const entrances: Array<{ actor: string; tS: number }> = [];
  const spawnTile = new Map<string, { x: number; y: number }>();
  for (const r of frames) {
    const f = r["frame"];
    const ts = num(r["ts_ms"]);
    if (!isObj(f) || ts === undefined) continue;
    const t = f["t"];
    if (t === "act_started" || t === "act_beat" || t === "act_reaction" || t === "act_done") {
      const id = str(f["act_id"]);
      if (id === undefined) continue;
      const slot = byAct.get(id) ?? { reactions: 0 };
      if (t === "act_started") {
        slot.started = f;
        slot.ts = num(f["at"]) ?? ts;
      } else if (t === "act_beat") slot.beat = f;
      else if (t === "act_reaction") slot.reactions++;
      else slot.done = f;
      byAct.set(id, slot);
    } else if (t === "actor_cmd" && isObj(f["cmd"])) {
      const cmd = f["cmd"];
      const kind = str(cmd["k"]);
      if (kind === undefined) continue;
      const detail = kind === "expression" ? str(cmd["face"]) : kind === "action" ? str(cmd["action"]) : kind === "act" ? str(cmd["verb"]) : undefined;
      bodyCmds.push({ tS: rel(ts), actor: who(f["actor"]), kind, ...(detail ? { detail } : {}) });
      if (kind === "walk" && str(cmd["plan"])?.endsWith(":enter")) entrances.push({ actor: who(f["actor"]), tS: rel(ts) });
    } else if (t === "arrived") {
      const x = num(f["x"]);
      const y = num(f["y"]);
      if (x !== undefined && y !== undefined) arrivals.push({ tS: rel(ts), actor: who(f["actor"]), x, y });
    } else if (t === "actor_spawned") {
      const x = num(f["x"]);
      const y = num(f["y"]);
      if (x !== undefined && y !== undefined) spawnTile.set(who(f["actor"]), { x, y });
    } else if (t === "moved_room") {
      exits.push({ tS: rel(ts), actor: who(f["actor"]), via: "moved_room" });
    } else if (t === "actor_despawn" && str(f["mode"]) === "walk_out") {
      exits.push({ tS: rel(ts), actor: who(f["actor"]), via: "despawn" });
    }
  }
  const acts: ActRecord[] = [];
  for (const [id, a] of byAct) {
    if (!a.started) continue;
    const s = a.started;
    const owedList = Array.isArray(a.beat?.["owed"]) ? (a.beat!["owed"] as unknown[]) : [];
    const missed = Array.isArray(a.done?.["owed_missed"]) ? (a.done!["owed_missed"] as unknown[]).length : 0;
    const witnesses = Array.isArray(a.beat?.["witnesses"]) ? (a.beat!["witnesses"] as unknown[]).length : 0;
    acts.push({
      id,
      tS: rel(a.ts ?? 0),
      verb: str(s["verb"]) ?? "?",
      actor: who(s["actor"]),
      ...(s["with"] !== undefined ? { target: who(s["with"]) } : {}),
      ...(str(s["origin"]) ? { origin: String(s["origin"]) } : {}),
      ...(num(s["rung"]) !== undefined ? { rung: num(s["rung"])! } : {}),
      ...(num(s["intensity"]) !== undefined ? { intensity: num(s["intensity"])! } : {}),
      ...(str(a.done?.["outcome"]) ? { outcome: String(a.done!["outcome"]) } : {}),
      contact: a.beat !== undefined,
      owed: owedList.length,
      owedMissed: missed,
      reactions: a.reactions,
      witnesses,
    });
  }
  acts.sort((a, b) => a.tS - b.tS);
  // the first tile an actor stood on is a position too
  for (const [actor, tile] of spawnTile) arrivals.push({ tS: 0, actor, x: tile.x, y: tile.y });
  arrivals.sort((a, b) => a.tS - b.tS);
  exits.sort((a, b) => a.tS - b.tS);

  // ---- camera (director track) -------------------------------------------------------------------------------------------------------------
  let camera: Camera | undefined;
  if (trackRows.length > 0) {
    const cues: CameraCue[] = [];
    const staged: StagedLine[] = [];
    const drops: CameraDrop[] = [];
    const timeline: Camera["timeline"] = [];
    let roomCuts = 0;
    let cueCount = 0;
    for (const e of [...trackRows].sort((a, b) => (num(a["t"]) ?? 0) - (num(b["t"]) ?? 0))) {
      const tMs = num(e["t"]) ?? 0;
      const k = e["k"];
      if (k === "cue") cueCount++;
      if (k === "cue" && isObj(e["ui"]) && e["ui"]["k"] === "camera") {
        const ui = e["ui"];
        const target = isObj(ui["target"]) ? ui["target"] : {};
        const cue: CameraCue = {
          tMs,
          shot: str(ui["shot"]) ?? "?",
          targetKind: target["avatar"] !== undefined ? "avatar" : Array.isArray(target["pair"]) ? "pair" : target["room"] !== undefined ? "room" : "other",
          ...(num(target["avatar"]) !== undefined ? { avatar: num(target["avatar"])! } : {}),
          ...(Array.isArray(target["pair"]) ? { pair: (target["pair"] as unknown[]).map(Number) } : {}),
          ...(num(e["room"]) !== undefined ? { room: num(e["room"])! } : {}),
          easeMs: num(ui["ease_ms"]) ?? 0,
          holdMs: num(ui["hold_ms"]) ?? 0,
        };
        cues.push(cue);
        timeline.push({ tMs, kind: "cue", cue });
      } else if (k === "cut") {
        roomCuts++;
        timeline.push({ tMs, kind: "cut", ...(num(e["room"]) !== undefined ? { room: num(e["room"])! } : {}) });
      } else if (k === "line") {
        staged.push({ tMs, ms: num(e["ms"]) ?? 0, avatar: num(e["avatar"]) ?? null, ...(num(e["room"]) !== undefined ? { room: num(e["room"])! } : {}), ...(str(e["text"]) ? { text: String(e["text"]) } : {}) });
      } else if (k === "drop") {
        drops.push({ tMs, why: str(e["why"]) ?? "?", ...(str(e["item"]) ? { item: String(e["item"]) } : {}) });
      }
    }
    camera = { durationMs: trackEnd, cues, lines: staged, drops, roomCuts, cueCount, timeline };
  }

  const llm = isObj(replay?.["llm"]) ? (replay!["llm"] as Json) : {};
  const links = isObj(llm["links"]) ? (llm["links"] as Json) : {};
  const actorModels = [
    ...new Set(
      [str(llm["picked_model"]), ...Object.values(links).map((l) => (isObj(l) ? str(l["model"]) : undefined))].filter((m): m is string => m !== undefined),
    ),
  ];
  const cast = nameOfRef.size > 0 ? [...nameOfRef.values()] : [...castFromEvents];
  const trackLang = trackRows.find((r) => r["k"] === "start");
  const runNumber = num(replay?.["run"]);
  return {
    runId: runNumber !== undefined ? String(runNumber) : (dir.split("/").filter(Boolean).pop() ?? dir),
    dir,
    durationS,
    cast,
    language: guessLanguage(lines.map((l) => l.text), str(trackLang?.["lang"])),
    lines,
    acts,
    bodyCmds,
    arrivals,
    entrances,
    exits,
    memories,
    ...(camera ? { camera } : {}),
    actorModels,
    sources: { events: events.length > 0, frames: frames.length > 0, track: trackRows.length > 0, replay: replay !== undefined },
  };
}

/** The part of a run between `fromS` and `toS`, with times shifted so the window starts at 0 (a graded clip is a window of a run). */
export function sliceBundle(whole: RunBundle, fromS: number, toS: number): RunBundle {
  // no `dir`: a window must not be scored from the whole run's files
  const { dir: _dir, ...b } = whole;
  void _dir;
  const inside = (t: number): boolean => t >= fromS && t <= toS;
  const shift = (t: number): number => Math.round((t - fromS) * 1000) / 1000;
  const cam = b.camera;
  const camera: Camera | undefined = cam
    ? (() => {
        const f = fromS * 1000;
        const t = toS * 1000;
        const sh = <T extends { tMs: number }>(x: T): T => ({ ...x, tMs: x.tMs - f });
        const timeline = cam.timeline.filter((x) => x.tMs >= f && x.tMs <= t).map((x) => ({ ...x, tMs: x.tMs - f, ...(x.cue ? { cue: sh(x.cue) } : {}) }));
        return {
          durationMs: Math.max(0, Math.min(cam.durationMs, t) - f),
          cues: cam.cues.filter((x) => x.tMs >= f && x.tMs <= t).map(sh),
          lines: cam.lines.filter((x) => x.tMs >= f && x.tMs <= t).map(sh),
          drops: cam.drops.filter((x) => x.tMs >= f && x.tMs <= t).map(sh),
          roomCuts: timeline.filter((x) => x.kind === "cut").length,
          // the share of drops is read against the cues that were shown in the window
          cueCount: Math.max(timeline.filter((x) => x.kind === "cue").length, 0),
          timeline,
        };
      })()
    : undefined;
  return {
    ...b,
    durationS: Math.max(0, Math.min(b.durationS, toS) - fromS),
    lines: b.lines.filter((l) => inside(l.tS)).map((l) => ({ ...l, tS: shift(l.tS) })),
    acts: b.acts.filter((a) => inside(a.tS)).map((a) => ({ ...a, tS: shift(a.tS) })),
    bodyCmds: b.bodyCmds.filter((c) => inside(c.tS)).map((c) => ({ ...c, tS: shift(c.tS) })),
    arrivals: b.arrivals.filter((a) => inside(a.tS)).map((a) => ({ ...a, tS: shift(a.tS) })),
    entrances: b.entrances.filter((e) => inside(e.tS)).map((e) => ({ ...e, tS: shift(e.tS) })),
    exits: b.exits.filter((e) => inside(e.tS)).map((e) => ({ ...e, tS: shift(e.tS) })),
    memories: b.memories.filter((m) => inside(m.tS)).map((m) => ({ ...m, tS: shift(m.tS) })),
    ...(camera ? { camera } : {}),
  };
}
