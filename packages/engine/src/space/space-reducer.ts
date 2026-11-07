import type {
  ActorRef,
  AgentBody,
  AvatarState,
  Direction8,
  FurniModel,
  Presence,
  RoomAdjacency,
  RoomId,
  RoomModel,
  SpaceModel,
  Tile,
  Zone,
} from "@perfectman/shared";
import { deriveZones, resolveAuthoredPlace, type AuthoredPlace } from "./derive-zones.js";

/**
 * Pure reducer for the physical-space model (ADR-0018, embodiment.md 3).
 *
 * `applySpaceAction(model, action)` is a deterministic function of the model
 * and the action. It mutates `model` in place (maps stay maps, no copies per
 * frame) and never reads a clock: every timestamp is carried by the action
 * (`at`, wall-clock ms). Replays feed the recorded actions through it.
 *
 * Actions are JSON-safe: a sidecar turns Director frames into them, the fake
 * grid hotel emits them directly.
 */

/** A full room as the Director snapshot delivers it. `heights` is one byte per tile, 255 = void. */
export type RoomSnapshot = {
  id: RoomId;
  name: string;
  template: string;
  w: number;
  h: number;
  door: Tile;
  doorDir: Direction8;
  heights: number[];
  furni: FurniModel[];
  occupants: Presence[];
  adjacency?: RoomAdjacency[];
  authoredPlaces?: AuthoredPlace[];
};

/** One mirrored message of a room. Each carries exactly one `rev` step. */
export type SpaceChange =
  | { kind: "occupant_joined"; presence: Presence }
  | { kind: "occupant_left"; ref: ActorRef }
  | {
      kind: "occupant_moved";
      ref: ActorRef;
      tile: Tile;
      dir?: Direction8;
      state?: AvatarState;
      /** null clears the goal. */
      walkGoal?: Tile | null;
    }
  | { kind: "occupant_turned"; ref: ActorRef; dir: Direction8 }
  | { kind: "occupant_state"; ref: ActorRef; state: AvatarState; seatId?: number | null; dir?: Direction8 }
  | { kind: "occupant_gesture"; ref: ActorRef; a: string; style?: number; until: number }
  | { kind: "occupant_typing"; ref: ActorRef; typing: boolean }
  | { kind: "occupant_spoke"; ref: ActorRef }
  | { kind: "furni_added"; furni: FurniModel }
  | { kind: "furni_moved"; id: number; tiles: Tile[]; front?: Tile[] }
  | { kind: "furni_removed"; id: number }
  | { kind: "furni_state"; id: number; state: number }
  | { kind: "adjacency"; adjacency: RoomAdjacency[] };

export type SpaceAction =
  /** Replaces the room. Clears `degraded`; sets `rev` and `syncedAtWall`. */
  | { type: "room_snapshot"; at: number; rev: number; room: RoomSnapshot }
  /** Applies when `rev === room.rev + 1`; a gap marks the room degraded and asks for a resnapshot. */
  | { type: "room_delta"; at: number; roomId: RoomId; rev: number; change: SpaceChange }
  /** Keepalive: refreshes `syncedAtWall`; a `rev` ahead of ours is a gap too. */
  | { type: "room_ping"; at: number; roomId: RoomId; rev: number }
  /** `moved_room` / transit bookkeeping for one actor ("in_transit" between rooms). */
  | { type: "agent_room"; agentId: string; room: RoomId | "in_transit" }
  /** Executor-owned body state (plan, pending speech, blocked reasons, dwell, budget). */
  | { type: "agent_body"; agentId: string; patch: Partial<AgentBody> }
  /** Scenario `places:`; resolved against the room now and kept across furniture deltas. */
  | { type: "authored_places"; roomId: RoomId; places: AuthoredPlace[] };

export type SpaceApplyResult = {
  applied: boolean;
  /** The room that needs a fresh snapshot (gap or unknown room). */
  resnapshot?: RoomId;
  reason?: "gap" | "unknown_room" | "duplicate";
};

export function defaultAgentBody(): AgentBody {
  return { dwell: { postureSince: 0, placeSince: 0, lastGestureAt: {} }, budget: { cmdTimes: [] } };
}

export function createSpaceModel(): SpaceModel {
  return { rooms: new Map(), agentRoom: new Map(), body: new Map() };
}

function toRoomModel(snap: RoomSnapshot, at: number, rev: number): RoomModel {
  const room: RoomModel = {
    id: snap.id,
    name: snap.name,
    template: snap.template,
    w: snap.w,
    h: snap.h,
    rev,
    syncedAtWall: at,
    door: snap.door,
    doorDir: snap.doorDir,
    heights: Uint8Array.from(snap.heights),
    furni: new Map(snap.furni.map((f) => [f.id, f])),
    zones: [],
    occupants: new Map(snap.occupants.map((p) => [p.ref, { ...p }])),
    adjacency: snap.adjacency ?? [],
    degraded: false,
  };
  room.zones = deriveZones(room, snap.authoredPlaces ?? []);
  return room;
}

function rezone(room: RoomModel): void {
  const authored = room.zones.filter((z) => z.source === "authored");
  room.zones = [...deriveZones(room), ...authored] as Zone[];
}

