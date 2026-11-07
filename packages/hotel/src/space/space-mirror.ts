import type {
  ActiveGesture,
  AgentBody,
  AvatarState,
  Direction8,
  FurniModel,
  Presence,
  RoomId,
  RoomModel,
  RoomView,
  SpaceMirror,
  SpaceModel,
  SpaceView,
  Tile,
} from "@perfectman/shared";
import type { Avatar, Furni, HotelMsg, RoomSnapshot, SnapDef, SnapSeat } from "../director/index.js";
import { sanitizeText } from "../util/text.js";
import { chebyshev } from "./geometry.js";
import { classifyFurni, deriveRoomZones, type DeriveZones } from "./zones.js";

export const STALE_MS = 5000;
export const HUMAN_EXPIRY_MS = 8000;
const WALK_TICK_MS = 300;
const DEAD_RECKON_AFTER_MS = 600;
const GESTURE_MS: Record<string, number> = { wave: 5000, blow: 1400, laugh: 2000, thumbs: 2000, sign: 5000 };

type DeltaMsg = Extract<HotelMsg, { t: "delta" }>;
type PingMsg = Extract<HotelMsg, { t: "room_ping" }>;

/** Result of applying a rev-carrying frame. `gap` asks the caller to resnapshot that room. */
export type ApplyResult = { ok: true; resnapshot?: boolean } | { ok: false; reason: "gap" | "unknown_room" | "degraded"; room: RoomId };

export type OwnActor = { ref: string; id: number; run: number; name: string };

export type MirrorListener = {
  /** A presence changed tile (walk step, forced step, arrival). */
  onMoved?(ref: string, room: RoomId, from: Tile, to: Tile, at: number): void;
  /** A human started or stopped typing, or spoke. */
  onHumanTyping?(room: RoomId, ref: string, on: boolean, at: number): void;
  onLeft?(ref: string, room: RoomId, at: number): void;
};

export type MirrorOptions = {
  deriveZones?: DeriveZones;
  listener?: MirrorListener;
  /** Reading the clock is the caller's job; the mirror only stamps what it is handed. */
};

const roomIdOf = (n: number): RoomId => String(n);

export function defaultBody(now: number): AgentBody {
  return { dwell: { postureSince: now, placeSince: now, lastGestureAt: {} }, budget: { cmdTimes: [] } };
}

function stateOf(s: string): AvatarState {
  return s === "walk" || s === "sit" || s === "lay" || s === "dance" ? s : "stand";
}

function heightOf(ch: string): number {
  if (ch === "x") return 255;
  const n = parseInt(ch, 36);
  return Number.isNaN(n) ? 255 : n;
}

/**
 * Driver from Director frames to the shared `SpaceModel` (embodiment.md 3,
 * hotel-package.md 11). One mirror per sidecar connection; rooms are keyed by
 * their hotel id. `rev` is per room (lead resolution R5): a delta must be
 * exactly `rev + 1` or the room is `degraded` until the caller's resnapshot
 * lands. Reads are pure projections (`view`), dead-reckoned and expiry-aware.
 */
export class HotelSpaceMirror implements SpaceMirror {
  private readonly space: SpaceModel = { rooms: new Map(), agentRoom: new Map(), body: new Map() };
  private readonly own = new Map<number, OwnActor>();
  private readonly idByRef = new Map<string, number>();
  private readonly typingAt = new Map<string, number>();
  /** Furni definitions per room from its last snapshot, so a furni delta applies in place. */
  /** Every room the hotel has told us about (hello runs, actors, snapshots): all reachable by door (D24). */
  private readonly knownRooms = new Map<RoomId, string | undefined>();
  private readonly defsByRoom = new Map<RoomId, Record<string, SnapDef | undefined>>();
  private readonly derive: DeriveZones;
  private readonly listener: MirrorListener;

  constructor(opts: MirrorOptions = {}) {
    this.derive = opts.deriveZones ?? deriveRoomZones;
    this.listener = opts.listener ?? {};
  }

  model(): SpaceModel {
    return this.space;
  }

  // ---- identity -----------------------------------------------------------

