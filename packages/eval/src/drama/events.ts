/**
 * Drama events: what happened on stage, read from a run's frames.
 *
 * Everything that depends on the hotel's wire format lives in this one file, so
 * realigning to the frozen act contract is one edit:
 *  - the real frames it reads today: `actor_cmd` (chat, action, expression, pair,
 *    appearance), `human_chat`, the deltas `chat`, `avatar_action`,
 *    `appearance_changed`, `pair_prompt`, and `pair_reaction` (shapes learned from
 *    recorded runs, see the run 7 excerpt under `__fixtures__`);
 *  - the PROVISIONAL act frames (`act_started`, `act_reaction`, `act_done`, and
 *    `actor_death`) below. They are not frozen; the field names are a guess.
 *
 * Input is `BodyFrame[]` as `normalizeFrame` / `loadHotelRun` produce them, aligned
 * (`alignWireFrames`) or not: numeric avatar ids are resolved to refs here too.
 */
import type { BodyFrame } from "@perfectman/shared";

// ---------------------------------------------------------------------------
// Provisional wire frames (NOT frozen)
// ---------------------------------------------------------------------------

export const ACT_OUTCOMES = ["landed", "dodged", "blocked", "declined", "timeout"] as const;
export type ActOutcome = (typeof ACT_OUTCOMES)[number];

export type ActStartedFrame = {
  t: "act_started";
  act_id: string;
  verb: string;
  actor: string;
  with?: string;
  /** 0..1 */
  intensity: number;
  /** The script meant this act to jump the escalation ladder; the ladder probe lets it through. */
  authored_skip?: boolean;
  /** The human target had opted in to physical drama (read by the consent probe when present). */
  target_opt_in?: boolean;
  run?: number;
  seq?: number;
};

export type ActReactionFrame = {
  t: "act_reaction";
  act_id: string;
  who: string;
  role: "target" | "witness";
  reaction: string;
};

export type ActDoneFrame = {
  t: "act_done";
  act_id: string;
  outcome: ActOutcome;
};

/** Not in the brief's list of act frames, but `actor_death` events need some wire frame to come from. */
export type ActorDeathFrame = {
  t: "actor_death";
  actor: string;
  cause?: string;
};

export type ProvisionalActFrame = ActStartedFrame | ActReactionFrame | ActDoneFrame | ActorDeathFrame;

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

type EventBase = {
  /** Milliseconds from run start (the `run_start` frame, else the first frame). */
  atMs: number;
  room?: string;
};

export type ActStartedEvent = EventBase & {
  kind: "act_started";
  actId: string;
  verb: string;
  actor: string;
  with?: string;
  intensity: number;
  /** See `ActStartedFrame.authored_skip`. */
  authoredSkip?: boolean;
  /** See `ActStartedFrame.target_opt_in`. */
  targetOptIn?: boolean;
  run?: number;
  seq?: number;
};

export type ActReactionEvent = EventBase & {
  kind: "act_reaction";
  actId: string;
  who: string;
  role: "target" | "witness";
  reaction: string;
};

export type ActDoneEvent = EventBase & {
  kind: "act_done";
  actId: string;
  outcome: ActOutcome;
};

export type ActorDeathEvent = EventBase & {
  kind: "actor_death";
  actor: string;
  cause?: string;
};

export type SpeechEvent = EventBase & {
  kind: "speech";
  actor: string;
  /** `say`, `shout`, `whisper`, or `thought` (nobody hears a thought). */
  mode: string;
  text: string;
  to?: string;
};

export const BODY_ACT_KINDS = ["gesture", "expression", "pair", "appearance", "pair_reaction"] as const;
export type BodyActKind = (typeof BODY_ACT_KINDS)[number];

/** The body vocabulary that existed before acts: gestures, expressions, kiss/hug pairs, appearance changes. */
export type BodyActEvent = EventBase & {
  kind: "body_act";
  actor: string;
  act: BodyActKind;
  /** Gesture name (`wave`), expression face (`smile`), pair kind (`kiss`), or the appearance effect. */
  name: string;
  with?: string;
  pairId?: string;
  /** `pair_reaction` only: the hotel's outcome (`accept`, `dodge`, `push`, `timeout`, `done`, `aborted`). */
  outcome?: string;
};

export type ConsentChipShownEvent = EventBase & {
  kind: "consent_chip";
  phase: "shown";
  pairId: string;
  from: string;
  pairKind: string;
  ttlMs: number;
};

