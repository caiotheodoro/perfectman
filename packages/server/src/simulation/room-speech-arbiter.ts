import type {
  ArbiterConfig,
  ArbiterDecision,
  ArbiterLineKind,
  ArbiterRule,
  IRoomSpeechArbiter,
} from "./hotel-runtime-api.js";

/**
 * Room speech arbiter (ADR-0021). Wall-clock turn-taking for speech in a room
 * channel: one answer per human line (bystanders stay quiet once it is answered, until the
 * room has been quiet for the ambient period), a line budget per human line, human
 * typing suppression and a quiet period before ambient talk. A denial is a
 * `policy_blocked` violation (never `rateLimited`), so the resolver's
 * `fallbackIfBlocked` path commits a `no_op` and the simulation never believes
 * an unheard line was spoken. Spacing (<= 1 line / 2.5 s / room) is the
 * gateway's job, not this class's.
 */
export const DEFAULT_ARBITER_CONFIG: ArbiterConfig = {
  humanTypingSuppressMs: 6_000,
  ambientQuietMs: 10_000,
  minLineBudget: 3,
  scenarioEnergy: 0.5,
};

/** Room channels are named `room:<id>`; anything else is not arbitrated. */
export const ROOM_CHANNEL_PREFIX = "room:";

export function roomIdOfChannel(channelId: string): string | undefined {
  return channelId.startsWith(ROOM_CHANNEL_PREFIX) ? channelId.slice(ROOM_CHANNEL_PREFIX.length) : undefined;
}

type HumanLineState = {
  eventId: string;
  at: number;
  addressed: Set<string>;
  answeredBy: Set<string>;
  /** Whispered: only the reply to this very line answers it. */
  whisper: boolean;
};

/** Human lines kept per room; the oldest drop first. */
const MAX_OPEN_LINES = 8;
/** A line nobody answered stops holding the room (and its addressee's reply slot) after this long. */
export const OPEN_LINE_MS = 15_000;

type RoomState = {
  /** Recent human lines, oldest first. Each addressee tracks its own open line(s). */
  humanLines: HumanLineState[];
  lastHumanSpeechAt: number | null;
  typingUntil: number;
  lastActorLineAt: number | null;
  actorLinesSinceHuman: number;
};

function blocked(rule: ArbiterRule): ArbiterDecision {
  return {
    outcome: "blocked",
    violation: { type: "policy_blocked", detail: `room_speech:${rule}` },
    rateLimited: false,
  };
}

const ALLOWED: ArbiterDecision = { outcome: "allowed" };

export class RoomSpeechArbiter implements IRoomSpeechArbiter {
  private readonly rooms = new Map<string, RoomState>();
  private readonly config: ArbiterConfig;

  constructor(config: Partial<ArbiterConfig> = {}) {
    this.config = { ...DEFAULT_ARBITER_CONFIG, ...config };
  }

  noteHumanLine(roomId: string, line: { eventId: string; at: number; addressedIds: string[]; whisper?: boolean }): void {
    const room = this.room(roomId);
    // The same line noted twice must not reopen it for an addressee that already answered.
    if (room.humanLines.some((l) => l.eventId === line.eventId)) return;
    room.humanLines.push({
      eventId: line.eventId,
      at: line.at,
      addressed: new Set(line.addressedIds),
      answeredBy: new Set(),
      whisper: line.whisper === true,
    });
    if (room.humanLines.length > MAX_OPEN_LINES) room.humanLines.splice(0, room.humanLines.length - MAX_OPEN_LINES);
    room.lastHumanSpeechAt = line.at;
    room.typingUntil = 0;
    room.actorLinesSinceHuman = 0;
  }

  noteHumanTyping(roomId: string, typing: boolean, at: number): void {
    this.room(roomId).typingUntil = typing ? at + this.config.humanTypingSuppressMs : 0;
  }

  /**
   * What this agent's next line would be, from the room's state alone: an
   * addressee that has not answered yet is `addressed`; inside the quiet
   * window after a human line it is an `interjection`; otherwise `ambient`.
   */
  classify(agentId: string, roomId: string, now: number, answering?: string): ArbiterLineKind {
    const room = this.rooms.get(roomId);
    if (room && this.openLinesFor(room, agentId, now, answering).length > 0) return "addressed";
    const line = room?.humanLines.at(-1);
    if (line && now - line.at < this.effectiveQuietMs()) return "interjection";
    return "ambient";
  }