  registerActor(actor: OwnActor, room: RoomId, now: number): void {
    this.own.set(actor.id, actor);
    // The avatar_joined delta can arrive before actor_spawned: re-key it from "h:<id>".
    const r = this.space.rooms.get(room);
    const early = r?.occupants.get(`h:${actor.id}`);
    if (r && early) {
      r.occupants.delete(early.ref);
      r.occupants.set(actor.ref, { ...early, ref: actor.ref, kind: "actor" });
    }
    this.idByRef.set(actor.ref, actor.id);
    this.space.agentRoom.set(actor.ref, room);
    if (!this.space.body.has(actor.ref)) this.space.body.set(actor.ref, defaultBody(now));
  }

  unregisterActor(ref: string): void {
    const id = this.idByRef.get(ref);
    if (id === undefined) return;
    const room = this.roomOfRef(ref);
    if (room) this.space.rooms.get(room)?.occupants.delete(ref);
    this.own.delete(id);
    this.idByRef.delete(ref);
    this.space.agentRoom.delete(ref);
    this.space.body.delete(ref);
  }

  /** Numeric avatar id for a ref (`h:<id>` for people, the agent id for own actors). */
  avatarId(ref: string): number | undefined {
    if (ref.startsWith("h:")) {
      const n = Number(ref.slice(2));
      return Number.isInteger(n) ? n : undefined;
    }
    return this.idByRef.get(ref);
  }

  refOfAvatar(id: number): string {
    return this.own.get(id)?.ref ?? `h:${id}`;
  }

  runOfAvatar(id: number): number | undefined {
    return this.own.get(id)?.run;
  }

  isOwn(id: number): boolean {
    return this.own.has(id);
  }

  roomOfRef(ref: string): RoomId | undefined {
    const r = this.space.agentRoom.get(ref);
    return r && r !== "in_transit" ? r : undefined;
  }

  bodyOf(ref: string, now: number): AgentBody {
    let body = this.space.body.get(ref);
    if (!body) {
      body = defaultBody(now);
      this.space.body.set(ref, body);
    }
    return body;
  }

  // ---- frames -------------------------------------------------------------

