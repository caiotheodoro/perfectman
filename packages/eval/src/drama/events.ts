/**
 * Drama events: what happened on stage, read from a run's frames.
 *
 * Everything that depends on the hotel's wire format lives in this one file. It reads:
 *  - the frames the hotel already sent: `actor_cmd` (chat, action, expression, pair,
 *    appearance), `human_chat`, the deltas `chat`, `avatar_action`,
 *    `appearance_changed`, `pair_prompt`, and `pair_reaction` (shapes learned from
 *    recorded runs, see the run 7 excerpt under `__fixtures__`);
 *  - the act frames of the frozen act contract (docs/drama/act-contract.md, revision 2, section 3):
 *    `act_started`, `act_beat`, `act_reaction`, `act_done`, `drama_consent`, `actor_death`,
 *    `actor_revive`, `human_down`, `human_up`, `scene_cut` and `drama_state`. `scene_advance` and
 *    `act_overlay_clear` are not read: the first is the sidecar's own command, the second only
 *    ends a client overlay, which no probe or judge looks at.
 *
 * Input is `BodyFrame[]` as `normalizeFrame` / `loadHotelRun` produce them, aligned
 * (`alignWireFrames`) or not: numeric avatar ids are resolved to refs here too, by one rule:
 * a positive id is the human `h:<id>`, a negative id is its actor's ref (learned from
 * `actor_spawned`, else the id as text).
 *
 * Two clocks. `atMs` is run-relative and comes from the frame log's wrapper (`ts_ms`), the one clock every
 * frame has. `hotelAt` is the hotel's own `at` (epoch ms) when the frame carries one: the contract's latency
 * rules (REA-1, DOWN-3) are stated on it, so the probes prefer it and fall back to `atMs`.
 */
import type { BodyFrame } from "@perfectman/shared";

// ---------------------------------------------------------------------------
// Closed sets of the act contract (section 0.2)
// ---------------------------------------------------------------------------

export const ACT_OUTCOMES = ["landed", "dodged", "blocked", "declined", "timeout", "aborted"] as const;
export type ActOutcome = (typeof ACT_OUTCOMES)[number];

export const BLOCKED_REASONS = ["kill_switch", "calm_room", "consent_off", "ladder", "budget", "cooldown", "too_far", "dead_target", "no_scenario_gate", "rate_limit"] as const;
export type BlockedReason = (typeof BLOCKED_REASONS)[number];

export const ABORT_REASONS = ["target_moved", "target_gone", "actor_gone", "actor_dead", "scene_cut", "run_end", "kill_switch", "calm_room", "paused", "opt_out"] as const;
export type AbortReason = (typeof ABORT_REASONS)[number];

export const CHIP_ANSWERS = ["take", "dodge", "push_back", "timeout"] as const;
export type ChipAnswer = (typeof CHIP_ANSWERS)[number];

export const IMPACT_CLASSES = ["L", "M", "H", "F"] as const;
export type ImpactClass = (typeof IMPACT_CLASSES)[number];

export const ACT_ORIGINS = ["model", "director", "scenario"] as const;
export type ActOrigin = (typeof ACT_ORIGINS)[number];

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

type EventBase = {
  /** Milliseconds from run start (the `run_start` frame, else the first frame), on the frame log's clock. */
  atMs: number;
  /** The hotel's own `at` (epoch ms), when the frame carries one. */
  hotelAt?: number;
  room?: string;
};

/** Who owes a reaction, as `act_beat.owed` and `act_done.owed_missed` list them (actors only). */
export type OwedRole = "target" | "witness";
export type OwedDebt = { who: string; role: OwedRole };

export type ActStartedEvent = EventBase & {
  kind: "act_started";
  actId: string;
  verb: string;
  actor: string;
  /** Absent for the solo verbs. A human target is `h:<id>`. */
  with?: string;
  intensity: number;
  /** `<run>.<n>`. Every ladder, spacing and kill rule is per scene. */
  scene?: string;
  impact?: ImpactClass;
  origin?: ActOrigin;
  /** The verb's ladder rung, 1 to 6; absent off the ladder. */
  rung?: number;
  skippedRungs?: string[];
  /** The script meant this act to jump the escalation ladder; the ladder probe lets it through. */
  authoredSkip?: boolean;
  /** Present only when the target is a human: that human's session flag at the start. */
  targetOptIn?: boolean;
  /** A consent chip will be shown. */
  chip?: boolean;
  /** Planned contact after the start when there is no chip; absent when the chip decides. */
  contactInMs?: number;
  run?: number;
  seq?: number;
};

