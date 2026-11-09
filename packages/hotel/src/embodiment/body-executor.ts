import type { BlockedReason, BodyCommand, BodyPlan, PairKind, PairedActAbortedPayload, RoomId, Tile } from "@perfectman/shared";
import type { Clock, TimerHandle } from "../clock/clock.js";
import { validateActCmd } from "../director/act-cmd.js";
import { isDramaFrame } from "../director/drama-frames.js";
import type { DramaFrame } from "../director/drama-frames.js";
import type { ActorCmd, ActorErrorCode, HotelFrame, PairOutcome, SidecarMsg } from "../director/index.js";
import type { ActorSpace } from "../space/space-mirror.js";
import { chebyshev } from "../space/geometry.js";
import type { Logger } from "../util/log.js";
import { silentLogger } from "../util/log.js";
import { CMD_BUDGET, HOTEL_BACKSTOP, WALK_TICK_MS } from "./constants.js";
import { pickTile } from "./tiles.js";
import type { ActLock } from "./act-ledger.js";
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
  /** A dead actor's thought, kept on this side as its ghost voice (DEATH-5); it never reaches the hotel, which refuses it (DEATH-2). */
  ghost?(agentId: string, text: string): void;
  /** The hotel answered `actor_dead`: this actor is dead whatever the sidecar thought (ACT-11). */
  actorDead?(agentId: string): void;
  /** The hotel retired an actor (`actor_gone`): for a permadeath this is the end of its place in the pulses (DEATH-7). */
  gone?(agentId: string): void;
};

export type ExecutorDeps = {
  run: number;
  clock: Clock;
  rng: () => number;
  mirror: ActorSpace;
  lease(): number | undefined;
  nextCid(): number;
  send(msg: SidecarMsg): boolean;
  hooks: ExecutorHooks;
  /** The speaker pool and the body of a dead actor are closed until its revive (DEATH-2, ACT-11). */
  isDead?(ref: string): boolean;
  /** The act that holds this actor's body commands (REA-9, TGT-1, TBL-11). Chat and typing are never held. */
  lockOf?(ref: string): ActLock | undefined;
  /** A dead actor may think aloud, only as a thought and only on this side (DEATH-5; cinematic mode behind a config flag). */
  ghostVoice?: boolean;
  logger?: Logger;
  /** Mirror of every command in and out, for the body probes. */
  record?(dir: "in" | "out", room: RoomId | undefined, kind: string, data: Record<string, unknown>): void;
};