  applySnapshot(snap: RoomSnapshot, now: number): void {
    const id = roomIdOf(snap.room);
    const rows = snap.layout.rows;
    const w = Math.max(0, ...rows.map((r) => r.length));
    const h = rows.length;
    const heights = new Uint8Array(w * h).fill(255);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) heights[y * w + x] = heightOf(row[x] ?? "x");
    });
    const furni = new Map<number, FurniModel>();
    const seatsByFurni = new Map<number, SnapSeat>(snap.seats.map((s) => [s.furni, s]));
    for (const f of snap.furni) {
      const def = snap.defs[f.def];
      if (def) furni.set(f.id, this.furniModel(f, def, seatsByFurni.get(f.id)));
    }
    this.defsByRoom.set(id, snap.defs);
    this.knownRooms.set(id, sanitizeText(snap.name, 24));
    const prior = this.space.rooms.get(id);
    const occupants = new Map<string, Presence>();
    const room: RoomModel = {
      id,
      name: sanitizeText(snap.name, 40),
      template: snap.template,
      w,
      h,
      rev: snap.rev,
      syncedAtWall: now,
      door: [snap.layout.door[0], snap.layout.door[1]],
      doorDir: (snap.layout.door_dir % 8) as Direction8,
      heights,
      furni,
      zones: [],
      occupants,
      adjacency: [],
      degraded: false,
    };
    for (const a of snap.avatars) {
      const p = this.presence(a, room, now, prior?.occupants.get(this.refOfAvatar(a.id)));
      occupants.set(p.ref, p);
    }
    room.zones = this.derive(room);
    this.space.rooms.set(id, room);
    for (const [ref, p] of occupants) if (this.idByRef.has(ref)) this.space.agentRoom.set(ref, id);
    this.refreshAdjacency();
  }

  /**
   * D24: an actor can travel anywhere, so every room the hotel has named is
   * reachable from every mirrored room by its door, with an estimated travel
   * time. Rooms come from `hello` (runs, actors) and from snapshots; a name
   * already learned from a snapshot is kept over a bare id.
   */
  noteKnownRooms(rooms: ReadonlyArray<{ id: RoomId; name?: string }>): void {
    for (const r of rooms) {
      const name = r.name !== undefined ? sanitizeText(r.name, 24) : undefined;
      if (name || !this.knownRooms.has(r.id)) this.knownRooms.set(r.id, name || this.knownRooms.get(r.id));
    }
    this.refreshAdjacency();
  }

  private refreshAdjacency(): void {
    for (const room of this.space.rooms.values()) {
      const travelS = Math.round(2 + (Math.max(room.w, room.h) / 2) * (WALK_TICK_MS / 1000));
      room.adjacency = [...this.knownRooms]
        .filter(([id]) => id !== room.id)
        .map(([roomId, name]) => ({
          roomId,
          viaDoor: [room.door[0], room.door[1]] as Tile,
          travelS,
          ...(name ? { name } : {}),
        }));
    }
  }

  /** Marks a room degraded (a gap or silence) until its resnapshot lands. */
  markDegraded(room: RoomId): void {
    const r = this.space.rooms.get(room);
    if (r) r.degraded = true;
  }

  degradedRooms(): RoomId[] {
    return [...this.space.rooms.values()].filter((r) => r.degraded).map((r) => r.id);
  }

  markAllDegraded(): void {
    for (const r of this.space.rooms.values()) r.degraded = true;
  }

  applyPing(ping: PingMsg, now: number): ApplyResult {
    const id = roomIdOf(ping.room);
    const room = this.space.rooms.get(id);
    if (!room) return { ok: false, reason: "unknown_room", room: id };
    if (ping.rev > room.rev) {
      room.degraded = true;
      return { ok: false, reason: "gap", room: id };
    }
    room.syncedAtWall = now;
    return { ok: true };
  }

  applyDelta(frame: DeltaMsg, now: number): ApplyResult {
    const id = roomIdOf(frame.room);
    const room = this.space.rooms.get(id);
    if (!room) return { ok: false, reason: "unknown_room", room: id };
    if (room.degraded) return { ok: false, reason: "degraded", room: id };
    if (frame.rev !== room.rev + 1) {
      room.degraded = true;
      return { ok: false, reason: "gap", room: id };
    }
    room.rev = frame.rev;
    room.syncedAtWall = now;
    this.applyMsg(room, frame.msg, now);
    // furni_added / furni_moved apply in place from the cached defs; only an unknown def degrades the room.
    return room.degraded ? { ok: true, resnapshot: true } : { ok: true };
  }

  applyWalkStarted(actorId: number, goal: Tile | undefined): void {
    const ref = this.own.get(actorId)?.ref;
    const p = ref ? this.presenceOf(ref) : undefined;
    if (p && goal) p.walkGoal = goal;
  }

  applyArrived(actorId: number, room: number, x: number, y: number, now: number): string | undefined {
    const ref = this.own.get(actorId)?.ref;
    const r = this.space.rooms.get(roomIdOf(room));
    const p = ref ? r?.occupants.get(ref) : undefined;
    if (!ref || !p) return undefined;
    const from = p.tile;
    p.tile = [x, y];
    delete p.walkGoal;
    if (p.state === "walk") p.state = this.seatAt(r, p.tile) !== undefined ? "sit" : "stand";
    p.lastMovedAt = now;
    this.listener.onMoved?.(ref, roomIdOf(room), from, p.tile, now);
    return ref;
  }

  applyMovedRoom(actorId: number, from: number, to: number, x: number, y: number, now: number): string | undefined {
    const ref = this.own.get(actorId)?.ref;
    if (!ref) return undefined;
    const src = this.space.rooms.get(roomIdOf(from));
    const dst = this.space.rooms.get(roomIdOf(to));
    const p = src?.occupants.get(ref);
    src?.occupants.delete(ref);
    this.space.agentRoom.set(ref, dst ? roomIdOf(to) : "in_transit");
    if (p && dst) {
      p.tile = [x, y];
      p.state = "stand";
      delete p.walkGoal;
      p.since = now;
      p.lastMovedAt = now;
      dst.occupants.set(ref, p);
    }
    return ref;
  }

  applyRoomClosed(room: number): void {
    const id = roomIdOf(room);
    const r = this.space.rooms.get(id);
    this.knownRooms.delete(id);
    if (r) {
      for (const ref of r.occupants.keys()) if (this.idByRef.has(ref)) this.space.agentRoom.set(ref, "in_transit");
      this.space.rooms.delete(id);
      this.defsByRoom.delete(id);
    }
    this.refreshAdjacency();
  }

  /** Rooms with nothing heard for more than STALE_MS: the caller resnapshots them. */
  staleRooms(now: number): RoomId[] {
    const out: RoomId[] = [];
    for (const r of this.space.rooms.values()) {
      if (!r.degraded && now - r.syncedAtWall > STALE_MS) {
        r.degraded = true;
        out.push(r.id);
      }
    }
    return out;
  }

  // ---- reads --------------------------------------------------------------

  view(agentId: string, now: number): SpaceView | undefined {
    const where = this.space.agentRoom.get(agentId);
    if (where === undefined) return undefined;
    const body = this.bodyOf(agentId, now);
    if (where === "in_transit") return { agentId, readAt: now, where, adjacency: [], body };
    const room = this.space.rooms.get(where);
    if (!room) return { agentId, readAt: now, where: "in_transit", adjacency: [], body };
    const occupants = [...room.occupants.values()].map((p) => this.read(p, room, now));
    const roomView: RoomView = {
      ...room,
      furni: [...room.furni.values()],
      occupants,
      stale: room.degraded || now - room.syncedAtWall > STALE_MS,
    };
    const self = occupants.find((p) => p.ref === agentId);
    return { agentId, readAt: now, where, room: roomView, ...(self ? { self } : {}), adjacency: room.adjacency, body };
  }

  /** Humans and visitors in a room, with expiry applied. */
  peopleIn(room: RoomId, now: number): Presence[] {
    const r = this.space.rooms.get(room);
    return r ? [...r.occupants.values()].map((p) => this.read(p, r, now)) : [];
  }

  // ---- internals ----------------------------------------------------------

  private presenceOf(ref: string): Presence | undefined {
    const room = this.roomOfRef(ref);
    return room ? this.space.rooms.get(room)?.occupants.get(ref) : undefined;
  }

  private seatAt(room: RoomModel | undefined, tile: Tile): number | undefined {
    if (!room) return undefined;
    for (const f of room.furni.values()) {
      if (f.kinds.includes("sit") || f.kinds.includes("lay")) if (f.tiles.some((t) => t[0] === tile[0] && t[1] === tile[1])) return f.id;
    }
    return undefined;
  }

  private furniModel(f: Furni, def: SnapDef, seat: SnapSeat | undefined): FurniModel {
    const swap = f.rot % 2 === 1;
    const w = swap ? def.d : def.w;
    const d = swap ? def.w : def.d;
    const tiles: Tile[] = [];
    for (let dx = 0; dx < Math.max(1, w); dx++) for (let dy = 0; dy < Math.max(1, d); dy++) tiles.push([f.x + dx, f.y + dy]);
    const { kinds, label } = classifyFurni(f.def, def.name, def.seat, def.lay);
    const front: Tile[] = seat ? seat.tiles.map((t) => [t[0], t[1]] as Tile) : [];
    if (front.length === 0) {
      for (const [tx, ty] of tiles) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n: Tile = [tx + dx, ty + dy];
          if (!tiles.some((t) => t[0] === n[0] && t[1] === n[1]) && !front.some((t) => t[0] === n[0] && t[1] === n[1])) front.push(n);
        }
      }
    }
    return { id: f.id, defId: f.def, label, kinds: def.walkable && kinds.length === 1 && kinds[0] === "decor" ? ["rug"] : kinds, tiles, front, state: f.state ?? 0 };
  }

  private presence(a: Avatar, room: RoomModel, now: number, prior: Presence | undefined): Presence {
    const ref = this.refOfAvatar(a.id);
    const tile: Tile = [a.x, a.y];
    const p: Presence = {
      ref,
      name: sanitizeText(a.name, 32),
      kind: this.own.has(a.id) ? "actor" : "human",
      tile,
      dir: (a.dir % 8) as Direction8,
      state: stateOf(a.state),
      since: prior?.since ?? now,
      lastMovedAt: now,
      ...(prior?.lastSpokeAt !== undefined ? { lastSpokeAt: prior.lastSpokeAt } : {}),
    };
    if (p.state === "sit" || p.state === "lay") {
      const seatId = this.seatAt(room, tile);
      if (seatId !== undefined) p.seatId = seatId;
    }
    return p;
  }

  private read(p: Presence, room: RoomModel, now: number): Presence {
    let out = p;
    if (p.state === "walk" && p.walkGoal && now - p.lastMovedAt > DEAD_RECKON_AFTER_MS) {
      const steps = Math.floor((now - p.lastMovedAt) / WALK_TICK_MS);
      let [x, y] = p.tile;
      for (let i = 0; i < steps; i++) {
        x += Math.sign(p.walkGoal[0] - x);
        y += Math.sign(p.walkGoal[1] - y);
      }
      out = { ...p, tile: [x, y] };
    }
    if (p.kind === "human") {
      const typingFresh = this.typingAt.has(p.ref) && now - (this.typingAt.get(p.ref) ?? 0) <= HUMAN_EXPIRY_MS;
      const spokeFresh = p.lastSpokeAt !== undefined && now - p.lastSpokeAt <= HUMAN_EXPIRY_MS;
      out = { ...out, typing: typingFresh && p.typing === true };
      if (!spokeFresh && out.lastSpokeAt !== undefined) {
        const { lastSpokeAt: _expired, ...rest } = out;
        out = rest;
      }
    }
    if (out.action && out.action.until <= now) {
      const { action: _done, ...rest } = out;
      out = rest;
    }
    void room;
    return out;
  }

  private applyMsg(room: RoomModel, msg: DeltaMsg["msg"], now: number): void {
    switch (msg.t) {
      case "moves":
        for (const m of msg.moves) {
          const p = room.occupants.get(this.refOfAvatar(m.id));
          if (!p) continue;
          const from = p.tile;
          p.tile = [m.x, m.y];
          p.dir = (m.dir % 8) as Direction8;
          p.state = stateOf(m.state);
          p.lastMovedAt = now;
          if (p.state === "sit" || p.state === "lay") {
            const seatId = this.seatAt(room, p.tile);
            if (seatId !== undefined) p.seatId = seatId;
          } else delete p.seatId;
          if (from[0] !== p.tile[0] || from[1] !== p.tile[1]) this.listener.onMoved?.(p.ref, room.id, from, p.tile, now);
        }
        break;
      case "avatar_joined": {
        const p = this.presence(msg.avatar, room, now, undefined);
        room.occupants.set(p.ref, p);
        if (this.idByRef.has(p.ref)) this.space.agentRoom.set(p.ref, room.id);
        break;
      }
      case "avatar_left": {
        const ref = this.refOfAvatar(msg.id);
        // An own actor that leaves via moved_room is moved by that frame; a plain leave removes it.
        room.occupants.delete(ref);
        this.typingAt.delete(ref);
        this.listener.onLeft?.(ref, room.id, now);
        break;
      }
      case "avatar_action": {
        const p = room.occupants.get(this.refOfAvatar(msg.id));
        if (!p) break;
        const a = msg.action;
        if (a === "sit" || a === "stand" || a === "lay" || a === "dance") p.state = a;
        if (a === "stop" || a === "idle" || a === "stand") delete p.action;
        else if (a !== "expression" && a !== "turn") {
          const gesture: ActiveGesture = {
            a,
            ...(msg.style !== null && msg.style !== undefined ? { style: msg.style } : {}),
            until: now + (GESTURE_MS[a] ?? 60_000),
          };
          p.action = gesture;
        }
        break;
      }
      case "chat": {
        const p = room.occupants.get(this.refOfAvatar(msg.from));
        if (p) {
          p.lastSpokeAt = now;
          p.typing = false;
        }
        break;
      }
      case "typing": {
        const ref = this.refOfAvatar(msg.id);
        const p = room.occupants.get(ref);
        if (p) {
          p.typing = msg.on;
          if (msg.on) this.typingAt.set(ref, now);
          else this.typingAt.delete(ref);
          if (p.kind === "human") this.listener.onHumanTyping?.(room.id, ref, msg.on, now);
        }
        break;
      }
      case "furni_removed":
        room.furni.delete(msg.id);
        room.zones = this.derive(room);
        break;
      case "furni_added":
      case "furni_moved": {
        // Applied in place from the room's cached defs; only a def we have never
        // seen (a catalogue piece added since the snapshot) needs a resnapshot.
        const def = this.defsByRoom.get(room.id)?.[msg.furni.def];
        if (!def) {
          room.degraded = true;
          break;
        }
        room.furni.set(msg.furni.id, this.furniModel(msg.furni, def, undefined));
        room.zones = this.derive(room);
        break;
      }
      case "furni_state_changed": {
        const f = room.furni.get(msg.id);
        if (f) f.state = msg.state;
        break;
      }
      default:
        break;
    }
  }
}

/** Human distance helper used by hearing and the planner. */
export const distance = (a: Presence, b: Presence): number => chebyshev(a.tile, b.tile);
