import type { BlockedReason, BodyCommand, BodyPlan, PairKind, PairedActAbortedPayload, RoomId, Tile } from "@perfectman/shared";
import type { Clock, TimerHandle } from "../clock/clock.js";
import type { ActorCmd, ActorErrorCode, HotelFrame, PairOutcome, SidecarMsg } from "../director/index.js";
import type { HotelSpaceMirror } from "../space/space-mirror.js";
import { chebyshev } from "../space/geometry.js";
import type { Logger } from "../util/log.js";
import { silentLogger } from "../util/log.js";
import { CMD_BUDGET, HOTEL_BACKSTOP, WALK_TICK_MS } from "./constants.js";
import { pickTile } from "./tiles.js";
import type { PlannedCommand } from "./types.js";

const CHAT_BACKSTOP = { count: 4, windowMs: 6000 } as const;
const PAIR_FACE_MS = 400;
const PAIR_HOLD_MS = 2000;
const PAIR_APPROACH_TIMEOUT_MS = 15_000;
const PAIR_REACTION_TIMEOUT_MS = 8000;
const ETA_MISMATCH = 0.3;

export type PairInfo = { pair: string; kind: PairKind; agentId: string; withRef: string; withHuman: boolean };

export type ExecutorHooks = {
  /** A command was refused or dropped; the next prompt says why (`body_blocked`). */
  blocked(agentId: string, reasons: BlockedReason[]): void;
  /** A walk ended: `body_arrived`, pending speech release, salient wake. */
  arrived(agentId: string, plan: BodyPlan, tile: Tile, room: RoomId): void;
  /** A plan was replaced before it arrived (plan thrash probe). */
  abandoned?(agentId: string, plan: BodyPlan): void;
  /** An actor went through a door: its room channel membership follows (embodiment.md 6.4). */
  movedRoom?(agentId: string, from: RoomId, to: RoomId): void;
  pairAborted(info: PairInfo & { cause: PairedActAbortedPayload["cause"] }): void;
  pairOutcome(info: PairInfo & { outcome: PairOutcome }): void;
};

export type ExecutorDeps = {
  run: number;
  clock: Clock;
  rng: () => number;
  mirror: HotelSpaceMirror;
  lease(): number | undefined;
  nextCid(): number;
  send(msg: SidecarMsg): boolean;
  hooks: ExecutorHooks;
  logger?: Logger;
  /** Mirror of every command in and out, for the body probes. */
  record?(dir: "in" | "out", room: RoomId | undefined, kind: string, data: Record<string, unknown>): void;
};

type PairState = PairInfo & {
  phase: "approach" | "face" | "act" | "hold";
  timer: TimerHandle | null;
  approachPlan?: string;
  bRef: string;
};

const BLOCK_MAP: Partial<Record<ActorErrorCode, BlockedReason["code"]>> = {
  no_route: "no_route",
  slow_down: "slow_down",
  rate_limited: "slow_down",
  not_a_seat: "not_a_seat",
  not_subscribed: "room_unreachable",
  no_such_room: "room_unreachable",
  target_gone: "target_elsewhere",
  unknown_actor: "unknown_ref",
  action_not_here: "busy_moving",
  not_adjacent: "too_far",
};

/**
 * Stateful half of the body (hotel-package.md 11): turns planned commands into
 * `actor_cmd` frames behind the per-actor budget, tracks in-flight plans and
 * their ETAs, releases commands held for an arrival, and runs the pair
 * choreography. The decision of *what* to do stays in the pure planner.
 */
export class BodyExecutor {
  private readonly plans = new Map<string, { plan: BodyPlan; goal: Tile; held: PlannedCommand[] }>();
  private readonly pairs = new Map<string, PairState>();
  private readonly pendingCids = new Map<number, { agentId: string; cmd: string }>();
  private readonly chatTimes = new Map<string, number[]>();
  private readonly log: Logger;
  stats = { sent: 0, droppedBudget: 0, droppedStale: 0, errors: 0, etaMismatches: 0 };

