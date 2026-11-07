import {
  SAY_CLEAR_TILES,
  SAY_GARBLED_TILES,
  STALE_MS,
  TICK_MS,
  applySpaceAction,
  chebyshev,
  createSpaceModel,
  defaultAgentBody,
  findPath,
  projectSpaceView,
  sectorBetween,
  type RoomSnapshot,
  type SpaceChange,
} from "@perfectman/engine";
import type { IBodyGateway } from "@perfectman/server";
import type {
  AgentBody,
  AvatarState,
  BodyCommand,
  BodyFrame,
  BodyFrameLog,
  Direction8,
  HearingLevel,
  Presence,
  RoomId,
  RoomModel,
  SpaceMirror,
  SpaceModel,
  SpaceView,
  SpeechMode,
  Tile,
} from "@perfectman/shared";
import { DEFAULT_LAYOUTS, type RoomLayout } from "./layouts.js";

/**
 * Deterministic stand-in for Tilehouse behind `IBodyGateway` (docs/plans/
 * hotel-package.md section 15, docs/embodiment.md section 1.1). It owns the
 * clock (one tick = 300 ms), moves walkers one tile per tick along the engine
 * pathfinder, enforces the Tilehouse limits that matter to probes, and drives
 * its `SpaceModel` ONLY through the engine reducer, so what the engine sees is
 * what a real mirror would see. Every frame in either direction goes to a
 * `BodyFrameLog` the body probes read.
 *
 * Frame kinds. Out (sidecar to hotel): `actor_cmd`. In: `walk_started`,
 * `moves`, `avatar_state`, `avatar_action`, `arrived`, `moved_room`,
 * `actor_error`, `chat`, `human_chat`, `typing`, `room_ping`.
 */

export const GESTURE_DURATION_MS: Record<string, number> = {
  wave: 5000,
  blow: 1400,
  laugh: 2000,
  thumbs: 2000,
  sign: 5000,
};
/** Gestures that last until stopped. */
const OPEN_ENDED = new Set(["dance", "idle"]);

export const ACTOR_CMD_LIMIT = 8;
export const ACTOR_CMD_WINDOW_MS = 5000;
export const CHAT_LIMIT = 4;
export const CHAT_WINDOW_MS = 6000;
export const JOIN_INTERVAL_MS = 200;
const PING_EVERY_MS = 2000;

export type GridErrorCode =
  | "slow_down"
  | "chat_limit"
  | "unknown_actor"
  | "refused_walking"
  | "refused_state"
  | "no_route"
  | "seat_taken"
  | "not_a_seat"
  | "room_unreachable"
  | "too_far"
  | "join_interval";

/** Events the hotel would send back to the sidecar and the harness feeds into the log. */
export type GridEvent =
  | { type: "arrived"; agentId: string; room: RoomId; tile: Tile; planId: string }
  | { type: "moved_room"; agentId: string; from: RoomId; to: RoomId }
  | { type: "actor_error"; agentId: string; code: GridErrorCode; cmd: string }
  | {
      type: "human_chat";
      ref: string;
      name: string;
      text: string;
      mode: SpeechMode;
      room: RoomId;
      tile: Tile;
      /** The person a whisper is for, or whom the human named. */
      to?: string;
    };

type Walker = {
  ref: string;
  room: RoomId;
  route: Tile[];
  planId: string;
  seatId?: number;
  exitTo?: RoomId;
};

export type FakeGridOptions = {
  startMs?: number;
  layouts?: readonly RoomLayout[];
  snapshotEveryMs?: number;
  onEvent?: (event: GridEvent) => void;
};

export class FakeGridHotel implements IBodyGateway, SpaceMirror {
  private readonly space: SpaceModel = createSpaceModel();
  private readonly layouts = new Map<RoomId, RoomLayout>();
  private readonly frames: BodyFrame[] = [];
  private readonly snapshots: BodyFrameLog["snapshots"] = [];
  private readonly walkers = new Map<string, Walker>();
  private readonly cmdTimes = new Map<string, number[]>();
  private readonly chatTimes = new Map<string, number[]>();
  private readonly lastJoinAt = new Map<RoomId, number>();
  private readonly frozen = new Set<RoomId>();
  private readonly actors = new Set<string>();
  private readonly gestureUntil = new Map<string, number>();
  private t: number;
  private nextTickAt: number;
  private nextSnapshotAt: number;
  private nextPingAt: number;
  private planSeq = 0;
  private readonly snapshotEveryMs: number;
  private onEvent?: (event: GridEvent) => void;