  /** Decide phase: false means skip generation for this non-addressed agent. */
  preview(agentId: string, roomId: string, now: number): ArbiterDecision {
    const room = this.rooms.get(roomId);
    if (!room) return ALLOWED;
    if (this.classify(agentId, roomId, now) === "addressed") return ALLOWED;
    // A skip must be safe whichever way the line would be classified, so only
    // deny when both readings are denied.
    // The duplicate-reply rule is the resolver's alone: two pulses already in flight cannot be told apart here, and skipping an addressee on a guess costs it its turn.
    const asInterjection = this.check(room, agentId, "interjection", now, true);
    const asAmbient = this.check(room, agentId, "ambient", now);
    return asInterjection && asAmbient ? blocked(asInterjection) : ALLOWED;
  }

  /** Resolver phase, authoritative. Records the line when allowed. */
  gate(agentId: string, roomId: string, kind: ArbiterLineKind, now: number, answering?: string): ArbiterDecision {
    const room = this.room(roomId);
    // A kind decided earlier can be stale (another pulse answered the line since): addressed only while a line is still open for the agent.
    const effective: ArbiterLineKind =
      kind === "addressed" && room.humanLines.length > 0 && this.openLinesFor(room, agentId, now, answering).length === 0 ? "interjection" : kind;
    const rule = this.check(room, agentId, effective, now);
    if (rule) return blocked(rule);
    room.lastActorLineAt = now;
    room.actorLinesSinceHuman += 1;
    // One line answers the oldest line still open for this agent. A whisper is answered by its own reply and by nothing
    // else: a line the agent had in flight when it came in must not close it.
    if (effective !== "ambient") {
      const whispered = answering !== undefined ? room.humanLines.find((l) => l.eventId === answering && l.whisper) : undefined;
      (whispered ?? this.openLinesFor(room, agentId, now)[0] ?? [...room.humanLines].reverse().find((l) => !l.whisper))?.answeredBy.add(agentId);
    }
    return ALLOWED;
  }

  setScenarioEnergy(energy: number): void {
    this.config.scenarioEnergy = Math.min(1, Math.max(0, energy));
  }

  /** Quiet period before ambient talk, shortened by a lively scenario and lengthened by a calm one. */
  private effectiveQuietMs(): number {
    const scale = Math.min(1.5, Math.max(0.5, 1.5 - this.config.scenarioEnergy));
    return this.config.ambientQuietMs * scale;
  }

  private check(room: RoomState, agentId: string, kind: ArbiterLineKind, now: number, preview = false): ArbiterRule | null {
    if (kind === "addressed") return null;
    if (room.typingUntil > now) return "human_typing";
    const line = room.humanLines.at(-1);
    if (kind === "interjection" && line) {
      // Every still-open addressee across the room's recent lines, not just the newest line's.
      const unanswered = new Set<string>();
      for (const l of room.humanLines) {
        if (now - l.at >= OPEN_LINE_MS) continue;
        for (const id of l.addressed) if (!l.answeredBy.has(id)) unanswered.add(id);
      }
      const isAddressee = line.addressed.has(agentId) || unanswered.has(agentId);
      if (unanswered.size > 0 && !isAddressee) return "not_addressed_open_line";
      // Timing rule 2: once the line has been answered (by its addressees, or by
      // one actor when it was addressed to nobody) everyone else may react with
      // a gesture or an expression but not speak, until the room has gone a
      // quiet period without human speech (then the ambient rule takes over).
      const answered = line.addressed.size === 0 ? line.answeredBy.size >= 1 : unanswered.size === 0;
      if (room.actorLinesSinceHuman >= Math.max(this.config.minLineBudget, line.addressed.size)) return "line_budget";
      if (answered && !isAddressee) return "one_answer_per_line";
      // One reply per addressed actor per line, however many pulses (a focus lane racing a base pulse) try:
      // the actor's latest addressing line is already answered by it, so a second reply is a duplicate.
      const mine = [...room.humanLines].reverse().find((l) => l.addressed.has(agentId));
      if (!preview && mine?.answeredBy.has(agentId)) return "one_answer_per_line";
    }
    if (kind === "ambient" && room.lastHumanSpeechAt !== null && now - room.lastHumanSpeechAt < this.effectiveQuietMs()) {
      return "ambient_too_soon";
    }
    return null;
  }

  /** Lines addressed to this agent it has not answered, oldest first. A whisper is open only to the decision that answers it. */
  private openLinesFor(room: RoomState, agentId: string, now: number, answering?: string): HumanLineState[] {
    return room.humanLines.filter(
      (l) => now - l.at < OPEN_LINE_MS && l.addressed.has(agentId) && !l.answeredBy.has(agentId) && (!l.whisper || l.eventId === answering),
    );
  }

  private room(roomId: string): RoomState {
    let state = this.rooms.get(roomId);
    if (!state) {
      state = { humanLines: [], lastHumanSpeechAt: null, typingUntil: 0, lastActorLineAt: null, actorLinesSinceHuman: 0 };
      this.rooms.set(roomId, state);
    }
    return state;
  }
}