type PairState = PairInfo & {
  phase: "approach" | "face" | "act" | "hold";
  timer: TimerHandle | null;
  approachPlan?: string;
  bRef: string;
  /** Walks (`ref` + plan id) that are still under way when the act is asked for: the act starts when they have ended. */
  waitPlans?: Set<string>;
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
  // The hotel bumps every lease on a reconnect; a command from before the new one is stale, and the actor should look again.
  stale_lease: "stale_space",
  // The act contract's errors: a body that is busy in an act, and a target the hotel will not take.
  act_busy: "busy_moving",
  bad_target: "target_elsewhere",
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
    if (this.deps.isDead?.(agentId)) return this.ghostThought(agentId, clean);
    const now = this.deps.clock.now();
    const times = (this.chatTimes.get(agentId) ?? []).filter((t) => now - t < CHAT_BACKSTOP.windowMs);
    if (times.length >= CHAT_BACKSTOP.count - 1) return; // keep the last slot for a spoken line
    // Thoughts are part of the recording too: a default-mode replay shows them in the log, as the run did.
    const wire: ActorCmd = { k: "chat", mode: "thought", text: clean };
    this.deps.record?.("out", mirror.roomOfRef(agentId), "actor_cmd", { actor: agentId, cmd: wire as unknown as Record<string, unknown> });
    this.deps.send({ t: "actor_cmd", cid: this.deps.nextCid(), run: this.deps.run, lease, actor: id, cmd: wire });
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
          this.releasePairWaiters(ref);
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
        if (ref && frame.code === "actor_dead") this.deps.hooks.actorDead?.(ref);
        else if (ref) {
          const code = BLOCK_MAP[frame.code];
          if (code) this.deps.hooks.blocked(ref, [{ code, ...(frame.detail ? { detail: String(frame.detail).slice(0, 80) } : {}) }]);
          // A refused walk is a plan that never started.
          if (pending?.cmd === "walk") {
            this.plans.delete(ref);
            this.releasePairWaiters(ref);
          }
        }
        break;
      }
      case "pair_reaction": {
        // PAIR-1: in a drama session a refused pair carries the blocked reason, which the planner treats like a blocked act.
        const refused = frame.outcome === "aborted" && frame.reason ? BLOCK_REASONS.get(frame.reason) : undefined;
        if (refused) this.deps.hooks.blocked(mirror.refOfAvatar(frame.actor), [{ code: refused, part: "gesture" }]);
        this.onPairReaction(frame.pair, frame.outcome);
        break;
      }
      case "actor_gone": {
        const ref = mirror.refOfAvatar(frame.actor);
        this.clearActor(ref);
        this.deps.hooks.gone?.(ref);
        break;
      }
      default:
        if (isDramaFrame(frame)) this.onDramaFrame(frame);
        break;
    }
  }

  /**
   * The second frame switch: the drama frames of act-contract.md section 3. The sink (`ActLedger`, the director, the memory writer)
   * reads them; the executor only needs the one that says an act was refused outright (FRM-2), so the planner learns why. Exhaustive,
   * so a new drama frame is a compile error here until somebody decides what the executor does with it.
   */
  private onDramaFrame(frame: DramaFrame): void {
    switch (frame.t) {
      case "act_done": {
        const code = frame.outcome === "blocked" && frame.reason ? BLOCK_REASONS.get(frame.reason) : undefined;
        if (code) this.deps.hooks.blocked(this.deps.mirror.refOfAvatar(frame.actor), [{ code, part: "act", ...(frame.detail ? { detail: String(frame.detail).slice(0, 80) } : {}) }]);
        return;
      }
      case "act_started":
      case "act_beat":
      case "act_reaction":
      case "drama_consent":
      case "actor_death":
      case "actor_revive":
      case "human_down":
      case "human_up":
      case "scene_cut":
      case "drama_state":
        return;
      default: {
        const unhandled: never = frame;
        return unhandled;
      }
    }
  }

  /** DEATH-5: a dead actor's thought stays on this side, and only when the run allows the ghost voice. */
  private ghostThought(agentId: string, text: string): void {
    if (this.deps.ghostVoice) this.deps.hooks.ghost?.(agentId, text.replace(/\s+/g, " ").trim().slice(0, 200));
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

  /**
   * A spoken line. True only when the frame actually went to the hotel; the chat backstop, the staleness gate,
   * the command budget and a dead link all return false, so the caller never counts those as delivered.
   */
  sendChat(c: Extract<BodyCommand, { cmd: "chat" }>): boolean {
    return this.sendOne(c, this.deps.clock.now());
  }

  private sendOne(c: PlannedCommand, now: number): boolean {
    const { mirror } = this.deps;
    const id = mirror.avatarId(c.agentId);
    const lease = this.deps.lease();
    if (id === undefined || lease === undefined) {
      this.deps.hooks.blocked(c.agentId, [{ code: "unknown_ref" }]);
      return false;
    }
    // DEATH-2: the dead say and do nothing. The hotel would answer actor_dead to all of it; the speaker pool is closed here first.
    if (this.deps.isDead?.(c.agentId)) {
      if (c.cmd === "chat" && this.deps.ghostVoice) this.ghostThought(c.agentId, c.text);
      return false;
    }
    // REA-9, ACT-12: an actor held by an act sends no body command (the hotel would answer act_busy and the budget would be spent for
    // nothing). A reaction owed to a debt is the one exception, and chat and typing are never held.
    if (c.cmd !== "chat" && c.cmd !== "typing" && !c.owed) {
      const lock = this.deps.lockOf?.(c.agentId);
      if (lock) {
        this.deps.hooks.blocked(c.agentId, [{ code: "busy_moving", part: partOf(c), detail: lock.why }]);
        return false;
      }
    }
    // An act the hotel would refuse on its face (ACT-4 to ACT-9) never spends one of the actor's commands.
    if (c.cmd === "act" && !this.toWire(c)) return false;
    const roomId = mirror.roomOfRef(c.agentId);
    const room = roomId ? mirror.roomHealth(roomId) : undefined;
    const counted = c.cmd !== "typing" && c.cmd !== "chat";

    if (counted) {
      // Stale or degraded space: no body commands (embodiment.md 3.1).
      if (!room || room.degraded || now - room.syncedAtWall > 5000) {
        this.stats.droppedStale++;
        this.deps.hooks.blocked(c.agentId, [{ code: "stale_space" }]);
        return false;
      }
      const body = mirror.bodyOf(c.agentId, now);
      body.budget.cmdTimes = body.budget.cmdTimes.filter((t) => now - t < CMD_BUDGET.windowMs);
      const isMove = c.cmd === "walk" || c.cmd === "sit" || c.cmd === "move_room" || c.cmd === "stand" || c.cmd === "lay";
      // A reaction owed to a debt is not a luxury: like a move it may use the hotel's own 8 per 5 s, never the planner's soft 4 (REA-1).
      const limit = isMove || c.owed ? HOTEL_BACKSTOP.count : CMD_BUDGET.count;
      if (body.budget.cmdTimes.length >= limit) {
        this.stats.droppedBudget++;
        this.deps.hooks.blocked(c.agentId, [{ code: "slow_down", part: partOf(c) }]);
        return false;
      }
      body.budget.cmdTimes.push(now);
    } else if (c.cmd === "chat") {
      const times = (this.chatTimes.get(c.agentId) ?? []).filter((t) => now - t < CHAT_BACKSTOP.windowMs);
      if (times.length >= CHAT_BACKSTOP.count) return false;
      times.push(now);
      this.chatTimes.set(c.agentId, times);
    }

    const wire = this.toWire(c);
    if (!wire) return false;
    const cid = this.deps.nextCid();
    if (c.cmd === "walk") this.trackPlan(c, now);
    this.pendingCids.set(cid, { agentId: c.agentId, cmd: c.cmd });
    if (this.pendingCids.size > 512) this.pendingCids.delete(this.pendingCids.keys().next().value as number);
    this.stats.sent++;
    this.deps.record?.("out", roomId, "actor_cmd", { actor: c.agentId, cmd: wire as unknown as Record<string, unknown> });
    return this.deps.send({ t: "actor_cmd", cid, run: this.deps.run, lease, actor: id, cmd: wire });
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
      case "act": {
        const actor = num(c.agentId);
        const target = c.with === undefined ? undefined : num(c.with);
        if (actor === undefined || (c.with !== undefined && target === undefined)) return undefined;
        const wire: ActorCmd = {
          k: "act",
          act_id: c.actId,
          verb: c.verb,
          ...(target !== undefined ? { with: target } : {}),
          ...(c.intensity !== undefined ? { intensity: c.intensity } : {}),
          ...(c.origin !== undefined ? { origin: c.origin } : {}),
          ...(c.authoredSkip !== undefined ? { authored_skip: c.authoredSkip } : {}),
          ...(c.text !== undefined ? { text: c.text } : {}),
        };
        // Ids are unique per run (ACT-5): that ledger is the director's, the link's `sendAct` keeps it. The frame itself is checked here.
        return validateActCmd(wire, { run: this.deps.run, actor }, new Set()) === undefined ? wire : undefined;
      }
    }
  }

  private trackPlan(c: Extract<BodyCommand, { cmd: "walk" }>, now: number): void {
    const self = this.deps.mirror.presenceOf(c.agentId);
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
    // One pair act in flight per human, whoever started it: a person is not mobbed by two admirers at once.
    if (withHuman && [...this.pairs.values()].some((p) => p.withHuman && p.bRef === c.with)) {
      this.deps.hooks.blocked(c.agentId, [{ code: "cooldown", part: "gesture" }]);
      return;
    }
    const st: PairState = { pair: c.pair, kind: c.kind, agentId: c.agentId, withRef: c.with, bRef: c.with, withHuman, phase: "approach", timer: null };
    this.pairs.set(c.pair, st);
    // A walk still under way (the actor's own, or the partner's: both may have been held for their shot and sent
    // just before this act) moves somebody out from under the act, which the hotel answers with not_adjacent.
    // The act waits for the arrival and then looks at where everybody ended up.
    const walking = [c.agentId, c.with].flatMap((ref) => {
      const entry = this.plans.get(ref);
      return entry?.plan.status === "moving" ? [`${ref}|${entry.plan.id}`] : [];
    });
    if (walking.length > 0) {
      st.waitPlans = new Set(walking);
      this.armPair(st, PAIR_APPROACH_TIMEOUT_MS, "timeout");
      return;
    }
    this.advancePair(st);
  }

  private advancePair(st: PairState): void {
    const { mirror } = this.deps;
    const room = mirror.roomOfRef(st.agentId);
    const a = room !== undefined ? mirror.presenceIn(room, st.agentId) : undefined;
    const b = room !== undefined ? mirror.presenceIn(room, st.bRef) : undefined;
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
    for (const st of [...this.pairs.values()]) {
      if (st.phase !== "approach") continue;
      if (st.waitPlans?.delete(`${ref}|${planId}`) && st.waitPlans.size === 0) {
        delete st.waitPlans;
        this.advancePair(st);
      } else if (st.agentId === ref && st.approachPlan === planId) {
        delete st.approachPlan;
        this.advancePair(st);
      }
    }
  }

  /** A walk that will never `arrive` (refused, or the actor left the room) must not hold an act forever. */
  private releasePairWaiters(ref: string): void {
    for (const st of [...this.pairs.values()]) {
      if (st.phase !== "approach" || !st.waitPlans) continue;
      for (const key of [...st.waitPlans]) if (key.startsWith(`${ref}|`)) st.waitPlans.delete(key);
      if (st.waitPlans.size === 0) {
        delete st.waitPlans;
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

const BLOCK_REASONS: ReadonlyMap<string, BlockedReason["code"]> = new Map(
  (["kill_switch", "calm_room", "consent_off", "ladder", "budget", "dead_target", "no_scenario_gate", "rate_limit", "too_far", "cooldown"] as const).map((r) => [r, r]),
);

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
    case "act":
      return "act";
    case "expression":
      return "expression";
    case "face":
      return "face";
    default:
      return "speech";
  }
}
