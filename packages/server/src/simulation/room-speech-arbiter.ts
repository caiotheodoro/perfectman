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
};

type RoomState = {
  humanLine?: HumanLineState;
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

  noteHumanLine(roomId: string, line: { eventId: string; at: number; addressedIds: string[] }): void {
    const room = this.room(roomId);
    room.humanLine = {
      eventId: line.eventId,
      at: line.at,
      addressed: new Set(line.addressedIds),
      answeredBy: new Set(),
    };
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
  classify(agentId: string, roomId: string, now: number): ArbiterLineKind {
    const room = this.rooms.get(roomId);
    const line = room?.humanLine;
    if (line?.addressed.has(agentId) && !line.answeredBy.has(agentId)) return "addressed";
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
    const asInterjection = this.check(room, agentId, "interjection", now);
    const asAmbient = this.check(room, agentId, "ambient", now);
    return asInterjection && asAmbient ? blocked(asInterjection) : ALLOWED;
  }

  /** Resolver phase, authoritative. Records the line when allowed. */
  gate(agentId: string, roomId: string, kind: ArbiterLineKind, now: number): ArbiterDecision {
    const room = this.room(roomId);
    const rule = this.check(room, agentId, kind, now);
    if (rule) return blocked(rule);
    room.lastActorLineAt = now;
    room.actorLinesSinceHuman += 1;
    if (kind !== "ambient") room.humanLine?.answeredBy.add(agentId);
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

  private check(room: RoomState, agentId: string, kind: ArbiterLineKind, now: number): ArbiterRule | null {
    if (kind === "addressed") return null;
    if (room.typingUntil > now) return "human_typing";
    const line = room.humanLine;
    if (kind === "interjection" && line) {
      const unanswered = [...line.addressed].filter((id) => !line.answeredBy.has(id));
      const isAddressee = line.addressed.has(agentId);
      if (unanswered.length > 0 && !isAddressee) return "not_addressed_open_line";
      // Timing rule 2: once the line has been answered (by its addressees, or by
      // one actor when it was addressed to nobody) everyone else may react with
      // a gesture or an expression but not speak, until the room has gone a
      // quiet period without human speech (then the ambient rule takes over).
      const answered = line.addressed.size === 0 ? line.answeredBy.size >= 1 : unanswered.length === 0;
      if (answered && !isAddressee) return "one_answer_per_line";
      if (room.actorLinesSinceHuman >= Math.max(this.config.minLineBudget, line.addressed.size)) return "line_budget";
    }
    if (kind === "ambient" && room.lastHumanSpeechAt !== null && now - room.lastHumanSpeechAt < this.effectiveQuietMs()) {
      return "ambient_too_soon";
    }
    return null;
  }

  private room(roomId: string): RoomState {
    let state = this.rooms.get(roomId);
    if (!state) {
      state = { lastHumanSpeechAt: null, typingUntil: 0, lastActorLineAt: null, actorLinesSinceHuman: 0 };
      this.rooms.set(roomId, state);
    }
    return state;
  }
}