  /** Counters the probes and tests read. */
  readonly stats = { slowDown: 0, refused: 0, commands: 0 };

  constructor(options: FakeGridOptions = {}) {
    this.t = options.startMs ?? 1_000_000;
    this.nextTickAt = this.t + TICK_MS;
    this.snapshotEveryMs = options.snapshotEveryMs ?? 1000;
    this.nextSnapshotAt = this.t;
    this.nextPingAt = this.t + PING_EVERY_MS;
    this.onEvent = options.onEvent;
    for (const layout of options.layouts ?? DEFAULT_LAYOUTS) this.layouts.set(layout.id, layout);
    for (const layout of this.layouts.values()) {
      applySpaceAction(this.space, {
        type: "room_snapshot",
        at: this.t,
        rev: 1,
        room: this.snapshotOf(layout),
      });
    }
  }

  setOnEvent(handler: (event: GridEvent) => void): void {
    this.onEvent = handler;
  }

  // ---- SpaceMirror ---------------------------------------------------------

  model(): SpaceModel {
    return this.space;
  }

  view(agentId: string, now: number): SpaceView | undefined {
    return projectSpaceView(this.space, agentId, now);
  }

  now(): number {
    return this.t;
  }

  roomLayout(id: RoomId): RoomLayout | undefined {
    return this.layouts.get(id);
  }

  // ---- people --------------------------------------------------------------

  /** An actor appears in a room (registered with the model, so views and hearing know it). */
  spawnActor(agentId: string, name: string, room: RoomId = "lounge", tile?: Tile): boolean {
    if (!this.joinAllowed(room, agentId)) return false;
    this.actors.add(agentId);
    applySpaceAction(this.space, { type: "agent_room", agentId, room });
    this.cmdTimes.set(agentId, []);
    this.join(agentId, name, "actor", room, tile);
    return true;
  }

  humanEnter(userId: string, name: string, room: RoomId = "lounge", tile?: Tile): string {
    const ref = `h:${userId}`;
    this.join(ref, name, "human", room, tile);
    return ref;
  }

  humanLeave(ref: string): void {
    const w = this.presenceRoom(ref);
    if (!w) return;
    this.walkers.delete(ref);
    this.delta(w, { kind: "occupant_left", ref });
  }

  humanWalk(ref: string, to: Tile): boolean {
    const room = this.presenceRoom(ref);
    const me = room?.occupants.get(ref);
    if (!room || !me) return false;
    const route = findPath(room, me.tile, [to]);
    if (!route) return false;
    this.walkers.set(ref, { ref, room: room.id, route, planId: `p${++this.planSeq}` });
    if (route.length > 0) this.delta(room, { kind: "occupant_moved", ref, tile: me.tile, state: "walk", walkGoal: to });
    return true;
  }

  humanType(ref: string, on: boolean): void {
    const room = this.presenceRoom(ref);
    if (!room) return;
    this.delta(room, { kind: "occupant_typing", ref, typing: on });
    this.frame("in", "typing", { ref, on }, room.id);
  }

  /** A human line. The harness turns the emitted event into a guest ingestion. */
  humanSay(ref: string, text: string, mode: SpeechMode = "say", to?: string): Extract<GridEvent, { type: "human_chat" }> {
    const room = this.presenceRoom(ref);
    const me = room?.occupants.get(ref);
    if (!room || !me) throw new Error(`${ref} is not in a room`);
    this.delta(room, { kind: "occupant_spoke", ref });
    this.delta(room, { kind: "occupant_typing", ref, typing: false });
    this.frame("in", "human_chat", { ref, text, mode, tile: me.tile, ...(to ? { toRef: to } : {}) }, room.id);
    const event = { type: "human_chat" as const, ref, name: me.name, text, mode, room: room.id, tile: me.tile, ...(to ? { to } : {}) };
    this.onEvent?.(event);
    return event;
  }