function setDegraded(room: RoomModel): SpaceApplyResult {
  room.degraded = true;
  return { applied: false, resnapshot: room.id, reason: "gap" };
}

function registered(model: SpaceModel, ref: string): boolean {
  return model.agentRoom.has(ref) || model.body.has(ref);
}

function applyChange(model: SpaceModel, room: RoomModel, change: SpaceChange, at: number): void {
  switch (change.kind) {
    case "occupant_joined": {
      room.occupants.set(change.presence.ref, { ...change.presence });
      if (registered(model, change.presence.ref)) model.agentRoom.set(change.presence.ref, room.id);
      break;
    }
    case "occupant_left": {
      room.occupants.delete(change.ref);
      if (model.agentRoom.get(change.ref) === room.id) model.agentRoom.set(change.ref, "in_transit");
      break;
    }
    case "occupant_moved": {
      const p = room.occupants.get(change.ref);
      if (!p) break;
      p.tile = change.tile;
      p.lastMovedAt = at;
      if (change.dir !== undefined) p.dir = change.dir;
      if (change.state !== undefined) p.state = change.state;
      if (change.walkGoal === null) delete p.walkGoal;
      else if (change.walkGoal !== undefined) p.walkGoal = change.walkGoal;
      if (p.state !== "sit" && p.state !== "lay") delete p.seatId;
      break;
    }
    case "occupant_turned": {
      const p = room.occupants.get(change.ref);
      if (p) p.dir = change.dir;
      break;
    }
    case "occupant_state": {
      const p = room.occupants.get(change.ref);
      if (!p) break;
      const wasDancing = p.state === "dance";
      if (p.state !== change.state) p.since = at;
      p.state = change.state;
      if (change.dir !== undefined) p.dir = change.dir;
      if (change.seatId === null || (change.seatId === undefined && change.state !== "sit" && change.state !== "lay")) delete p.seatId;
      else if (change.seatId !== undefined) p.seatId = change.seatId;
      if (wasDancing || change.state === "dance") rezone(room);
      break;
    }
    case "occupant_gesture": {
      const p = room.occupants.get(change.ref);
      if (p) p.action = { a: change.a, ...(change.style !== undefined ? { style: change.style } : {}), until: change.until };
      break;
    }
    case "occupant_typing": {
      const p = room.occupants.get(change.ref);
      if (p) p.typing = change.typing;
      break;
    }
    case "occupant_spoke": {
      const p = room.occupants.get(change.ref);
      if (p) p.lastSpokeAt = at;
      break;
    }
    case "furni_added":
      room.furni.set(change.furni.id, change.furni);
      rezone(room);
      break;
    case "furni_moved": {
      const f = room.furni.get(change.id);
      if (f) {
        room.furni.set(f.id, { ...f, tiles: change.tiles, front: change.front ?? f.front });
        rezone(room);
      }
      break;
    }
    case "furni_removed":
      if (room.furni.delete(change.id)) rezone(room);
      break;
    case "furni_state": {
      const f = room.furni.get(change.id);
      if (f) room.furni.set(f.id, { ...f, state: change.state });
      break;
    }
    case "adjacency":
      room.adjacency = change.adjacency;
      break;
  }
}

export function applySpaceAction(model: SpaceModel, action: SpaceAction): SpaceApplyResult {
  switch (action.type) {
    case "room_snapshot": {
      const room = toRoomModel(action.room, action.at, action.rev);
      model.rooms.set(room.id, room);
      for (const ref of room.occupants.keys()) {
        if (registered(model, ref)) model.agentRoom.set(ref, room.id);
      }
      return { applied: true };
    }
    case "room_delta": {
      const room = model.rooms.get(action.roomId);
      if (!room) return { applied: false, resnapshot: action.roomId, reason: "unknown_room" };
      if (action.rev <= room.rev) return { applied: false, reason: "duplicate" };
      if (action.rev !== room.rev + 1) return setDegraded(room);
      applyChange(model, room, action.change, action.at);
      room.rev = action.rev;
      room.syncedAtWall = action.at;
      return { applied: true };
    }
    case "room_ping": {
      const room = model.rooms.get(action.roomId);
      if (!room) return { applied: false, resnapshot: action.roomId, reason: "unknown_room" };
      if (action.rev > room.rev) return setDegraded(room);
      room.syncedAtWall = action.at;
      return { applied: true };
    }
    case "agent_room": {
      model.agentRoom.set(action.agentId, action.room);
      if (!model.body.has(action.agentId)) model.body.set(action.agentId, defaultAgentBody());
      return { applied: true };
    }
    case "agent_body": {
      const body = model.body.get(action.agentId) ?? defaultAgentBody();
      model.body.set(action.agentId, { ...body, ...action.patch });
      return { applied: true };
    }
    case "authored_places": {
      const room = model.rooms.get(action.roomId);
      if (!room) return { applied: false, resnapshot: action.roomId, reason: "unknown_room" };
      const kept = room.zones.filter((z) => z.source !== "authored");
      const resolved: Zone[] = [];
      for (const place of action.places) {
        const z = resolveAuthoredPlace(room, place);
        if (z) resolved.push({ id: `authored-${z.label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}`, ...z });
      }
      room.zones = [...kept, ...resolved];
      return { applied: true };
    }
  }
}
