/**
 * Hotel run to judgeable transcript, with spatial annotations.
 *
 * quality-rubric.md section 6: "Judge input is a rendered transcript with body
 * events interleaved as text lines ... Not video." Every spoken line carries the
 * speaker's posture and tile, and the distance band to the addressee or to each
 * person who could hear it, so `spatial_coherence` can be read off the text.
 *
 * Line grammar (the calibration snippets are written in it):
 *   [t+12s] Gabi (human) says: "oi Duda"
 *   [t+14s] Duda (sitting, 4,2) says to Gabi [2 tiles, personal]: "oi!"
 *   [t+15s] Rafa (standing, 9,5) says [heard clearly: Duda 5; garbled: Gabi 8]: "..."
 *   [t+20s] Duda (sitting, 4,2) whispers to Rafa [1 tile, intimate; others get a notice only]: "..."
 *   [t+21s] Duda thinks (nobody hears this): "..."
 *   [t+30s] Rafa walks (2,1) -> (9,5) [7 tiles in 4.2s]
 *   [t+31s] Rafa sits | stands | waves | smiles
 *   [t+40s] Léo stays quiet (3 pulses)
 */
import { SAY_CLEAR_TILES, chebyshev } from "@perfectman/engine";
import type { BodyFrame, CommittedEvent, Tile } from "@perfectman/shared";
import type { HotelCastMember, HotelRunArtifact } from "./run-artifact.js";

export type HotelDistanceBand = "intimate" | "personal" | "social" | "public" | "out_of_sight";

/** quality-rubric.md 1.4, Chebyshev tiles. */
export function distanceBand(tiles: number): HotelDistanceBand {
  if (tiles < 0 || tiles > 12) return "out_of_sight";
  if (tiles <= 1) return "intimate";
  if (tiles === 2) return "personal";
  if (tiles <= SAY_CLEAR_TILES) return "social";
  return "public";
}

export type HotelTranscript = {
  /** Cast and persona cards, one entry per line. */
  header: string[];
  lines: string[];
  durationS: number;
  stats: { humanLines: number; actorLines: number; whispers: number; silences: number; walks: number; directorNotes: number };
  text: string;
};

export type HotelTranscriptOptions = {
  /** Keep only lines in [fromS, toS] of run time. */
  fromS?: number;
  toS?: number;
  maxLines?: number;
};

type Pos = { tile?: Tile; posture?: string; room?: string };
type Item = { t: number; order: number; frame?: BodyFrame; event?: CommittedEvent };

const SILENCE_MERGE_MS = 30_000;
const WALK_GAP_MS = 1_500;
/** Longest gap between a committed line and the wire-log copy of it. */
const SPEECH_PAIR_MS = 45_000;

const asTile = (v: unknown): Tile | undefined =>
  Array.isArray(v) && v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number" ? ([v[0], v[1]] as Tile) : undefined;
const str = (v: unknown): string => (v === undefined || v === null ? "" : String(v));
const secs = (ms: number): string => `t+${String(Math.max(0, Math.round(ms / 1000))).padStart(2, "0")}s`;
const quote = (text: string): string => JSON.stringify(text);
const POSTURE: Record<string, string> = { sit: "sitting", stand: "standing", lay: "lying", walk: "walking", dance: "dancing" };
const postureWord = (s: string | undefined): string => (s === undefined ? "" : (POSTURE[s] ?? s));
const plural = (n: number): string => `${n} tile${n === 1 ? "" : "s"}`;

class Namer {
  private readonly byRef = new Map<string, HotelCastMember>();
  constructor(cast: readonly HotelCastMember[], events: readonly CommittedEvent[]) {
    for (const m of cast) this.byRef.set(m.ref, m);
    for (const e of events) {
      const p = e.payload as Record<string, unknown>;
      if (typeof p["senderName"] === "string" && !this.byRef.has(e.actorId)) {
        this.byRef.set(e.actorId, { ref: e.actorId, name: p["senderName"], kind: p["untrusted"] === true ? "human" : "actor" });
      }
    }
  }
  name(ref: string): string {
    const known = this.byRef.get(ref);
    if (known) return known.name;
    const bare = ref.replace(/^h:/, "");
    return bare.length > 0 ? bare[0]!.toUpperCase() + bare.slice(1) : ref;
  }
  isHuman(ref: string, dataHint?: boolean): boolean {
    const known = this.byRef.get(ref);
    if (known) return known.kind === "human";
    return dataHint ?? ref.startsWith("h:");
  }
  members(): HotelCastMember[] {
    return [...this.byRef.values()];
  }
}