  constructor(private readonly deps: ExecutorDeps) {
    this.log = deps.logger ?? silentLogger;
  }

  planOf(agentId: string): BodyPlan | undefined {
    return this.plans.get(agentId)?.plan;
  }

  /** Sends commands for their actors, in order, after the staleness gate and the budgets. */
  send(commands: readonly PlannedCommand[]): void {
    const now = this.deps.clock.now();
    for (const c of commands) {
      if (c.cmd === "pair") {
        this.startPair(c);
        continue;
      }
      if (c.afterArrival) {
        const entry = [...this.plans.values()].find((p) => p.plan.id === c.afterArrival);
        if (entry) entry.held.push(c);
        continue;
      }
      this.sendOne(c, now);
    }
  }

  /**
   * `thought` and `caption` are wire chat modes with no `BodyCommand` form:
   * always logged to `chat_log` by the hotel, delivered to nobody in default
   * mode (D30, D42). Dropped first under the chat backstop.
   */
  sendThought(agentId: string, text: string): void {
    const { mirror } = this.deps;
    const id = mirror.avatarId(agentId);
    const lease = this.deps.lease();
    const clean = text.replace(/\s+/g, " ").trim().slice(0, 200);
    if (id === undefined || lease === undefined || clean.length === 0) return;
    const now = this.deps.clock.now();
    const times = (this.chatTimes.get(agentId) ?? []).filter((t) => now - t < CHAT_BACKSTOP.windowMs);
    if (times.length >= CHAT_BACKSTOP.count - 1) return; // keep the last slot for a spoken line
    this.deps.send({ t: "actor_cmd", cid: this.deps.nextCid(), run: this.deps.run, lease, actor: id, cmd: { k: "chat", mode: "thought", text: clean } });
  }

  clearActor(agentId: string): void {
    this.plans.delete(agentId);
    for (const [id, p] of this.pairs) if (p.agentId === agentId || p.bRef === agentId) this.endPair(id);
  }

  dispose(): void {
    for (const id of [...this.pairs.keys()]) this.endPair(id);
    this.plans.clear();
  }

  // ---- inbound ----------------------------------------------------------------

  handleFrame(frame: HotelFrame): void {
    const { mirror, clock } = this.deps;
    const now = clock.now();
    switch (frame.t) {
      case "walk_started": {
        const ref = mirror.refOfAvatar(frame.actor);
        const entry = this.plans.get(ref);
        this.deps.record?.("in", mirror.roomOfRef(ref), "walk_started", { actor: ref, eta_ms: frame.eta_ms, plan: frame.plan ?? null });
        if (entry && (frame.plan === entry.plan.id || !frame.plan)) {
          const ours = entry.plan.etaMs;
          if (ours > 0 && Math.abs(frame.eta_ms - ours) / ours > ETA_MISMATCH) {
            this.stats.etaMismatches++;
            this.log.info("eta mismatch (probe signal)", { actor: ref, ours, hotel: frame.eta_ms });
          }
          entry.plan.etaMs = frame.eta_ms;
        }
        break;
      }
      case "arrived": {
        const ref = mirror.applyArrived(frame.actor, frame.room, frame.x, frame.y, now);
        if (!ref) break;
        this.deps.record?.("in", String(frame.room), "arrived", { actor: ref, x: frame.x, y: frame.y, plan: frame.plan ?? null });
        const entry = this.plans.get(ref);
        const planId = frame.plan ?? entry?.plan.id;
        if (entry && entry.plan.id === planId) {
          const reached = entry.goal[0] === frame.x && entry.goal[1] === frame.y;
          entry.plan.status = reached ? "arrived" : "blocked";
          const held = entry.held.splice(0);
          this.deps.hooks.arrived(ref, entry.plan, [frame.x, frame.y], String(frame.room));
          if (reached) for (const h of held) this.sendOne(h, now);
          this.plans.delete(ref);
        }
        if (planId) this.onPairWalkEnded(ref, planId);
        break;
      }
      case "moved_room": {
        const ref = mirror.applyMovedRoom(frame.actor, frame.from, frame.to, frame.x, frame.y, now);
        if (ref) {
          this.deps.record?.("in", String(frame.to), "moved_room", { actor: ref, from: String(frame.from) });
          this.plans.delete(ref);
          this.deps.hooks.movedRoom?.(ref, String(frame.from), String(frame.to));
        }
        break;
      }
      case "actor_error": {
        this.stats.errors++;
        const pending = frame.cid !== undefined && frame.cid !== null ? this.pendingCids.get(frame.cid) : undefined;
        if (frame.cid !== undefined && frame.cid !== null) this.pendingCids.delete(frame.cid);
        const ref = pending?.agentId ?? (frame.actor !== undefined && frame.actor !== null ? mirror.refOfAvatar(frame.actor) : undefined);
        this.deps.record?.("in", ref ? mirror.roomOfRef(ref) : undefined, "actor_error", { code: frame.code, actor: ref ?? null, cmd: pending?.cmd ?? null });
        if (ref) {
          const code = BLOCK_MAP[frame.code];
          if (code) this.deps.hooks.blocked(ref, [{ code, ...(frame.detail ? { detail: String(frame.detail).slice(0, 80) } : {}) }]);
          // A refused walk is a plan that never started.
          if (pending?.cmd === "walk") this.plans.delete(ref);
        }
        break;
      }
      case "pair_reaction":
        this.onPairReaction(frame.pair, frame.outcome);
        break;
      case "actor_gone": {
        const ref = mirror.refOfAvatar(frame.actor);
        this.clearActor(ref);
        break;
      }
      default:
        break;
    }
  }