  // ---- fault injection -----------------------------------------------------

  /** Stop pinging a room: its mirror goes stale after STALE_MS (probe: stale-command-rate). */
  freezeSync(room: RoomId, frozen = true): void {
    if (frozen) this.frozen.add(room);
    else this.frozen.delete(room);
  }

  // ---- gateway -------------------------------------------------------------

  dispatch(commands: BodyCommand[]): Promise<void> {
    for (const command of commands) this.handle(command);
    return Promise.resolve();
  }

  /** Advance the clock; ticks, pings and snapshots happen in order on the way. */
  advance(ms: number): void {
    const target = this.t + ms;
    for (;;) {
      const next = Math.min(this.nextTickAt, this.nextPingAt, this.nextSnapshotAt);
      if (next > target) break;
      this.t = next;
      if (this.nextSnapshotAt === next) {
        this.takeSnapshots();
        this.nextSnapshotAt += this.snapshotEveryMs;
      }
      if (this.nextPingAt === next) {
        this.ping();
        this.nextPingAt += PING_EVERY_MS;
      }
      if (this.nextTickAt === next) {
        this.tick();
        this.nextTickAt += TICK_MS;
      }
    }
    this.t = target;
  }

  frameLog(): BodyFrameLog {
    return { frames: [...this.frames], snapshots: [...this.snapshots] };
  }

  /** Patch executor-owned body state (plans, pending speech, dwell) through the reducer. */
  patchBody(agentId: string, patch: Partial<AgentBody>): void {
    applySpaceAction(this.space, { type: "agent_body", agentId, patch });
  }

  // ---- internals -----------------------------------------------------------

  private snapshotOf(layout: RoomLayout): RoomSnapshot {
    return {
      id: layout.id,
      name: layout.name,
      template: layout.template,
      w: layout.w,
      h: layout.h,
      door: Object.values(layout.exits)[0]?.door ?? layout.entry,
      doorDir: 2,
      heights: new Array<number>(layout.w * layout.h).fill(0),
      furni: layout.furni,
      occupants: [],
      adjacency: Object.entries(layout.exits).map(([roomId, exit]) => ({
        roomId,
        viaDoor: exit.door,
        travelS: Math.round(chebyshev(layout.entry, exit.door) * (TICK_MS / 1000)) + 1,
        name: this.layouts.get(roomId)?.name ?? roomId,
      })),
    };
  }

  private presenceRoom(ref: string): RoomModel | undefined {
    for (const room of this.space.rooms.values()) if (room.occupants.has(ref)) return room;
    return undefined;
  }

  private joinAllowed(room: RoomId, who: string): boolean {
    const last = this.lastJoinAt.get(room);
    if (last !== undefined && this.t - last < JOIN_INTERVAL_MS) {
      this.frame("in", "actor_error", { agentId: who, code: "join_interval", cmd: "join" }, room);
      return false;
    }
    this.lastJoinAt.set(room, this.t);
    return true;
  }

  private join(ref: string, name: string, kind: "actor" | "human", room: RoomId, tile?: Tile): void {
    const model = this.space.rooms.get(room);
    const layout = this.layouts.get(room);
    if (!model || !layout) throw new Error(`unknown room ${room}`);
    const presence: Presence = {
      ref,
      name,
      kind,
      tile: tile ?? layout.entry,
      dir: 2,
      state: "stand",
      since: this.t,
      lastMovedAt: this.t,
    };
    this.delta(model, { kind: "occupant_joined", presence });
  }

  private delta(room: RoomModel, change: SpaceChange): void {
    applySpaceAction(this.space, { type: "room_delta", at: this.t, roomId: room.id, rev: room.rev + 1, change });
  }

  private frame(dir: "in" | "out", kind: string, data: Record<string, unknown>, room?: RoomId): void {
    this.frames.push({ atMs: this.t, dir, kind, data, ...(room ? { room } : {}) });
  }

  private ping(): void {
    for (const room of this.space.rooms.values()) {
      if (this.frozen.has(room.id)) continue;
      applySpaceAction(this.space, { type: "room_ping", at: this.t, roomId: room.id, rev: room.rev });
      this.frame("in", "room_ping", { rev: room.rev }, room.id);
    }
  }

