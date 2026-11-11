import type { BodyCommand, ChannelType, EndReason, EndingOffer, OperatorEvent, RoomId, SpectatorEvent, SpeechMode } from "@perfectman/shared";
import { isEngineAuthoredMotive } from "@perfectman/shared";
import type { DeliveryMessage, IBodyGateway, IDeliveryGateway } from "@perfectman/server/hotel";
import type { Clock, TimerHandle } from "../clock/clock.js";
import type { GatewayHuman } from "../embodiment/human/human-body.js";
import type { PlannedCommand } from "../embodiment/types.js";
import { stripBotOutput } from "../util/text.js";

export type GatewayTiming = {
  /** 55 ms per character of the line (embodiment.md 8.1). */
  perCharMs: number;
  /** Cap on persona delay plus typing time: keeps slow personas inside the 10 s p95. */
  capMs: number;
  /** The same cap for an addressed reply: somebody is waiting, and the typing bubble already showed the model working. */
  addressedCapMs: number;
  /** Typing stays on at least this long when a consult ends in a no_op or fallback. */
  minTypingMs: number;
  /** >= 2.5 s between actor lines in a room (timing rule 3). */
  roomSpacingMs: number;
  roomQueueCap: number;
};

export const DEFAULT_TIMING: GatewayTiming = {
  perCharMs: 55,
  capMs: 4000,
  addressedCapMs: 1500,
  minTypingMs: 800,
  roomSpacingMs: 2500,
  roomQueueCap: 6,
};

export type CastEntry = { name: string; responseDelayMs: readonly [number, number] };

export type GatewayExecutor = {
  send(commands: PlannedCommand[]): void;
  /** Sends a spoken line; false when it never reached the hotel (backstop, stale room, dead link). Falls back to `send`, counted as sent. */
  sendChat?(cmd: Extract<BodyCommand, { cmd: "chat" }>): boolean;
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
  /**
   * The planner's shout choice (arousal and content); default: keep the committed mode. Only used for a
   * message that carries no mode of its own: in a hotel run the resolver decides the mode when it stamps
   * who hears the line, so the delivered mode and the stamped hearing cannot disagree.
   */
  chooseMode?(agentId: string, content: string, committed: SpeechMode): SpeechMode;
  timing?: Partial<GatewayTiming>;
  /** Every operator event, for logs and tests. */
  onOperatorEvent?(event: OperatorEvent): void;
  onStopped?(simulationId: string, reason?: EndReason, offer?: EndingOffer): void;
  /** A body command was blocked at delivery (`not_in_earshot`). */
  onBlocked?(agentId: string, code: "not_in_earshot"): void;
  /** A line left the room queue for the wire: the frame log notes who it was aimed at and how far away they stood. `text` is what the room saw (a line cut by an interruption ends in a dash). */
  onLine?(line: { agentId: string; mode: SpeechMode; eventId?: string; room: RoomId; text?: string; cut?: boolean }): void;
  /**
   * The human layer's turn-taking (cinematic revamp B5): a reaction latency before the typing bubble comes up, typing time in proportion to the line with jitter and a
   * hesitation, a line talked over, a walk up to a far addressee before a first line. Absent or at h = 0 the gateway is what it was.
   */
  human?: GatewayHuman;
};