/** Contact: the clock for the reaction deadlines, and the only ground truth of who owes a reaction. */
export type ActBeatEvent = EventBase & {
  kind: "act_beat";
  actId: string;
  beat: string;
  /** Everybody who saw it, humans included. */
  witnesses: string[];
  owed: Array<OwedDebt & { dueAt?: number }>;
  scene?: string;
};

export type ActReactionEvent = EventBase & {
  kind: "act_reaction";
  actId: string;
  who: string;
  role: OwedRole;
  /** A table label, or `cmd:<k>` for a planner command. */
  reaction: string;
  /** `table` or `planner`; both count. */
  source?: string;
  scene?: string;
};

export type ActDoneEvent = EventBase & {
  kind: "act_done";
  actId: string;
  outcome: ActOutcome;
  /** Present on every contract frame; a blocked act has no `act_started`, so this is all that says what it was. */
  verb?: string;
  actor?: string;
  with?: string;
  /** The chip answer, present iff a chip was shown. */
  answer?: ChipAnswer;
  /** A blocked reason (outcome `blocked`) or an abort reason (outcome `aborted`), as sent. */
  reason?: string;
  detail?: string;
  /** Reactions still owed when the window closed; empty for every table-driven act (REA-10). */
  owedMissed?: OwedDebt[];
  downgraded?: string[];
  scene?: string;
};

export type ActorDeathEvent = EventBase & {
  kind: "actor_death";
  actor: string;
  /** `kill` or `die`. */
  cause?: string;
  actId?: string;
  killer?: string;
  scene?: string;
};

/** A dead actor stands up at a scene cut. */
export type ActorReviveEvent = EventBase & {
  kind: "actor_revive";
  actor: string;
  scene?: string;
  prev?: string;
  x?: number;
  y?: number;
};

/** A killed human is down for `ms`; they are not dead. */
export type HumanDownEvent = EventBase & {
  kind: "human_down";
  human: string;
  actId?: string;
  ms: number;
  scene?: string;
};

export type HumanUpEvent = EventBase & {
  kind: "human_up";
  human: string;
  actId?: string;
  /** `timer`, `left` or `closed`. */
  reason?: string;
};

export type SceneCutEvent = EventBase & {
  kind: "scene_cut";
  /** The new scene. */
  scene: string;
  prev?: string;
  revived: string[];
  removed: string[];
};

export type DramaStateEvent = EventBase & {
  kind: "drama_state";
  scene?: string;
  enabled?: boolean;
  calm?: boolean;
  paused?: boolean;
  pausedUntil?: number;
  /** Humans in the room whose session flag is on. */
  optIn: string[];
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
  /** The act's id for an act chip. */
  pairId: string;
  from: string;
  pairKind: string;
  ttlMs: number;
  /** The act this chip was shown for, when it was shown for an act rather than a pair. */
  actId?: string;
  /** `violent` or `affection`. */
  family?: string;
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
  /** The chip answer as the hotel sent it (`take`, `dodge`, `push_back`, `timeout`); absent for a pair chip. */
  rawAnswer?: ChipAnswer;
  family?: string;
};

export type ConsentChipEvent = ConsentChipShownEvent | ConsentChipAnsweredEvent;

export type DramaEvent =
  | ActStartedEvent
  | ActBeatEvent
  | ActReactionEvent
  | ActDoneEvent
  | ActorDeathEvent
  | ActorReviveEvent
  | HumanDownEvent
  | HumanUpEvent
  | SceneCutEvent
  | DramaStateEvent
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

