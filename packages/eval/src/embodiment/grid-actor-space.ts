import { defaultAgentBody } from "@perfectman/engine";
import type { ActorSpace, OwnActor } from "@perfectman/hotel/drama";
import type { AgentBody, Presence, RoomId, SpaceModel, SpaceView } from "@perfectman/shared";
import type { FakeGridHotel } from "./fake-grid-hotel.js";

/**
 * The hotel package's `ActorSpace` (what the drama planner side and the director read of the room) over the fake grid: refs are the
 * actors' agent ids, wire ids are negative for the run's actors (`-(run * 100 + slot)`, slot 0 being the narrator) and positive for
 * humans. It does what the hotel's `ScopedMirror` does for the drama layer: views carry `drama` while drama is on, and an avatar on the
 * floor is marked `fallen` so perception can tell a body from a person (act-contract.md DEATH-2, NEG-2).
 */
export class GridActorSpace implements ActorSpace {
  private readonly idByRef = new Map<string, number>();
  private readonly refById = new Map<number, string>();
  private readonly fallen = new Map<string, "dead" | "fainted" | "down">();
  private dramaOn = false;

  constructor(
    private readonly grid: FakeGridHotel,
    readonly run: number,
  ) {}

  /** Names an actor or a human: the wire id the hotel would have given it. */
  assign(ref: string, id: number): void {
    this.idByRef.set(ref, id);
    this.refById.set(id, ref);
  }

  setDrama(on: boolean): void {
    this.dramaOn = on;
  }

  markFallen(ref: string, kind: "dead" | "fainted" | "down" | undefined): void {
    if (kind) this.fallen.set(ref, kind);
    else this.fallen.delete(ref);
  }

  fallenKind(ref: string): "dead" | "fainted" | "down" | undefined {
    return this.fallen.get(ref);
  }

  private mark(p: Presence): Presence {
    const kind = this.fallen.get(p.ref);
    return kind ? { ...p, fallen: kind } : p;
  }

  // ---- SpaceMirror ----------------------------------------------------------------------------------------

  model(): SpaceModel {
    return this.grid.model();
  }

  view(agentId: string, now: number): SpaceView | undefined {
    const v = this.grid.view(agentId, now);
    if (!v) return undefined;
    const out: SpaceView = { ...v };
    if (v.room) out.room = { ...v.room, occupants: v.room.occupants.map((p) => this.mark(p)) };
    if (v.self) out.self = this.mark(v.self);
    if (this.dramaOn) out.drama = true;
    return out;
  }

  // ---- ActorSpace -------------------------------------------------------------------------------------------

  registerActor(actor: OwnActor): void {
    this.assign(actor.ref, actor.id);
  }

  unregisterActor(ref: string): void {
    const id = this.idByRef.get(ref);
    this.idByRef.delete(ref);
    if (id !== undefined) this.refById.delete(id);
  }

  avatarId(ref: string): number | undefined {
    return this.idByRef.get(ref);
  }

  refOfAvatar(id: number): string {
    return this.refById.get(id) ?? String(id);
  }

  isOwn(id: number): boolean {
    return id < 0;
  }

  roomOfRef(ref: string): RoomId | undefined {
    const room = this.grid.model().agentRoom.get(ref);
    if (room !== undefined && room !== "in_transit") return room;
    for (const r of this.grid.model().rooms.values()) if (r.occupants.has(ref)) return r.id;
    return undefined;
  }

  bodyOf(ref: string): AgentBody {
    return this.grid.model().body.get(ref) ?? defaultAgentBody();
  }

  peopleIn(room: RoomId): Presence[] {
    const r = this.grid.model().rooms.get(room);
    return r ? [...r.occupants.values()].map((p) => this.mark(p)) : [];
  }

  presenceOf(ref: string): Presence | undefined {
    const room = this.roomOfRef(ref);
    return room === undefined ? undefined : this.presenceIn(room, ref);
  }

  presenceIn(room: RoomId, ref: string): Presence | undefined {
    const p = this.grid.model().rooms.get(room)?.occupants.get(ref);
    return p ? this.mark(p) : undefined;
  }

  roomHealth(): { degraded: boolean; syncedAtWall: number } {
    return { degraded: false, syncedAtWall: this.grid.now() };
  }

  roomName(room: RoomId): string | undefined {
    return this.grid.roomLayout(room)?.name;
  }

  applyArrived(): string | undefined {
    return undefined;
  }

  applyMovedRoom(): string | undefined {
    return undefined;
  }
}