/** `take` is the answer to a consent chip for an act (the human agrees to take the hit); the others come from pair chips. */
export const CONSENT_ANSWERS = ["accept", "decline", "timeout", "take"] as const;
export type ConsentAnswer = (typeof CONSENT_ANSWERS)[number];

export type ConsentChipAnsweredEvent = EventBase & {
  kind: "consent_chip";
  phase: "answered";
  pairId: string;
  actor: string;
  with: string;
  answer: ConsentAnswer;
  /** The act this chip was asked for, when it was asked for an act rather than a pair. */
  actId?: string;
};

export type ConsentChipEvent = ConsentChipShownEvent | ConsentChipAnsweredEvent;

export type DramaEvent =
  | ActStartedEvent
  | ActReactionEvent
  | ActDoneEvent
  | ActorDeathEvent
  | SpeechEvent
  | BodyActEvent
  | ConsentChipEvent;

export type DramaEventKind = DramaEvent["kind"];

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);
const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Same-instant events read in this order, so an act is never `done` before it is `started`. */
const KIND_ORDER: Record<DramaEventKind, number> = {
  act_started: 0,
  act_reaction: 1,
  act_done: 2,
  actor_death: 3,
  consent_chip: 4,
  body_act: 5,
  speech: 6,
};

/** A command, the hotel's echo of it and the sidecar's copy of it are one event inside this window (each source counts once). */
const ECHO_WINDOW_MS = 5_000;

type Mergeable = SpeechEvent | BodyActEvent;
/** `seen` holds the sources a merged event was read from (`cmd:in`, `cmd:out`, `echo:out`...): each source adds a copy at most once. */
type Candidate = { event: Mergeable; key: string; seen: Set<string> };

const compareFrames = (a: BodyFrame, b: BodyFrame): number =>
  a.atMs - b.atMs ||
  a.kind.localeCompare(b.kind) ||
  a.dir.localeCompare(b.dir) ||
  JSON.stringify(a.data).localeCompare(JSON.stringify(b.data));

const compareEvents = (a: DramaEvent, b: DramaEvent): number =>
  a.atMs - b.atMs || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || JSON.stringify(a).localeCompare(JSON.stringify(b));

function outcomeToAnswer(outcome: string): ConsentAnswer | undefined {
  switch (outcome) {
    case "accept":
      return "accept";
    case "dodge":
    case "push":
      return "decline";
    case "timeout":
      return "timeout";
    default:
      // `done` (actor to actor) and `aborted` never put a chip in front of anyone
      return undefined;
  }
}