  /** Mirror listener: a pair in its face/act phase aborts when either party moves. */
  onMoved(ref: string): void {
    for (const [id, p] of this.pairs) {
      if ((p.agentId === ref || p.bRef === ref) && (p.phase === "face" || p.phase === "act")) {
        this.deps.hooks.pairAborted({ ...p, cause: "movement" });
        this.endPair(id);
      }
    }
  }

  onLeft(ref: string): void {
    for (const [id, p] of this.pairs) {
      if (p.bRef === ref) {
        this.deps.hooks.pairAborted({ ...p, cause: "target_lost" });
        this.endPair(id);
      }
    }
  }

  // ---- outbound ---------------------------------------------------------------

  private sendOne(c: BodyCommand, now: number): void {
    const { mirror } = this.deps;
    const id = mirror.avatarId(c.agentId);
    const lease = this.deps.lease();
    if (id === undefined || lease === undefined) {
      this.deps.hooks.blocked(c.agentId, [{ code: "unknown_ref" }]);
      return;
    }
    const roomId = mirror.roomOfRef(c.agentId);
    const room = roomId ? mirror.model().rooms.get(roomId) : undefined;
    const counted = c.cmd !== "typing" && c.cmd !== "chat";

    if (counted) {
      // Stale or degraded space: no body commands (embodiment.md 3.1).
      if (!room || room.degraded || now - room.syncedAtWall > 5000) {
        this.stats.droppedStale++;
        this.deps.hooks.blocked(c.agentId, [{ code: "stale_space" }]);
        return;
      }
      const body = mirror.bodyOf(c.agentId, now);
      body.budget.cmdTimes = body.budget.cmdTimes.filter((t) => now - t < CMD_BUDGET.windowMs);
      const isMove = c.cmd === "walk" || c.cmd === "sit" || c.cmd === "move_room" || c.cmd === "stand" || c.cmd === "lay";
      const limit = isMove ? HOTEL_BACKSTOP.count : CMD_BUDGET.count;
      if (body.budget.cmdTimes.length >= limit) {
        this.stats.droppedBudget++;
        this.deps.hooks.blocked(c.agentId, [{ code: "slow_down", part: partOf(c) }]);
        return;
      }
      body.budget.cmdTimes.push(now);
    } else if (c.cmd === "chat") {
      const times = (this.chatTimes.get(c.agentId) ?? []).filter((t) => now - t < CHAT_BACKSTOP.windowMs);
      if (times.length >= CHAT_BACKSTOP.count) return;
      times.push(now);
      this.chatTimes.set(c.agentId, times);
    }

    const wire = this.toWire(c);
    if (!wire) return;
    const cid = this.deps.nextCid();
    if (c.cmd === "walk") this.trackPlan(c, now);
    this.pendingCids.set(cid, { agentId: c.agentId, cmd: c.cmd });
    if (this.pendingCids.size > 512) this.pendingCids.delete(this.pendingCids.keys().next().value as number);
    this.stats.sent++;
    this.deps.record?.("out", roomId, "actor_cmd", { actor: c.agentId, cmd: wire as unknown as Record<string, unknown> });
    this.deps.send({ t: "actor_cmd", cid, run: this.deps.run, lease, actor: id, cmd: wire });
  }