/** Builds the transcript. Pure: the same artifact always renders to the same text. */
export function buildHotelTranscript(run: HotelRunArtifact, opts: HotelTranscriptOptions = {}): HotelTranscript {
  const namer = new Namer(run.cast, run.events);

  const items: Item[] = [];
  let order = 0;
  for (const frame of run.frames) items.push({ t: frame.atMs, order: order++, frame });
  for (const event of run.events) items.push({ t: event.createdAt, order: order++, event });
  const snaps = [...run.snapshots].sort((a, b) => a.atMs - b.atMs);
  items.sort((a, b) => a.t - b.t || a.order - b.order);

  const t0 = items.length === 0 ? 0 : Math.min(...items.map((i) => i.t), ...snaps.map((s) => s.atMs));
  const tEnd = items.length === 0 ? 0 : Math.max(...items.map((i) => i.t));

  const pos = new Map<string, Pos>();
  const at = (ref: string): Pos => {
    let p = pos.get(ref);
    if (!p) pos.set(ref, (p = {}));
    return p;
  };
  let snapIdx = 0;
  const applySnapshots = (upTo: number): void => {
    while (snapIdx < snaps.length && snaps[snapIdx]!.atMs <= upTo) {
      const s = snaps[snapIdx++]!;
      for (const o of s.occupants) {
        const p = at(o.ref);
        p.tile = o.tile;
        p.posture = o.state;
        p.room = s.room;
      }
    }
  };

  const out: Array<{ t: number; line: string }> = [];
  const stats = { humanLines: 0, actorLines: 0, whispers: 0, silences: 0, walks: 0, directorNotes: 0 };
  // The sidecar commits a line, then the hotel's wire log sends it after typing and walking: up to ~20 s later in recorded
  // runs. Each shown line absorbs at most one later copy, so an actor who really repeats itself is still shown repeating.
  const seenSpeech: Array<{ who: string; text: string; t: number; absorbed: boolean }> = [];
  const isDup = (who: string, text: string, t: number): boolean => {
    const twin = seenSpeech.find((s) => !s.absorbed && s.who === who && s.text === text && Math.abs(s.t - t) <= SPEECH_PAIR_MS);
    if (twin) twin.absorbed = true;
    return twin !== undefined;
  };

  // Walk collapsing: consecutive `moves` of one actor become a single line.
  const walks = new Map<string, { from: Tile; to: Tile; startT: number; lastT: number; maxStep: number }>();
  const flushWalk = (ref: string): void => {
    const w = walks.get(ref);
    if (!w) return;
    walks.delete(ref);
    const tiles = chebyshev(w.from, w.to);
    if (tiles === 0) return;
    stats.walks++;
    const dur = Math.max(0.3, (w.lastT - w.startT) / 1000 + 0.3);
    out.push({ t: w.startT, line: `[${secs(w.startT - t0)}] ${namer.name(ref)} walks (${w.from[0]},${w.from[1]}) -> (${w.to[0]},${w.to[1]}) [${plural(tiles)} in ${dur.toFixed(1)}s]` });
  };
  const flushAllWalks = (): void => {
    for (const ref of [...walks.keys()]) flushWalk(ref);
  };

  const listeners = (speaker: string, room: string | undefined, tile: Tile | undefined): string => {
    if (!tile) return "";
    const clear: string[] = [];
    const garbled: string[] = [];
    for (const [ref, p] of pos) {
      if (ref === speaker || !p.tile) continue;
      if (room !== undefined && p.room !== undefined && p.room !== room) continue;
      const d = chebyshev(tile, p.tile);
      if (d <= SAY_CLEAR_TILES) clear.push(`${namer.name(ref)} ${d}`);
      else if (d <= 10) garbled.push(`${namer.name(ref)} ${d}`);
    }
    const parts: string[] = [];
    if (clear.length > 0) parts.push(`heard clearly: ${clear.join(", ")}`);
    if (garbled.length > 0) parts.push(`garbled: ${garbled.join(", ")}`);
    if (parts.length === 0) parts.push("nobody within earshot");
    return parts.join("; ");
  };

  const speechLine = (t: number, who: string, human: boolean, mode: string, text: string, toRef: string | undefined, d: Record<string, unknown>, room: string | undefined): string => {
    const me = at(who);
    const tile = asTile(d["tile"]) ?? me.tile;
    const tag = human ? "(human)" : `(${[postureWord(me.posture), tile ? `${tile[0]},${tile[1]}` : ""].filter(Boolean).join(", ") || "actor"})`;
    const verb = mode === "whisper" ? "whispers" : mode === "shout" ? "shouts" : "says";
    let target = "";
    let note = "";
    if (toRef) {
      target = ` to ${namer.name(toRef)}`;
      const toTile = asTile(d["toTile"]) ?? pos.get(toRef)?.tile;
      const explicit = typeof d["distance"] === "number" ? (d["distance"] as number) : undefined;
      const dist = explicit ?? (tile && toTile ? chebyshev(tile, toTile) : undefined);
      const sameRoom = d["sameRoom"] === false ? false : true;
      if (!sameRoom) note = "different room, out_of_sight";
      else if (dist !== undefined) note = `${plural(dist)}, ${distanceBand(dist)}`;
      if (mode === "whisper") note = [note, "others get a notice only"].filter(Boolean).join("; ");
    } else if (mode !== "whisper") {
      note = listeners(who, room, tile);
    }
    const bracket = note ? ` [${note}]` : "";
    return `[${secs(t - t0)}] ${namer.name(who)} ${tag} ${verb}${target}${bracket}: ${quote(text)}`;
  };

  let pendingSilence: { ref: string; first: number; last: number; n: number } | undefined;
  const flushSilence = (): void => {
    if (!pendingSilence) return;
    const s = pendingSilence;
    pendingSilence = undefined;
    stats.silences++;
    out.push({ t: s.first, line: `[${secs(s.first - t0)}] ${namer.name(s.ref)} stays quiet (${s.n} pulse${s.n === 1 ? "" : "s"})` });
  };

  const emitSpeech = (t: number, who: string, humanHint: boolean | undefined, mode: string, text: string, toRef: string | undefined, d: Record<string, unknown>, room: string | undefined): void => {
    if (text.trim() === "" && mode !== "thought") return;
    flushWalk(who);
    const human = namer.isHuman(who, humanHint);
    if (mode === "thought") {
      out.push({ t, line: `[${secs(t - t0)}] ${namer.name(who)} thinks (nobody hears this): ${quote(text)}` });
      return;
    }
    if (human) stats.humanLines++;
    else stats.actorLines++;
    if (mode === "whisper") stats.whispers++;
    seenSpeech.push({ who, text, t, absorbed: false });
    out.push({ t, line: speechLine(t, who, human, mode, text, toRef, d, room) });
  };

  for (const item of items) {
    applySnapshots(item.t);
    const f = item.frame;
    if (f) {
      const d = f.data;
      switch (f.kind) {
        case "human_chat": {
          const who = str(d["ref"]);
          if (asTile(d["tile"])) at(who).tile = asTile(d["tile"]);
          at(who).room = f.room ?? at(who).room;
          if (isDup(who, str(d["text"]), f.atMs)) break;
          emitSpeech(f.atMs, who, true, str(d["mode"]) || "say", str(d["text"]), d["toRef"] ? str(d["toRef"]) : undefined, d, f.room);
          break;
        }
        case "chat": {
          const who = str(d["agentId"]);
          const tile = asTile(d["tile"]);
          if (tile) at(who).tile = tile;
          at(who).room = f.room ?? at(who).room;
          if (isDup(who, str(d["text"]), f.atMs)) break;
          emitSpeech(f.atMs, who, false, str(d["mode"]) || "say", str(d["text"]), d["toRef"] ? str(d["toRef"]) : undefined, d, f.room);
          break;
        }
        case "moves": {
          const ref = str(d["agentId"]);
          const tile = asTile(d["tile"]);
          if (!tile) break;
          const p = at(ref);
          const w = walks.get(ref);
          if (w && f.atMs - w.lastT <= WALK_GAP_MS) {
            w.maxStep = Math.max(w.maxStep, chebyshev(w.to, tile));
            w.to = tile;
            w.lastT = f.atMs;
          } else {
            flushWalk(ref);
            walks.set(ref, { from: p.tile ?? tile, to: tile, startT: f.atMs, lastT: f.atMs, maxStep: 0 });
          }
          p.tile = tile;
          p.room = f.room ?? p.room;
          break;
        }
        case "avatar_state": {
          const ref = str(d["agentId"]);
          const state = str(d["state"]);
          const p = at(ref);
          flushWalk(ref);
          if (p.posture !== state) {
            p.posture = state;
            const verb = state === "sit" ? "sits down" : state === "stand" ? "stands up" : state === "lay" ? "lies down" : `is now ${state}`;
            out.push({ t: f.atMs, line: `[${secs(f.atMs - t0)}] ${namer.name(ref)} ${verb}${p.tile ? ` at (${p.tile[0]},${p.tile[1]})` : ""}` });
          }
          break;
        }
        case "avatar_action": {
          const ref = str(d["agentId"]);
          out.push({ t: f.atMs, line: `[${secs(f.atMs - t0)}] ${namer.name(ref)} does: ${str(d["a"])}` });
          break;
        }
        case "moved_room": {
          const ref = str(d["agentId"]);
          flushWalk(ref);
          at(ref).room = f.room ?? at(ref).room;
          out.push({ t: f.atMs, line: `[${secs(f.atMs - t0)}] ${namer.name(ref)} leaves for another room` });
          break;
        }
        default:
          break;
      }
      continue;
    }

    const e = item.event!;
    const p = e.payload as Record<string, unknown>;
    switch (e.type) {
      case "message_sent":
      case "reply_sent": {
        // D23: an admin's steering whisper to a character is a director's note, not a line anybody in the room said or
        // heard. Left in, the judge read it as an in-world order and marked the actor down for obeying it.
        if (e.actorId === "host" || e.visibility.visibilityReason === "admin_whisper") {
          stats.directorNotes++;
          break;
        }
        flushSilence();
        const text = str(p["content"]);
        const human = p["untrusted"] === true || namer.isHuman(e.actorId);
        if (isDup(e.actorId, text, e.createdAt)) break;
        const d: Record<string, unknown> = {};
        const mode = str(p["mode"]) || "say";
        const addressee = Array.isArray(p["addresseeIds"]) && p["addresseeIds"].length > 0 ? str(p["addresseeIds"][0]) : undefined;
        emitSpeech(e.createdAt, e.actorId, human, mode, text, addressee, d, undefined);
        break;
      }
      case "no_op_recorded": {
        if (pendingSilence && pendingSilence.ref === e.actorId && e.createdAt - pendingSilence.last <= SILENCE_MERGE_MS) {
          pendingSilence.n++;
          pendingSilence.last = e.createdAt;
        } else {
          flushSilence();
          pendingSilence = { ref: e.actorId, first: e.createdAt, last: e.createdAt, n: 1 };
        }
        break;
      }
      case "speech_deferred":
        out.push({ t: e.createdAt, line: `[${secs(e.createdAt - t0)}] ${namer.name(e.actorId)} walks over before speaking (to ${namer.name(str(p["targetRef"]))})` });
        break;
      default:
        break;
    }
  }
  flushAllWalks();
  flushSilence();

  out.sort((a, b) => a.t - b.t);
  const from = opts.fromS === undefined ? -Infinity : t0 + opts.fromS * 1000;
  const to = opts.toS === undefined ? Infinity : t0 + opts.toS * 1000;
  let lines = out.filter((l) => l.t >= from && l.t <= to).map((l) => l.line);
  if (opts.maxLines !== undefined) lines = lines.slice(0, opts.maxLines);

  const header = namer.members().map((m) => `${m.name} (${m.kind}${m.language ? `, ${m.language}` : ""})${m.card ? `: ${m.card}` : ""}`);
  const notes = stats.directorNotes > 0 ? [`(${stats.directorNotes} director note${stats.directorNotes === 1 ? "" : "s"} to characters left out: they steered the run from outside the scene and are not part of it.)`] : [];
  const text = [...(header.length > 0 ? ["Cast:", ...header.map((h) => `- ${h}`)] : []), ...notes, "Events:", ...(lines.length > 0 ? lines : ["(no events)"])].join("\n");
  return { header, lines, durationS: Math.round((tEnd - t0) / 1000), stats, text };
}