  private takeSnapshots(): void {
    for (const room of this.space.rooms.values()) {
      if (room.occupants.size === 0) continue;
      this.snapshots.push({
        atMs: this.t,
        room: room.id,
        occupants: [...room.occupants.values()].map((p) => ({ ref: p.ref, tile: p.tile, dir: p.dir, state: p.state })),
      });
    }
  }

  private error(agentId: string, code: GridErrorCode, cmd: string, room?: RoomId): void {
    if (code === "slow_down" || code === "chat_limit") this.stats.slowDown += 1;
    else this.stats.refused += 1;
    this.frame("in", "actor_error", { agentId, code, cmd }, room);
    this.onEvent?.({ type: "actor_error", agentId, code, cmd });
  }

  private handle(command: BodyCommand): void {
    const { agentId, cmd } = command;
    const room = this.presenceRoom(agentId);
    const me = room?.occupants.get(agentId);
    const stale = room ? this.t - room.syncedAtWall > STALE_MS || room.degraded : true;
    this.frame("out", "actor_cmd", { ...command, stale }, room?.id);
    this.stats.commands += 1;
    if (!room || !me || !this.actors.has(agentId)) return this.error(agentId, "unknown_actor", cmd, room?.id);

    // The hotel's own actor limiter: walk included (Tilehouse itself has none for walk).
    const times = (this.cmdTimes.get(agentId) ?? []).filter((x) => this.t - x < ACTOR_CMD_WINDOW_MS);
    if (times.length >= ACTOR_CMD_LIMIT) {
      this.cmdTimes.set(agentId, times);
      return this.error(agentId, "slow_down", cmd, room.id);
    }
    times.push(this.t);
    this.cmdTimes.set(agentId, times);
    this.syncBodyBudget(agentId, times);

    const walking = this.walkers.get(agentId)?.route.length ? true : false;
    switch (command.cmd) {
      case "walk": {
        const route = findPath(room, me.tile, [command.to]);
        if (!route) return this.error(agentId, "no_route", cmd, room.id);
        this.startWalk(room, me, route, command.plan, undefined, undefined);
        return;
      }
      case "face": {
        const dir: Direction8 | undefined =
          command.dir ?? (command.targetTile ? sectorBetween(me.tile, command.targetTile) : undefined);
        if (dir !== undefined) this.delta(room, { kind: "occupant_turned", ref: agentId, dir });
        return;
      }
      case "sit": {
        const furni = room.furni.get(command.furniId);
        if (!furni || !furni.kinds.includes("sit")) return this.error(agentId, "not_a_seat", cmd, room.id);
        if (walking) return this.error(agentId, "refused_walking", cmd, room.id);
        const taken = [...room.occupants.values()].some((o) => o.seatId === furni.id && o.ref !== agentId);
        if (taken) return this.error(agentId, "seat_taken", cmd, room.id);
        const seat = furni.tiles[0]!;
        const route = findPath(room, me.tile, [seat]);
        if (!route) return this.error(agentId, "no_route", cmd, room.id);
        this.startWalk(room, me, route, undefined, furni.id, undefined);
        return;
      }
      case "stand":
        this.delta(room, { kind: "occupant_state", ref: agentId, state: "stand", seatId: null });
        this.frame("in", "avatar_state", { agentId, state: "stand" }, room.id);
        return;
      case "lay": {
        const seat = [...room.furni.values()].find((f) => f.id === me.seatId);
        if (!seat?.kinds.includes("lay")) return this.error(agentId, "not_a_seat", cmd, room.id);
        this.delta(room, { kind: "occupant_state", ref: agentId, state: "lay", seatId: seat.id });
        return;
      }
      case "gesture": {
        const a = command.a === "kiss" ? "blow" : command.a;
        if (walking || (me.state !== "stand" && me.state !== "sit" && me.state !== "dance")) {
          return this.error(agentId, "refused_walking", cmd, room.id);
        }
        if (a === "stop") {
          this.delta(room, { kind: "occupant_state", ref: agentId, state: "stand", seatId: null });
          return;
        }
        const until = OPEN_ENDED.has(a) ? Number.MAX_SAFE_INTEGER : this.t + (GESTURE_DURATION_MS[a] ?? 2000);
        this.delta(room, { kind: "occupant_gesture", ref: agentId, a, ...(command.style !== undefined ? { style: command.style } : {}), until });
        if (a === "dance") this.delta(room, { kind: "occupant_state", ref: agentId, state: "dance" });
        this.gestureUntil.set(agentId, until);
        this.frame("in", "avatar_action", { agentId, a, ...(command.style !== undefined ? { style: command.style } : {}) }, room.id);
        this.syncGestureDwell(agentId, command.a);
        return;
      }
      case "expression":
        this.frame("in", "avatar_action", { agentId, a: `face:${command.face}` }, room.id);
        return;
      case "typing":
        this.delta(room, { kind: "occupant_typing", ref: agentId, typing: command.on });
        this.frame("in", "typing", { ref: agentId, on: command.on }, room.id);
        return;
      case "chat":
        this.chat(room, me, command);
        return;
      case "move_room": {
        const layout = this.layouts.get(room.id);
        const exit = layout?.exits[command.to];
        if (!exit) return this.error(agentId, "room_unreachable", cmd, room.id);
        const route = findPath(room, me.tile, [exit.door]);
        if (!route) return this.error(agentId, "no_route", cmd, room.id);
        this.startWalk(room, me, route, undefined, undefined, command.to);
        return;
      }
      case "pair": {
        const other = room.occupants.get(command.with);
        if (!other || chebyshev(me.tile, other.tile) > 1) return this.error(agentId, "too_far", cmd, room.id);
        for (const ref of [agentId, command.with]) {
          this.delta(room, { kind: "occupant_gesture", ref, a: "blow", until: this.t + 1400 });
        }
        this.frame("in", "avatar_action", { agentId, a: "blow", pair: command.pair }, room.id);
        return;
      }
    }
  }