/** Same-instant events read in this order (the contract's FRM-1 order), so an act is never `done` before it is `started`. */
const KIND_ORDER: Record<DramaEventKind, number> = {
  act_started: 0,
  consent_chip: 1,
  act_beat: 2,
  act_reaction: 3,
  actor_death: 4,
  human_down: 5,
  act_done: 6,
  human_up: 7,
  scene_cut: 8,
  actor_revive: 9,
  drama_state: 10,
  body_act: 11,
  speech: 12,
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

/** The chip answer as a `ConsentAnswer`: a dodge and a push back both decline. */
function chipAnswerToConsent(answer: ChipAnswer): ConsentAnswer {
  switch (answer) {
    case "take":
      return "take";
    case "dodge":
    case "push_back":
      return "decline";
    case "timeout":
      return "timeout";
    default: {
      const unreachable: never = answer;
      return unreachable;
    }
  }
}

/** `act_beat.owed` (with `due_at`) or `act_done.owed_missed`: actors only. An entry that names no one or has no role is skipped. */
function owedList(raw: unknown, who: (id: unknown) => string, withDue: true): Array<OwedDebt & { dueAt?: number }> | undefined;
function owedList(raw: unknown, who: (id: unknown) => string, withDue: false): OwedDebt[] | undefined;
function owedList(raw: unknown, who: (id: unknown) => string, withDue: boolean): OwedDebt[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const debts: Array<OwedDebt & { dueAt?: number }> = [];
  for (const entry of raw) {
    if (!isObj(entry) || entry["who"] === undefined || (entry["role"] !== "target" && entry["role"] !== "witness")) continue;
    const due = finite(entry["due_at"]);
    debts.push({ who: who(entry["who"]), role: entry["role"], ...(withDue && due !== undefined ? { dueAt: due } : {}) });
  }
  return debts;
}

export function extractDramaEvents(frames: readonly BodyFrame[]): DramaEvent[] {
  const sorted = [...frames].sort(compareFrames);
  if (sorted.length === 0) return [];
  const runStart = sorted.find((f) => f.kind === "run_start");
  const start = (runStart ?? sorted[0]!).atMs;

  // Who is who: the hotel's negative avatar ids to the actors' refs (learned from `actor_spawned`). A positive id is a
  // human, always `h:<id>`: a chat line never renames them.
  const names = new Map<string, string>();
  for (const f of sorted) if (f.kind === "actor_spawned" && f.data["actor"] !== undefined && text(f.data["ref"])) names.set(String(f.data["actor"]), String(f.data["ref"]));
  const who = (id: unknown): string => {
    const key = String(id);
    return names.get(key) ?? (/^\d+$/.test(key) ? `h:${key}` : key);
  };
  const whoList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((id) => typeof id === "number" || typeof id === "string").map(who) : undefined);

  // The scene and room of each act, from its `act_started`, for the frames that carry only an act_id (they may sort before it on a tied stamp).
  const actScene = new Map<string, string>();
  for (const f of sorted) if (f.kind === "act_started" && text(f.data["act_id"]) && text(f.data["scene"])) actScene.set(String(f.data["act_id"]), String(f.data["scene"]));
  const sceneOfAct = (actId: string): { scene?: string } => (actScene.has(actId) ? { scene: actScene.get(actId)! } : {});
  const stamped = (d: Json): { hotelAt?: number } => {
    const at = finite(d["at"]);
    return at !== undefined ? { hotelAt: at } : {};
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
        const rung = finite(d["rung"]);
        const contactInMs = finite(d["contact_in_ms"]);
        const impact = IMPACT_CLASSES.find((c) => c === d["impact"]);
        const origin = ACT_ORIGINS.find((o) => o === d["origin"]);
        const skipped = Array.isArray(d["skipped_rungs"]) ? d["skipped_rungs"].filter((v): v is string => typeof v === "string") : undefined;
        const authoredSkip = d["authored_skip"];
        const targetOptIn = d["target_opt_in"];
        const chip = d["chip"];
        out.push({
          kind: "act_started",
          atMs: f.atMs - start,
          ...stamped(d),
          ...withRoom(room),
          actId,
          verb,
          actor,
          ...(d["with"] !== undefined && d["with"] !== null ? { with: who(d["with"]) } : {}),
          intensity,
          ...(text(d["scene"]) ? { scene: String(d["scene"]) } : {}),
          ...(impact !== undefined ? { impact } : {}),
          ...(origin !== undefined ? { origin } : {}),
          ...(rung !== undefined && Number.isInteger(rung) && rung >= 1 && rung <= 6 ? { rung } : {}),
          ...(skipped !== undefined ? { skippedRungs: skipped } : {}),
          ...(typeof authoredSkip === "boolean" ? { authoredSkip } : {}),
          ...(typeof targetOptIn === "boolean" ? { targetOptIn } : {}),
          ...(typeof chip === "boolean" ? { chip } : {}),
          ...(contactInMs !== undefined ? { contactInMs } : {}),
          ...(run !== undefined ? { run } : {}),
          ...(seq !== undefined ? { seq } : {}),
        });
        break;
      }
      case "act_beat": {
        const actId = text(d["act_id"]);
        const witnesses = whoList(d["witnesses"]);
        const owed = owedList(d["owed"], who, true);
        if (!actId || witnesses === undefined || owed === undefined) break;
        out.push({
          kind: "act_beat",
          atMs: f.atMs - start,
          ...stamped(d),
          ...withRoom(f.room ?? actRoom.get(actId)),
          actId,
          beat: text(d["beat"]) ?? "contact",
          witnesses,
          owed,
          ...sceneOfAct(actId),
        });
        break;
      }
      case "act_reaction": {
        const actId = text(d["act_id"]);
        const reaction = text(d["reaction"]);
        const role = d["role"];
        if (!actId || !reaction || d["who"] === undefined || (role !== "target" && role !== "witness")) break;
        const reactor = who(d["who"]);
        const source = text(d["source"]);
        out.push({
          kind: "act_reaction",
          atMs: f.atMs - start,
          ...stamped(d),
          ...withRoom(f.room ?? actRoom.get(actId) ?? roomOf.get(reactor)),
          actId,
          who: reactor,
          role,
          reaction,
          ...(source !== undefined ? { source } : {}),
          ...sceneOfAct(actId),
        });
        break;
      }
      case "act_done": {
        const actId = text(d["act_id"]);
        const outcome = ACT_OUTCOMES.find((o) => o === d["outcome"]);
        if (!actId || outcome === undefined) break;
        const answer = CHIP_ANSWERS.find((a) => a === d["answer"]);
        const missed = owedList(d["owed_missed"], who, false);
        const downgraded = Array.isArray(d["downgraded"]) ? d["downgraded"].filter((v): v is string => typeof v === "string") : undefined;
        out.push({
          kind: "act_done",
          atMs: f.atMs - start,
          ...stamped(d),
          ...withRoom(f.room ?? actRoom.get(actId)),
          actId,
          outcome,
          ...(text(d["verb"]) ? { verb: String(d["verb"]) } : {}),
          ...(d["actor"] !== undefined && d["actor"] !== null ? { actor: who(d["actor"]) } : {}),
          ...(d["with"] !== undefined && d["with"] !== null ? { with: who(d["with"]) } : {}),
          ...(answer !== undefined ? { answer } : {}),
          ...(text(d["reason"]) ? { reason: String(d["reason"]) } : {}),
          ...(text(d["detail"]) ? { detail: String(d["detail"]) } : {}),
          ...(missed !== undefined ? { owedMissed: missed } : {}),
          ...(downgraded !== undefined ? { downgraded } : {}),
          ...sceneOfAct(actId),
        });
        break;
      }
      case "drama_consent": {
        const actId = text(d["act_id"]);
        if (!actId || d["actor"] === undefined || d["with"] === undefined) break;
        const actor = who(d["actor"]);
        const room = f.room ?? actRoom.get(actId) ?? roomOf.get(actor);
        const family = text(d["family"]);
        if (d["phase"] === "shown") {
          out.push({
            kind: "consent_chip",
            phase: "shown",
            atMs: f.atMs - start,
            ...stamped(d),
            ...withRoom(room),
            actId,
            pairId: actId,
            from: actor,
            pairKind: text(d["verb"]) ?? "act",
            ttlMs: finite(d["ttl_ms"]) ?? 0,
            ...(family !== undefined ? { family } : {}),
          });
        } else if (d["phase"] === "answered") {
          const rawAnswer = CHIP_ANSWERS.find((a) => a === d["answer"]);
          if (rawAnswer === undefined) break;
          out.push({
            kind: "consent_chip",
            phase: "answered",
            atMs: f.atMs - start,
            ...stamped(d),
            ...withRoom(room),
            actId,
            pairId: actId,
            actor,
            with: who(d["with"]),
            answer: chipAnswerToConsent(rawAnswer),
            rawAnswer,
            ...(family !== undefined ? { family } : {}),
          });
        }
        break;
      }
      case "actor_death": {
        if (d["actor"] === undefined) break;
        const actor = who(d["actor"]);
        const cause = text(d["cause"]);
        const actId = text(d["act_id"]);
        out.push({
          kind: "actor_death",
          atMs: f.atMs - start,
          ...stamped(d),
          ...withRoom(f.room ?? roomOf.get(actor)),
          actor,
          ...(cause !== undefined ? { cause } : {}),
          ...(actId !== undefined ? { actId } : {}),
          ...(d["killer"] !== undefined && d["killer"] !== null ? { killer: who(d["killer"]) } : {}),
          ...(text(d["scene"]) ? { scene: String(d["scene"]) } : {}),
        });
        break;
      }
      case "actor_revive": {
        if (d["actor"] === undefined) break;
        const actor = who(d["actor"]);
        const x = finite(d["x"]);
        const y = finite(d["y"]);
        out.push({
          kind: "actor_revive",
          atMs: f.atMs - start,
          ...stamped(d),
          ...withRoom(f.room ?? roomOf.get(actor)),
          actor,
          ...(text(d["scene"]) ? { scene: String(d["scene"]) } : {}),
          ...(text(d["prev"]) ? { prev: String(d["prev"]) } : {}),
          ...(x !== undefined ? { x } : {}),
          ...(y !== undefined ? { y } : {}),
        });
        break;
      }
      case "human_down": {
        const ms = finite(d["ms"]);
        if (d["human"] === undefined || ms === undefined) break;
        const actId = text(d["act_id"]);
        out.push({
          kind: "human_down",
          atMs: f.atMs - start,
          ...stamped(d),
          ...withRoom(f.room),
          human: who(d["human"]),
          ...(actId !== undefined ? { actId } : {}),
          ms,
          ...(text(d["scene"]) ? { scene: String(d["scene"]) } : {}),
        });
        break;
      }
      case "human_up": {
        if (d["human"] === undefined) break;
        const actId = text(d["act_id"]);
        out.push({
          kind: "human_up",
          atMs: f.atMs - start,
          ...stamped(d),
          ...withRoom(f.room),
          human: who(d["human"]),
          ...(actId !== undefined ? { actId } : {}),
          ...(text(d["reason"]) ? { reason: String(d["reason"]) } : {}),
        });
        break;
      }
      case "scene_cut": {
        const scene = text(d["scene"]);
        if (!scene) break;
        out.push({
          kind: "scene_cut",
          atMs: f.atMs - start,
          ...stamped(d),
          ...withRoom(f.room),
          scene,
          ...(text(d["prev"]) ? { prev: String(d["prev"]) } : {}),
          revived: whoList(d["revived"]) ?? [],
          removed: whoList(d["removed"]) ?? [],
        });
        break;
      }
      case "drama_state": {
        const pausedUntil = finite(d["paused_until"]);
        out.push({
          kind: "drama_state",
          atMs: f.atMs - start,
          ...stamped(d),
          ...withRoom(f.room),
          ...(text(d["scene"]) ? { scene: String(d["scene"]) } : {}),
          ...(typeof d["enabled"] === "boolean" ? { enabled: d["enabled"] } : {}),
          ...(typeof d["calm"] === "boolean" ? { calm: d["calm"] } : {}),
          ...(typeof d["paused"] === "boolean" ? { paused: d["paused"] } : {}),
          ...(pausedUntil !== undefined ? { pausedUntil } : {}),
          optIn: whoList(d["opt_in"]) ?? [],
        });
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