type Item = {
  seq: number;
  /** Whispered inside a huddle: the line only lands while the pair stays together. */
  huddle: boolean;
  agentId: string;
  text: string;
  mode: SpeechMode;
  to?: string;
  /** 1 = addressed reply, jumps ambient lines; 0 = ambient. */
  priority: 0 | 1;
  landAt: number;
  room: RoomId;
  eventId?: string;
  /** The line was queued under the human layer's timing (the typing bubble is its own to start and stop). */
  humanTyped?: boolean;
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
  /** The human layer's reaction latency of the consult in flight, and the timers that bring the bubble up (and drop it for a hesitation). */
  private readonly think = new Map<string, number>();
  private readonly typingTimers = new Map<string, TimerHandle[]>();
  private readonly huddles = new Map<string, Set<string>>();
  private readonly queues = new Map<RoomId, RoomQueue>();
  private pulseStartedAt: number | undefined;
  private seq = 0;
  private closed = false;
  private paused = false;
  stats = { delivered: 0, undeliveredCommitted: 0, reactions: 0 };

  constructor(private readonly deps: GatewayDeps) {
    this.timing = { ...DEFAULT_TIMING, ...deps.timing };
  }

  get undeliveredCommitted(): number {
    return this.stats.undeliveredCommitted;
  }

  // ---- consult and typing -----------------------------------------------------

  /** A paused run releases no queued line; the backlog waits, and goes out one per spacing window on resume. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    if (paused) {
      for (const q of this.queues.values()) {
        q.timer?.cancel();
        q.timer = null;
      }
      return;
    }
    for (const roomId of [...this.queues.keys()]) this.pump(roomId);
  }

  /** Fallback consult time for runtimes that do not call `onConsult` (typing starts with the pulse). */
  notePulseStart(at: number): void {
    this.pulseStartedAt = at;
  }

  /**
   * `onConsult`: a generate task took its slot. Typing starts here, so it overlaps model latency. Under the human layer a cast-to-cast turn first spends a
   * reaction latency (by feeling) before the bubble comes up; an addressed consult (a person is waiting) shows it at once, as it always did.
   */
  noteConsult(agentId: string, at: number, addressed = false): void {
    if (this.closed) return;
    this.consultAt.set(agentId, at);
    this.clearTypingTimers(agentId);
    this.think.delete(agentId);
    const h = this.deps.human;
    if (h && h.likeness > 0 && !addressed) {
      const cast = this.deps.cast.get(agentId);
      const [lo, hi] = cast?.responseDelayMs ?? [600, 2500];
      const think = h.think(agentId, lo + this.deps.rng() * Math.max(0, hi - lo));
      if (think !== undefined) {
        this.think.set(agentId, think);
        this.timerFor(agentId, think, () => this.bubble(agentId, true));
        return;
      }
    }
    this.setTyping(agentId, true);
  }

  private timerFor(agentId: string, ms: number, fn: () => void): void {
    const handle = this.deps.clock.setTimer(() => {
      const list = this.typingTimers.get(agentId);
      if (list) this.typingTimers.set(agentId, list.filter((t) => t !== handle));
      fn();
    }, Math.max(0, ms));
    this.typingTimers.set(agentId, [...(this.typingTimers.get(agentId) ?? []), handle]);
  }

  private clearTypingTimers(agentId: string): void {
    for (const t of this.typingTimers.get(agentId) ?? []) t.cancel();
    this.typingTimers.delete(agentId);
  }

  /** Typing off now: the line was held back (a deferral) or dropped. */
  stopTyping(agentId: string): void {
    this.setTyping(agentId, false);
  }

  /** Typing on or off. Off also cancels the bubble's pending timers (a think time still running, a hesitation's return): the line it was for is gone. */
  private setTyping(agentId: string, on: boolean): void {
    if (!on) this.clearTypingTimers(agentId);
    this.bubble(agentId, on);
  }

  private bubble(agentId: string, on: boolean): void {
    if (on === this.typing.has(agentId)) return;
    if (on) this.typing.add(agentId);
    else this.typing.delete(agentId);
    this.deps.executor.send([{ agentId, cmd: "typing", on }]);
  }

  private endTypingSoon(agentId: string): void {
    if (!this.typing.has(agentId)) {
      this.clearTypingTimers(agentId);
      return;
    }
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
      for (const r of reachable) this.enqueue(roomId, message, text, mode, r, now, rng, true);
      return;
    }
    if (mode === "say" && message.mode === undefined) mode = this.deps.chooseMode?.(message.agentId, text, mode) ?? mode;
    if (mode === "whisper" && !to) mode = "say";
    this.enqueue(roomId, message, text, mode, to, now, rng);
  }

  private enqueue(roomId: RoomId, message: DeliveryMessage, text: string, mode: SpeechMode, to: string | undefined, now: number, rng: () => number, huddle = false): void {
    const cast = this.deps.cast.get(message.agentId);
    const [lo, hi] = cast?.responseDelayMs ?? [600, 2500];
    const sampled = lo + rng() * Math.max(0, hi - lo);
    const base = this.consultAt.get(message.agentId) ?? this.pulseStartedAt ?? now;
    // A whisper back to the person who whispered is an answer: somebody is waiting, so it jumps ambient talk.
    const answer = mode === "whisper" && message.whisperTo !== undefined && message.whisperTo === to;
    const priority: 0 | 1 = answer || message.kind === "reply" || message.salience === "high" || message.salience === "critical" ? 1 : 0;
    let landAt = Math.max(now, base + Math.min(priority === 1 ? Math.min(this.timing.addressedCapMs, this.timing.capMs) : this.timing.capMs, sampled + this.timing.perCharMs * text.length));
    // The human layer's timing: only for a cast-to-cast line that was queued under its think time (an addressed reply keeps the old pace).
    const human = this.deps.human;
    const think = this.think.get(message.agentId);
    this.think.delete(message.agentId);
    let humanTyped = false;
    if (human && human.likeness > 0 && priority === 0 && think !== undefined && !huddle) {
      const plan = human.typing(message.agentId, text, think, to);
      if (plan) {
        humanTyped = true;
        landAt = Math.max(now, base + plan.totalMs);
        const start = base + plan.thinkMs;
        this.clearTypingTimers(message.agentId);
        if (start > now) this.timerFor(message.agentId, start - now, () => this.bubble(message.agentId, true));
        else this.bubble(message.agentId, true);
        if (plan.hesitate) {
          const off = start + plan.hesitate.afterMs;
          if (off > now) {
            this.timerFor(message.agentId, off - now, () => this.bubble(message.agentId, false));
            this.timerFor(message.agentId, off + plan.hesitate.forMs - now, () => this.bubble(message.agentId, true));
          }
        }
      }
    }
    // Walk up before a first line to someone across the room.
    if (human && human.likeness > 0 && !huddle && mode === "say") {
      const ap = human.approach(message.agentId, to);
      if (ap) {
        this.deps.executor.send(ap.cmds);
        landAt = Math.max(landAt, now + Math.min(ap.delayMs, 4500));
      }
    }
    const q = this.queue(roomId);
    q.items.push({ seq: ++this.seq, huddle, agentId: message.agentId, text, mode, ...(to ? { to } : {}), priority, landAt, room: roomId, ...(humanTyped ? { humanTyped } : {}), ...(message.eventId ? { eventId: message.eventId } : {}) });
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
    if (this.paused) return;
    this.dropMisplaced(q);
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

  /**
   * The actor's room is resolved when the line is released, not when it was queued: an actor that took
   * a door while the line waited no longer says it to the room it was meant for, and a whisper only
   * lands while the pair is still together. Such a line is dropped, not delivered into the wrong room.
   */
  private dropMisplaced(q: RoomQueue): void {
    const keep: Item[] = [];
    for (const item of q.items) {
      const here = this.deps.roomOfAgent(item.agentId);
      const together = !item.huddle || !item.to || (this.deps.togetherForHuddle?.(item.agentId, item.to) ?? true);
      if (here === item.room && together) {
        keep.push(item);
        continue;
      }
      this.stats.undeliveredCommitted++;
      this.setTyping(item.agentId, false);
    }
    q.items = keep;
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
    this.clearTypingTimers(item.agentId);
    this.typing.delete(item.agentId);
    this.deps.executor.send([{ agentId: item.agentId, cmd: "typing", on: false }]);
    // A heated line another heated actor already has an answer ready for is talked over: it trails off in a dash and the answer lands on top of it.
    let shown = item.text;
    let cutShort = false;
    const human = this.deps.human;
    if (human && human.likeness > 0 && item.mode === "say" && !item.huddle) {
      const other = q.items.filter((i) => i.agentId !== item.agentId && i.mode === "say" && !i.huddle && i.landAt <= now + 2000).sort((a, b) => a.landAt - b.landAt || a.seq - b.seq)[0];
      const cut = other ? human.interrupt({ agentId: item.agentId, text: item.text, ...(item.to ? { to: item.to } : {}) }, { agentId: other.agentId, ...(other.to ? { to: other.to } : {}) }, now) : undefined;
      if (other && cut) {
        shown = cut.text;
        cutShort = true;
        // The spacing rule would hold the interrupter for the rest of the window: it lands after the overlap gap instead.
        other.landAt = Math.min(other.landAt, now + cut.gapMs);
        q.lastLineAt = now - this.timing.roomSpacingMs + cut.gapMs;
      }
    }
    const chat = { agentId: item.agentId, cmd: "chat" as const, mode: item.mode, text: shown, ...(item.to ? { to: item.to } : {}) };
    let sent = true;
    if (this.deps.executor.sendChat) sent = this.deps.executor.sendChat(chat);
    else this.deps.executor.send([chat]);
    // A line the hotel never received is not a delivered line.
    if (sent) {
      this.stats.delivered++;
      this.deps.onLine?.({ agentId: item.agentId, mode: item.mode, room: item.room, text: shown, ...(cutShort ? { cut: true } : {}), ...(item.eventId ? { eventId: item.eventId } : {}) });
    }
    else this.stats.undeliveredCommitted++;
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
    if (event.type !== "action_intent" || !event.agentId) return;

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
    for (const id of [...this.typingTimers.keys()]) this.clearTypingTimers(id);
    for (const q of this.queues.values()) q.timer?.cancel();
    this.queues.clear();
    for (const agentId of [...this.typing]) this.deps.executor.send([{ agentId, cmd: "typing", on: false }]);
    this.typing.clear();
  }
}
