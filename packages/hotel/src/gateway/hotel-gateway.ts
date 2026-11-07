import type { BodyCommand, ChannelType, EndReason, EndingOffer, OperatorEvent, RoomId, SpectatorEvent, SpeechMode } from "@perfectman/shared";
import { isEngineAuthoredMotive } from "@perfectman/shared";
import type { DeliveryMessage, IBodyGateway, IDeliveryGateway } from "@perfectman/server/hotel";
import type { Clock, TimerHandle } from "../clock/clock.js";
import type { PlannedCommand } from "../embodiment/types.js";
import { stripBotOutput } from "../util/text.js";

export type GatewayTiming = {
  /** 55 ms per character of the line (embodiment.md 8.1). */
  perCharMs: number;
  /** Cap on persona delay plus typing time: keeps slow personas inside the 10 s p95. */
  capMs: number;
  /** Typing stays on at least this long when a consult ends in a no_op or fallback. */
  minTypingMs: number;
  /** >= 2.5 s between actor lines in a room (timing rule 3). */
  roomSpacingMs: number;
  roomQueueCap: number;
};

export const DEFAULT_TIMING: GatewayTiming = {
  perCharMs: 55,
  capMs: 4000,
  minTypingMs: 800,
  roomSpacingMs: 2500,
  roomQueueCap: 6,
};

export type CastEntry = { name: string; responseDelayMs: readonly [number, number] };

export type GatewayExecutor = {
  send(commands: PlannedCommand[]): void;
  sendThought(agentId: string, text: string): void;
};

export type GatewayDeps = {
  clock: Clock;
  rng: () => number;
  executor: GatewayExecutor;
  cast: ReadonlyMap<string, CastEntry>;
  /** Public room channel to hotel room; undefined for anything else. */
  roomOfChannel(channelId: string): RoomId | undefined;
  /** The room an actor is in right now. */
  roomOfAgent(agentId: string): RoomId | undefined;
  /** Both within 2 tiles in one room (huddle co-presence, embodiment.md 6.4). */
  togetherForHuddle?(a: string, b: string): boolean;
  /** The planner's shout choice (arousal and content); default: keep the committed mode. */
  chooseMode?(agentId: string, content: string, committed: SpeechMode): SpeechMode;
  timing?: Partial<GatewayTiming>;
  /** Admin notices (`ui_push` notice). */
  notice?(code: string, kind: "info" | "warn" | "error"): void;
  /** Every operator event, for the breaker, the meter and logs. */
  onOperatorEvent?(event: OperatorEvent): void;
  onStopped?(simulationId: string, reason?: EndReason, offer?: EndingOffer): void;
  /** A body command was blocked at delivery (`not_in_earshot`). */
  onBlocked?(agentId: string, code: "not_in_earshot"): void;
};

type Item = {
  seq: number;
  agentId: string;
  text: string;
  mode: SpeechMode;
  to?: string;
  /** 1 = addressed reply, jumps ambient lines; 0 = ambient. */
  priority: 0 | 1;
  landAt: number;
  room: RoomId;
};

type RoomQueue = { items: Item[]; lastLineAt: number; timer: TimerHandle | null };

const SPEECH_INTENTS = new Set(["send_message", "reply_to_message"]);
const REACTION_GESTURES: Record<string, { a: string; style?: number }> = {
  "👍": { a: "thumbs" },
  "😂": { a: "laugh" },
  "🤣": { a: "laugh" },
  "👋": { a: "wave" },
  "❤️": { a: "sign", style: 11 },
  "😘": { a: "kiss" },
};

/**
 * `IDeliveryGateway` + `IBodyGateway` for a hotel run (hotel-package.md 7).
 *
 * Rule: nothing here awaits the hotel. `DeliveryProjection` awaits every
 * gateway call inline inside the pulse, and hotel runs do not go through the
 * HTTP controller's 2 s timebox. Every method enqueues and returns.
 */
export class HotelGateway implements IDeliveryGateway, IBodyGateway {
  private readonly timing: GatewayTiming;
  private readonly consultAt = new Map<string, number>();
  private readonly typing = new Set<string>();
  private readonly huddles = new Map<string, Set<string>>();
  private readonly queues = new Map<RoomId, RoomQueue>();
  private pulseStartedAt: number | undefined;
  private seq = 0;
  private closed = false;
  stats = { delivered: 0, undeliveredCommitted: 0, reactions: 0 };

  constructor(private readonly deps: GatewayDeps) {
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
  }

  get undeliveredCommitted(): number {
    return this.stats.undeliveredCommitted;
  }

  // ---- consult and typing -----------------------------------------------------