  private toWire(c: BodyCommand): ActorCmd | undefined {
    const { mirror } = this.deps;
    const num = (ref: string | undefined): number | undefined => (ref === undefined ? undefined : mirror.avatarId(ref));
    switch (c.cmd) {
      case "walk":
        return { k: "walk", x: c.to[0], y: c.to[1], ...(c.plan ? { plan: c.plan } : {}) };
      case "face":
        return c.targetTile ? { k: "face", tile: [c.targetTile[0], c.targetTile[1]] } : { k: "face", ...(c.dir !== undefined ? { dir: c.dir } : {}) };
      case "sit":
        return { k: "sit", furni: c.furniId };
      case "stand":
        return { k: "action", action: "stand" };
      case "lay":
        return { k: "action", action: "lay" };
      case "gesture": {
        const action = c.a === "kiss" ? "blow" : c.a;
        const known = ["wave", "blow", "laugh", "thumbs", "sign", "dance", "stop", "idle"];
        return known.includes(action) ? { k: "action", action: action as "wave", ...(c.style !== undefined ? { style: c.style } : {}) } : undefined;
      }
      case "expression":
        return { k: "expression", face: c.face as "smile" };
      case "chat": {
        const to = num(c.to);
        return { k: "chat", mode: c.mode, text: c.text, ...(to !== undefined ? { to } : {}) };
      }
      case "move_room": {
        const room = Number(c.to);
        return Number.isInteger(room) ? { k: "move_room", room, via: "door" } : undefined;
      }
      case "typing":
        return { k: "typing", on: c.on };
      case "pair": {
        const w = num(c.with);
        return w === undefined ? undefined : { k: "pair", kind: c.kind, with: w, pair: c.pair };
      }
    }
  }

  private trackPlan(c: Extract<BodyCommand, { cmd: "walk" }>, now: number): void {
    const room = this.deps.mirror.roomOfRef(c.agentId);
    const self = room ? this.deps.mirror.model().rooms.get(room)?.occupants.get(c.agentId) : undefined;
    const prior = this.plans.get(c.agentId);
    if (prior && prior.plan.status === "moving") {
      prior.plan.status = "interrupted";
      this.deps.hooks.abandoned?.(c.agentId, prior.plan);
    }
    const steps = self ? chebyshev(self.tile, c.to) : 0;
    this.plans.set(c.agentId, {
      goal: c.to,
      held: [],
      plan: { id: c.plan ?? `${c.agentId}:${now}`, kind: "go_to", goal: `${c.to[0]},${c.to[1]}`, startedAt: now, etaMs: steps * WALK_TICK_MS, status: "moving" },
    });
  }

  // ---- pair choreography ------------------------------------------------------

  private startPair(c: Extract<BodyCommand, { cmd: "pair" }>): void {
    const { mirror } = this.deps;
    if ([...this.pairs.values()].some((p) => p.agentId === c.agentId || p.bRef === c.agentId)) return;
    const withHuman = !mirror.isOwn(mirror.avatarId(c.with) ?? NaN);
    const st: PairState = { pair: c.pair, kind: c.kind, agentId: c.agentId, withRef: c.with, bRef: c.with, withHuman, phase: "approach", timer: null };
    this.pairs.set(c.pair, st);
    this.advancePair(st);
  }

