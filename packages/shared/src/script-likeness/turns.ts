import { isBodyDirection, joinedKeys, wordsOf } from "./text.js";

/**
 * One turn of a scene: somebody says something, or does something with their body. A run's chat log, an eval simulation's transcript and
 * a beat of a real play all reduce to a list of these, and every metric reads that list.
 */
export type ScriptTurn = {
  /** Who: a name or an id; compared case-insensitively. */
  speaker: string;
  /** What was said (empty for an act). */
  text: string;
  /** Wall-clock or run-clock ms, when known. Metrics use it for the 90 s motif window and per-minute rates, and fall back to turn counts without it. */
  atMs?: number;
  /** `say` (the default) or `act`: a move, a sit, a gesture, an exit. */
  kind?: "say" | "act";
};

export const isSay = (t: ScriptTurn): boolean => t.kind !== "act";
export const sayTurns = (turns: readonly ScriptTurn[]): ScriptTurn[] => turns.filter(isSay);

// ---- play text ----------------------------------------------------------------------------------------------------

const SPEECH_LINE = /^([^\n:[\]]{1,40}?):\s?(.*)$/u;

/**
 * Turns of one beat of a play as the corpus keeps it: `SPEAKER: line` for speech and `[stage direction]` on its own line. A direction that
 * moves a body ("Exit", "Sits", "she runs out") is an act turn; an aside or a tone note is not a turn. A line that is not a speaker's start
 * continues the speech before it.
 */
export function parseBeatText(text: string): ScriptTurn[] {
  const turns: ScriptTurn[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("[")) {
      const direction = line.replace(/^\[|\]$/gu, "");
      if (isBodyDirection(joinedKeys(wordsOf(direction)))) turns.push({ speaker: "", text: "", kind: "act" });
      continue;
    }
    const m = SPEECH_LINE.exec(line);
    if (m && m[1] === m[1]?.toUpperCase()) {
      turns.push({ speaker: (m[1] ?? "").trim(), text: m[2] ?? "", kind: "say" });
    } else {
      const last = turns[turns.length - 1];
      if (last && last.kind === "say") last.text += ` ${line}`;
    }
  }
  return turns;
}

// ---- hotel run logs -------------------------------------------------------------------------------------------------

/** The part of a committed event the adapter reads (a `CommittedEvent` satisfies it). */
export type EventLike = {
  type: string;
  actorId: string;
  createdAt?: number;
  payload?: Record<string, unknown>;
  visibility?: { visibilityReason?: string };
};

const BODY_EVENTS = new Set(["body_action_committed", "body_arrived", "moved_room", "agent_left"]);

/**
 * Speech and body events of a hotel run as turns, in the order they were committed. A host's steering note and an admin whisper are not
 * in the scene; an event with no usable text is skipped. Body events are acts (the log keeps the sparse ones: pairs, room changes,
 * arrivals; walks and sits are in the frame log, see {@link turnsFromBodyFrames}).
 */
export function turnsFromEvents(events: readonly EventLike[]): ScriptTurn[] {
  const out: ScriptTurn[] = [];
  for (const e of events) {
    const p = e.payload ?? {};
    const at = typeof e.createdAt === "number" ? { atMs: e.createdAt } : {};
    if (e.type === "message_sent" || e.type === "reply_sent") {
      if (e.actorId === "host" || e.visibility?.visibilityReason === "admin_whisper") continue;
      const content = p["content"];
      if (typeof content !== "string" || content.trim() === "") continue;
      const name = p["senderName"];
      out.push({ speaker: typeof name === "string" && name !== "" ? name : e.actorId, text: content, kind: "say", ...at });
    } else if (BODY_EVENTS.has(e.type)) {
      out.push({ speaker: e.actorId, text: "", kind: "act", ...at });
    }
  }
  return out;
}

/** The part of a body frame the adapter reads (a `BodyFrame` satisfies it). */
export type FrameLike = { atMs: number; kind: string; data: Record<string, unknown> };

const WALK_GAP_MS = 1_500;

/**
 * Body changes from a hotel frame log as act turns: a posture change (sit, stand, lie), a room change, an avatar action, and a walk (the
 * run of `moves` frames of one actor, a gap of 1.5 s starting a new walk). Speech frames are not read; the committed events have the lines.
 */
export function turnsFromBodyFrames(frames: readonly FrameLike[]): ScriptTurn[] {
  const out: ScriptTurn[] = [];
  const posture = new Map<string, string>();
  const lastMove = new Map<string, number>();
  const who = (d: Record<string, unknown>): string => String(d["agentId"] ?? d["ref"] ?? "");
  for (const f of frames) {
    const d = f.data;
    if (f.kind === "avatar_state") {
      const ref = who(d);
      const state = String(d["state"] ?? "");
      if (ref !== "" && posture.has(ref) && posture.get(ref) !== state) out.push({ speaker: ref, text: "", kind: "act", atMs: f.atMs });
      posture.set(ref, state);
    } else if (f.kind === "avatar_action" || f.kind === "moved_room") {
      out.push({ speaker: who(d), text: "", kind: "act", atMs: f.atMs });
    } else if (f.kind === "moves") {
      const ref = who(d);
      const last = lastMove.get(ref);
      if (last === undefined || f.atMs - last > WALK_GAP_MS) out.push({ speaker: ref, text: "", kind: "act", atMs: f.atMs });
      lastMove.set(ref, f.atMs);
    }
  }
  return out;
}

/** Two turn lists in time order (turns without a time keep their place after the ones before them in their own list). */
export function mergeTurns(...lists: ReadonlyArray<readonly ScriptTurn[]>): ScriptTurn[] {
  const all = lists.flatMap((l, li) => l.map((t, i) => ({ t, key: [t.atMs ?? Number.POSITIVE_INFINITY, li, i] as const })));
  all.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
  return all.map((x) => x.t);
}