  /** Fallback consult time for runtimes that do not call `onConsult` (typing starts with the pulse). */
  notePulseStart(at: number): void {
    this.pulseStartedAt = at;
  }

  /** `onConsult`: a generate task took its slot. Typing starts here, so it overlaps model latency. */
  noteConsult(agentId: string, at: number): void {
    if (this.closed) return;
    this.consultAt.set(agentId, at);
    this.setTyping(agentId, true);
  }

  private setTyping(agentId: string, on: boolean): void {
    if (on === this.typing.has(agentId)) return;
    if (on) this.typing.add(agentId);
    else this.typing.delete(agentId);
    this.deps.executor.send([{ agentId, cmd: "typing", on }]);
  }

  private endTypingSoon(agentId: string): void {
    if (!this.typing.has(agentId)) return;
    const now = this.deps.clock.now();
    const at = (this.consultAt.get(agentId) ?? now) + this.timing.minTypingMs;
    if (at <= now) return this.setTyping(agentId, false);
    this.deps.clock.setTimer(() => this.setTyping(agentId, false), at - now);
  }

  // ---- IDeliveryGateway -------------------------------------------------------

  async sendAgentMessage(channelId: string, message: DeliveryMessage): Promise<void> {
    if (this.closed) return;
    const { clock, rng } = this.deps;
    const now = clock.now();

    if (message.kind === "reaction") {
      const g = REACTION_GESTURES[message.emoji];
      this.deps.executor.send(
        g
          ? [{ agentId: message.agentId, cmd: "gesture", a: g.a, ...(g.style !== undefined ? { style: g.style } : {}) }]
          : [{ agentId: message.agentId, cmd: "expression", face: "smile" }],
      );
      this.stats.reactions++;
      return;
    }

    const text = stripBotOutput(message.content);
    if (text.length === 0) return this.endTypingSoon(message.agentId);

    const huddle = this.huddles.get(channelId);
    const roomId = this.deps.roomOfChannel(channelId) ?? (huddle ? this.deps.roomOfAgent(message.agentId) : undefined);
    if (roomId === undefined) {
      this.stats.undeliveredCommitted++;
      return;
    }

    let mode: SpeechMode = message.mode ?? "say";
    let to: string | undefined = message.whisperTo;
    if (huddle) {
      // A private channel is a huddle: delivered as whispers, one per other member (embodiment.md 6.4).
      const others = [...huddle].filter((m) => m !== message.agentId);
      const reachable = others.filter((m) => this.deps.togetherForHuddle?.(message.agentId, m) ?? true);
      if (reachable.length === 0) {
        this.deps.onBlocked?.(message.agentId, "not_in_earshot");
        this.stats.undeliveredCommitted++;
        return this.endTypingSoon(message.agentId);
      }
      mode = "whisper";
      for (const r of reachable) this.enqueue(roomId, message, text, mode, r, now, rng);
      return;
    }
    if (mode === "say") mode = this.deps.chooseMode?.(message.agentId, text, mode) ?? mode;
    if (mode === "whisper" && !to) mode = "say";
    this.enqueue(roomId, message, text, mode, to, now, rng);
  }

  private enqueue(roomId: RoomId, message: DeliveryMessage, text: string, mode: SpeechMode, to: string | undefined, now: number, rng: () => number): void {
    const cast = this.deps.cast.get(message.agentId);
    const [lo, hi] = cast?.responseDelayMs ?? [600, 2500];
    const sampled = lo + rng() * Math.max(0, hi - lo);
    const base = this.consultAt.get(message.agentId) ?? this.pulseStartedAt ?? now;
    const landAt = Math.max(now, base + Math.min(this.timing.capMs, sampled + this.timing.perCharMs * text.length));
    const priority: 0 | 1 = message.kind === "reply" || message.salience === "high" || message.salience === "critical" ? 1 : 0;
    const q = this.queue(roomId);
    q.items.push({ seq: ++this.seq, agentId: message.agentId, text, mode, ...(to ? { to } : {}), priority, landAt, room: roomId });
    // Overflow: the oldest ambient line first, then (as a last resort) the oldest of anything.
    while (q.items.length > this.timing.roomQueueCap) {
      const ambient = q.items.filter((i) => i.priority === 0).sort((a, b) => a.seq - b.seq)[0];
      const victim = ambient ?? [...q.items].sort((a, b) => a.seq - b.seq)[0];
      if (!victim) break;
      q.items = q.items.filter((i) => i !== victim);
      this.stats.undeliveredCommitted++;
      this.setTyping(victim.agentId, false);
    }
    this.pump(roomId);
  }