  private startWalk(room: RoomModel, me: Presence, route: Tile[], plan: string | undefined, seatId: number | undefined, exitTo: RoomId | undefined): void {
    const planId = plan ?? `p${++this.planSeq}`;
    this.walkers.set(me.ref, { ref: me.ref, room: room.id, route, planId, ...(seatId !== undefined ? { seatId } : {}), ...(exitTo ? { exitTo } : {}) });
    this.frame("in", "walk_started", { agentId: me.ref, planId, from: me.tile, to: route.at(-1) ?? me.tile, etaMs: route.length * TICK_MS }, room.id);
    if (route.length === 0) {
      this.finishWalk(room, this.walkers.get(me.ref)!);
      return;
    }
    // A stand-up from a seat or dance is implicit in leaving it.
    this.delta(room, { kind: "occupant_moved", ref: me.ref, tile: me.tile, state: "walk", walkGoal: route.at(-1)! });
  }

  private tick(): void {
    for (const walker of [...this.walkers.values()]) {
      const room = this.space.rooms.get(walker.room);
      const me = room?.occupants.get(walker.ref);
      if (!room || !me) {
        this.walkers.delete(walker.ref);
        continue;
      }
      const next = walker.route.shift();
      if (!next) continue;
      const dir = sectorBetween(me.tile, next);
      this.delta(room, { kind: "occupant_moved", ref: walker.ref, tile: next, dir, state: "walk" });
      this.frame("in", "moves", { agentId: walker.ref, tile: next, dir }, room.id);
      if (walker.route.length === 0) this.finishWalk(room, walker);
    }
  }

  private finishWalk(room: RoomModel, walker: Walker): void {
    this.walkers.delete(walker.ref);
    const me = room.occupants.get(walker.ref);
    if (!me) return;
    if (walker.exitTo) {
      this.transit(room, walker);
      return;
    }
    if (walker.seatId !== undefined) {
      const dir = (me.dir - (me.dir % 2)) as Direction8; // Tilehouse snaps a sitter to an even direction
      this.delta(room, { kind: "occupant_state", ref: walker.ref, state: "sit", seatId: walker.seatId, dir });
      this.frame("in", "avatar_state", { agentId: walker.ref, state: "sit", seatId: walker.seatId }, room.id);
    } else {
      this.delta(room, { kind: "occupant_moved", ref: walker.ref, tile: me.tile, state: "stand" as AvatarState, walkGoal: null });
    }
    const arrivedTile = room.occupants.get(walker.ref)?.tile ?? me.tile;
    this.frame("in", "arrived", { agentId: walker.ref, planId: walker.planId, tile: arrivedTile }, room.id);
    if (this.actors.has(walker.ref)) {
      this.onEvent?.({ type: "arrived", agentId: walker.ref, room: room.id, tile: arrivedTile, planId: walker.planId });
    }
  }