  private pairRoom(st: PairState) {
    const room = this.deps.mirror.roomOfRef(st.agentId);
    return room ? this.deps.mirror.model().rooms.get(room) : undefined;
  }

  private advancePair(st: PairState): void {
    const room = this.pairRoom(st);
    const a = room?.occupants.get(st.agentId);
    const b = room?.occupants.get(st.bRef);
    if (!room || !a || !b) {
      this.deps.hooks.pairAborted({ ...st, cause: "target_lost" });
      return this.endPair(st.pair);
    }
    if (chebyshev(a.tile, b.tile) > 1) {
      // Approach: walk to an adjacent free tile; the walk's `arrived` brings us back.
      const view = this.deps.mirror.view(st.agentId, this.deps.clock.now());
      const roomView = view?.room;
      const to = roomView ? pickTile({ room: roomView, self: st.agentId, near: b.tile, radius: 1, awayFrom: { tile: b.tile, ideal: 1 }, rng: this.deps.rng }) : undefined;
      if (!to) {
        this.deps.hooks.pairAborted({ ...st, cause: "timeout" });
        return this.endPair(st.pair);
      }
      const planId = `${st.pair}:walk`;
      st.approachPlan = planId;
      st.phase = "approach";
      this.sendOne({ agentId: st.agentId, cmd: "walk", to, plan: planId }, this.deps.clock.now());
      this.armPair(st, PAIR_APPROACH_TIMEOUT_MS, "timeout");
      return;
    }
    // Face each other, then act.
    st.phase = "face";
    const now = this.deps.clock.now();
    this.sendOne({ agentId: st.agentId, cmd: "face", targetTile: b.tile }, now);
    if (!st.withHuman) this.sendOne({ agentId: st.bRef, cmd: "face", targetTile: a.tile }, now);
    st.timer?.cancel();
    st.timer = this.deps.clock.setTimer(() => this.actPair(st), PAIR_FACE_MS);
  }

  private actPair(st: PairState): void {
    if (!this.pairs.has(st.pair)) return;
    st.phase = "act";
    this.sendOne({ agentId: st.agentId, cmd: "pair", kind: st.kind, with: st.bRef, pair: st.pair }, this.deps.clock.now());
    this.armPair(st, PAIR_REACTION_TIMEOUT_MS, "timeout");
  }

  private armPair(st: PairState, ms: number, cause: PairedActAbortedPayload["cause"]): void {
    st.timer?.cancel();
    st.timer = this.deps.clock.setTimer(() => {
      if (!this.pairs.has(st.pair)) return;
      this.deps.hooks.pairAborted({ ...st, cause });
      this.endPair(st.pair);
    }, ms);
  }

  private onPairWalkEnded(ref: string, planId: string): void {
    for (const st of this.pairs.values()) {
      if (st.agentId === ref && st.approachPlan === planId && st.phase === "approach") {
        delete st.approachPlan;
        this.advancePair(st);
      }
    }
  }

  private onPairReaction(pair: string, outcome: PairOutcome): void {
    const st = this.pairs.get(pair);
    if (!st) return;
    st.timer?.cancel();
    this.deps.hooks.pairOutcome({ ...st, outcome });
    if (outcome === "aborted" || outcome === "dodge" || outcome === "push") return this.endPair(pair);
    // Accept, timeout (the act completes, D31) and done: hold, then part.
    st.phase = "hold";
    st.timer = this.deps.clock.setTimer(() => this.endPair(pair), PAIR_HOLD_MS);
  }

  private endPair(id: string): void {
    const st = this.pairs.get(id);
    st?.timer?.cancel();
    this.pairs.delete(id);
  }
}

function partOf(c: BodyCommand): NonNullable<BlockedReason["part"]> {
  switch (c.cmd) {
    case "walk":
    case "move_room":
      return "move";
    case "sit":
    case "stand":
    case "lay":
      return "posture";
    case "gesture":
    case "pair":
      return "gesture";
    case "expression":
      return "expression";
    case "face":
      return "face";
    default:
      return "speech";
  }
}