export function extractDramaEvents(frames: readonly BodyFrame[]): DramaEvent[] {
  const sorted = [...frames].sort(compareFrames);
  if (sorted.length === 0) return [];
  const runStart = sorted.find((f) => f.kind === "run_start");
  const start = (runStart ?? sorted[0]!).atMs;

  // Who is who: the hotel's numeric avatar ids to the actors' refs; a human the hotel names h:<id>.
  const names = new Map<string, string>();
  for (const f of sorted) {
    if (f.kind === "actor_spawned" && f.data["actor"] !== undefined && text(f.data["ref"])) names.set(String(f.data["actor"]), String(f.data["ref"]));
    if (f.kind === "human_chat" && text(f.data["fromId"])) names.set(String(f.data["fromId"]), String(f.data["ref"]));
  }
  const who = (id: unknown): string => {
    const key = String(id);
    return names.get(key) ?? (/^\d+$/.test(key) ? `h:${key}` : key);
  };

  const roomOf = new Map<string, string>();
  const actRoom = new Map<string, string>();
  const pairs = new Map<string, { kind: string; with: string }>();
  const out: DramaEvent[] = [];
  const cands: Candidate[] = [];

  const withRoom = (room: string | undefined): { room?: string } => (room !== undefined ? { room } : {});

  const addCandidate = (event: Mergeable, origin: "cmd" | "echo", dir: "in" | "out", key: string): void => {
    const source = `${origin}:${dir}`;
    const twin = cands.find(
      (c) => !c.seen.has(source) && c.event.kind === event.kind && c.event.actor === event.actor && c.key === key && Math.abs(c.event.atMs - event.atMs) <= ECHO_WINDOW_MS,
    );
    if (twin) {
      // the command's name (`smile`) is richer than the echo's (`expression`); other fields fill gaps
      if (origin === "cmd" && !twin.seen.has("cmd:in") && !twin.seen.has("cmd:out") && twin.event.kind === "body_act" && event.kind === "body_act") twin.event.name = event.name;
      for (const [k, v] of Object.entries(event)) if (v !== undefined && !(k in twin.event)) (twin.event as Json)[k] = v;
      twin.seen.add(source);
      return;
    }
    cands.push({ event, key, seen: new Set([source]) });
    out.push(event);
  };

  const speech = (f: BodyFrame, actor: string, mode: string, body: string | undefined, to: string | undefined, origin: "cmd" | "echo"): void => {
    if (body === undefined) return; // the sidecar's body log keeps no text; the same line comes from the wire log
    const room = f.room ?? roomOf.get(actor);
    addCandidate({ kind: "speech", atMs: f.atMs - start, ...withRoom(room), actor, mode, text: body, ...(to !== undefined ? { to } : {}) }, origin, f.dir, `speech|${mode}|${body}`);
  };

  const bodyAct = (f: BodyFrame, actor: string, act: BodyActKind, name: string, origin: "cmd" | "echo", extra: { with?: string; pairId?: string } = {}): void => {
    const room = f.room ?? roomOf.get(actor);
    const key = act === "gesture" ? `gesture|${name}` : act === "pair" ? `pair|${extra.pairId ?? ""}` : act;
    addCandidate({ kind: "body_act", atMs: f.atMs - start, ...withRoom(room), actor, act, name, ...extra }, origin, f.dir, key);
  };

  const action = (f: BodyFrame, actor: string, name: string, origin: "cmd" | "echo"): void => {
    if (name.startsWith("face:")) return; // a turn toward someone, not a gesture
    if (name === "expression") bodyAct(f, actor, "expression", "expression", origin);
    else bodyAct(f, actor, "gesture", name, origin);
  };

  for (const f of sorted) {
    const d = f.data;
    switch (f.kind) {
      case "actor_spawned": {
        if (f.room !== undefined && d["ref"] !== undefined) roomOf.set(String(d["ref"]), f.room);
        break;
      }
      case "moved_room": {
        const actor = who(d["actor"] ?? d["agentId"]);
        if (d["to"] !== undefined) roomOf.set(actor, String(d["to"]));
        break;
      }
      case "chat": {
        const to = text(d["toRef"]);
        speech(f, who(d["agentId"]), text(d["mode"]) ?? "say", text(d["text"]), to !== undefined ? who(to) : undefined, "cmd");
        break;
      }
      case "human_chat": {
        const to = text(d["toRef"]);
        speech(f, who(d["ref"]), text(d["mode"]) ?? "say", text(d["text"]), to !== undefined ? who(to) : undefined, "cmd");
        break;
      }
      case "actor_cmd": {
        const cmd = d["cmd"];
        if (!isObj(cmd)) break;
        // the hotel-side frame names the actor `agentId` after normalizing; the sidecar's own body log names it `actor`
        const actor = who(d["agentId"] ?? d["actor"]);
        if (cmd["k"] === "action" && text(cmd["action"])) action(f, actor, String(cmd["action"]), "cmd");
        else if (cmd["k"] === "expression" && text(cmd["face"])) bodyAct(f, actor, "expression", String(cmd["face"]), "cmd");
        else if (cmd["k"] === "pair" && text(cmd["kind"]) && text(cmd["pair"]) && cmd["with"] !== undefined) {
          const pairId = String(cmd["pair"]);
          pairs.set(pairId, { kind: String(cmd["kind"]), with: who(cmd["with"]) });
          bodyAct(f, actor, "pair", String(cmd["kind"]), "cmd", { with: who(cmd["with"]), pairId });
        } else if (cmd["k"] === "appearance") bodyAct(f, actor, "appearance", text(cmd["effect"]) ?? "appearance", "cmd");
        break;
      }
      case "avatar_action": {
        if (text(d["a"])) action(f, who(d["agentId"]), String(d["a"]), "echo");
        break;
      }
      case "pair_reaction": {
        const pairId = text(d["pair"]);
        const outcome = text(d["outcome"]);
        if (!pairId || !outcome) break;
        const actor = who(d["actor"]);
        const target = d["with"] !== undefined ? who(d["with"]) : (pairs.get(pairId)?.with ?? undefined);
        const room = f.room ?? roomOf.get(actor);
        out.push({
          kind: "body_act",
          atMs: f.atMs - start,
          ...withRoom(room),
          actor,
          act: "pair_reaction",
          name: pairs.get(pairId)?.kind ?? "pair",
          ...(target !== undefined ? { with: target } : {}),
          pairId,
          outcome,
        });
        const answer = outcomeToAnswer(outcome);
        if (answer !== undefined && target !== undefined) out.push({ kind: "consent_chip", phase: "answered", atMs: f.atMs - start, ...withRoom(room), pairId, actor, with: target, answer });
        break;
      }
      case "delta": {
        const msg = d["msg"];
        if (!isObj(msg)) break;
        const t = msg["t"];
        if (t === "chat" && msg["from"] !== undefined) {
          const to = text(msg["to"]);
          speech(f, who(msg["from"]), text(msg["mode"]) ?? "say", text(msg["text"]), to !== undefined ? who(to) : undefined, "echo");
        } else if (t === "avatar_action" && msg["id"] !== undefined && text(msg["action"])) action(f, who(msg["id"]), String(msg["action"]), "echo");
        else if (t === "appearance_changed" && msg["id"] !== undefined) bodyAct(f, who(msg["id"]), "appearance", text(msg["effect"]) ?? "appearance", "echo");
        else if (t === "pair_prompt" && text(msg["pair"]) && msg["from"] !== undefined) {
          const from = who(msg["from"]);
          out.push({
            kind: "consent_chip",
            phase: "shown",
            atMs: f.atMs - start,
            ...withRoom(f.room ?? roomOf.get(from)),
            pairId: String(msg["pair"]),
            from,
            pairKind: text(msg["kind"]) ?? "pair",
            ttlMs: finite(msg["ttl_ms"]) ?? 0,
          });
        }
        break;
      }
      case "act_started": {
        const actId = text(d["act_id"]);
        const verb = text(d["verb"]);
        const actorId = d["actor"];
        const intensity = finite(d["intensity"]);
        if (!actId || !verb || actorId === undefined || intensity === undefined || intensity < 0 || intensity > 1) break;
        const actor = who(actorId);
        const room = f.room ?? roomOf.get(actor);
        if (room !== undefined) actRoom.set(actId, room);
        const run = finite(d["run"]);
        const seq = finite(d["seq"]);
        const authoredSkip = d["authored_skip"];
        const targetOptIn = d["target_opt_in"];
        out.push({
          kind: "act_started",
          atMs: f.atMs - start,
          ...withRoom(room),
          actId,
          verb,
          actor,
          ...(d["with"] !== undefined && d["with"] !== null ? { with: who(d["with"]) } : {}),
          intensity,
          ...(typeof authoredSkip === "boolean" ? { authoredSkip } : {}),
          ...(typeof targetOptIn === "boolean" ? { targetOptIn } : {}),
          ...(run !== undefined ? { run } : {}),
          ...(seq !== undefined ? { seq } : {}),
        });
        break;
      }
      case "act_reaction": {
        const actId = text(d["act_id"]);
        const reaction = text(d["reaction"]);
        const role = d["role"];
        if (!actId || !reaction || d["who"] === undefined || (role !== "target" && role !== "witness")) break;
        const reactor = who(d["who"]);
        out.push({ kind: "act_reaction", atMs: f.atMs - start, ...withRoom(f.room ?? actRoom.get(actId) ?? roomOf.get(reactor)), actId, who: reactor, role, reaction });
        break;
      }
      case "act_done": {
        const actId = text(d["act_id"]);
        const outcome = ACT_OUTCOMES.find((o) => o === d["outcome"]);
        if (!actId || outcome === undefined) break;
        out.push({ kind: "act_done", atMs: f.atMs - start, ...withRoom(f.room ?? actRoom.get(actId)), actId, outcome });
        break;
      }
      case "actor_death": {
        if (d["actor"] === undefined) break;
        const actor = who(d["actor"]);
        const cause = text(d["cause"]);
        out.push({ kind: "actor_death", atMs: f.atMs - start, ...withRoom(f.room ?? roomOf.get(actor)), actor, ...(cause !== undefined ? { cause } : {}) });
        break;
      }
      default:
        break;
    }
    // where an actor last was, for the events that carry no room of their own
    const actorField = d["agentId"] ?? d["actor"];
    if (f.room !== undefined && actorField !== undefined && f.kind !== "pair_reaction") roomOf.set(who(actorField), f.room);
  }

  return out.sort(compareEvents);
}