  private transit(from: RoomModel, walker: Walker): void {
    const to = walker.exitTo!;
    const dest = this.space.rooms.get(to);
    const exit = this.layouts.get(from.id)?.exits[to];
    const me = from.occupants.get(walker.ref);
    if (!dest || !exit || !me) return;
    this.delta(from, { kind: "occupant_left", ref: walker.ref });
    this.frame("in", "moved_room", { agentId: walker.ref, from: from.id, to }, to);
    this.delta(dest, { kind: "occupant_joined", presence: { ...me, tile: exit.arrive, state: "stand", since: this.t, lastMovedAt: this.t } });
    if (this.actors.has(walker.ref)) this.onEvent?.({ type: "moved_room", agentId: walker.ref, from: from.id, to });
  }

  private chat(room: RoomModel, me: Presence, command: Extract<BodyCommand, { cmd: "chat" }>): void {
    const recent = (this.chatTimes.get(me.ref) ?? []).filter((x) => this.t - x < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_LIMIT) {
      this.chatTimes.set(me.ref, recent);
      return this.error(me.ref, "chat_limit", "chat", room.id);
    }
    recent.push(this.t);
    this.chatTimes.set(me.ref, recent);
    this.delta(room, { kind: "occupant_spoke", ref: me.ref });
    const target = command.to ? this.presenceRoom(command.to)?.occupants.get(command.to) : undefined;
    const sameRoom = target ? this.presenceRoom(command.to!)?.id === room.id : undefined;
    this.frame(
      "in",
      "chat",
      {
        agentId: me.ref,
        mode: command.mode,
        text: command.text,
        ...(command.to ? { toRef: command.to } : {}),
        tile: me.tile,
        ...(target ? { toTile: target.tile, sameRoom, distance: sameRoom ? chebyshev(me.tile, target.tile) : -1 } : {}),
      },
      room.id,
    );
  }

  private syncBodyBudget(agentId: string, times: number[]): void {
    const body = this.space.body.get(agentId) ?? defaultAgentBody();
    this.space.body.set(agentId, { ...body, budget: { cmdTimes: [...times] } });
  }

  private syncGestureDwell(agentId: string, kind: string): void {
    const body = this.space.body.get(agentId) ?? defaultAgentBody();
    this.space.body.set(agentId, {
      ...body,
      dwell: { ...body.dwell, lastGestureAt: { ...body.dwell.lastGestureAt, [kind]: this.t } },
    });
  }
}

/** Who hears a line from `speaker` at `tile` in `room`, and how well (embodiment.md 5.2). */
export function hearingInRoom(
  room: RoomModel,
  speakerRef: string,
  mode: SpeechMode,
  whisperTo?: string,
): { visibleToAgents: string[]; hearing: Record<string, HearingLevel> } {
  const speaker = room.occupants.get(speakerRef);
  const hearing: Record<string, HearingLevel> = {};
  if (!speaker) return { visibleToAgents: [], hearing };
  for (const occupant of room.occupants.values()) {
    if (occupant.ref === speakerRef || occupant.kind !== "actor") continue;
    const d = chebyshev(speaker.tile, occupant.tile);
    let level: HearingLevel | undefined;
    if (mode === "shout") level = "clear";
    else if (mode === "whisper") level = occupant.ref === whisperTo ? "clear" : d <= 2 ? "notice" : undefined;
    else level = d <= SAY_CLEAR_TILES ? "clear" : d <= SAY_GARBLED_TILES ? "garbled" : undefined;
    if (level) hearing[occupant.ref] = level;
  }
  return { visibleToAgents: Object.keys(hearing), hearing };
}