  private queue(roomId: RoomId): RoomQueue {
    let q = this.queues.get(roomId);
    if (!q) {
      q = { items: [], lastLineAt: Number.NEGATIVE_INFINITY, timer: null };
      this.queues.set(roomId, q);
    }
    return q;
  }

  /** Releases at most one line per spacing window, addressed replies first, FIFO per actor. */
  private pump(roomId: RoomId): void {
    const q = this.queues.get(roomId);
    if (!q || this.closed) return;
    q.timer?.cancel();
    q.timer = null;
    if (q.items.length === 0) return;
    const now = this.deps.clock.now();

    const heads = q.items.filter((i) => !q.items.some((o) => o.agentId === i.agentId && o.seq < i.seq));
    const ready = heads.filter((i) => i.landAt <= now);
    const spacingEnds = q.lastLineAt + this.timing.roomSpacingMs;
    if (ready.length > 0 && now >= spacingEnds) {
      const next = ready.sort((a, b) => b.priority - a.priority || a.landAt - b.landAt || a.seq - b.seq)[0];
      if (next) this.release(q, next, now);
      if (q.items.length > 0) this.armTimer(roomId, q);
      return;
    }
    this.armTimer(roomId, q);
  }

  private armTimer(roomId: RoomId, q: RoomQueue): void {
    const now = this.deps.clock.now();
    const heads = q.items.filter((i) => !q.items.some((o) => o.agentId === i.agentId && o.seq < i.seq));
    const earliestLand = Math.min(...heads.map((i) => i.landAt));
    const at = Math.max(earliestLand, q.lastLineAt + this.timing.roomSpacingMs);
    q.timer = this.deps.clock.setTimer(() => this.pump(roomId), Math.max(1, at - now));
  }

  private release(q: RoomQueue, item: Item, now: number): void {
    q.items = q.items.filter((i) => i !== item);
    q.lastLineAt = now;
    this.typing.delete(item.agentId);
    const cmds: BodyCommand[] = [
      { agentId: item.agentId, cmd: "typing", on: false },
      { agentId: item.agentId, cmd: "chat", mode: item.mode, text: item.text, ...(item.to ? { to: item.to } : {}) },
    ];
    this.deps.executor.send(cmds);
    this.stats.delivered++;
  }

  async createChannel(channelId: string, type: ChannelType, memberAgentIds: string[]): Promise<void> {
    if (type !== "public_channel") this.huddles.set(channelId, new Set(memberAgentIds));
  }

  async addMember(channelId: string, agentId: string): Promise<void> {
    this.huddles.get(channelId)?.add(agentId);
  }

  async removeMember(channelId: string, agentId: string): Promise<void> {
    this.huddles.get(channelId)?.delete(agentId);
  }

  async sendSpectatorEvent(_event: SpectatorEvent): Promise<void> {
    // Default mode ignores it; cinematic appends it to the director input (Phase 4).
  }

  async sendOperatorEvent(event: OperatorEvent): Promise<void> {
    this.deps.onOperatorEvent?.(event);
    const type: string = event.type;
    if (type === "llm_circuit_open") this.deps.notice?.("llm_circuit_open", "warn");
    else if (type === "llm_circuit_closed") this.deps.notice?.("llm_circuit_closed", "info");
    else if (type === "llm_budget_warning") this.deps.notice?.("llm_budget_warning", "warn");
    if (type !== "action_intent" || !event.agentId) return;

    const intentType = event.data?.["intentType"];
    const motive = event.data?.["privateMotiveSummary"];
    // Thoughts go to the hotel's chat_log (D42), unless the engine wrote them.
    if (typeof motive === "string" && motive.length > 0 && !isEngineAuthoredMotive(motive)) {
      this.deps.executor.sendThought(event.agentId, motive);
    }
    // A consult that ends silently (no_op, fallback) still shows typing for a beat, then stops.
    if (typeof intentType === "string" && !SPEECH_INTENTS.has(intentType)) this.endTypingSoon(event.agentId);
  }

  async onSimulationStopped(simulationId: string, endReason?: EndReason, endingOffer?: EndingOffer): Promise<void> {
    this.deps.onStopped?.(simulationId, endReason, endingOffer);
  }

  // ---- IBodyGateway -----------------------------------------------------------

  async dispatch(commands: BodyCommand[]): Promise<void> {
    if (!this.closed) this.deps.executor.send(commands);
  }

  /** Drops everything queued; lines already released are with the hotel. */
  dispose(): void {
    this.closed = true;
    for (const q of this.queues.values()) q.timer?.cancel();
    this.queues.clear();
    for (const agentId of [...this.typing]) this.deps.executor.send([{ agentId, cmd: "typing", on: false }]);
    this.typing.clear();
  }
}
