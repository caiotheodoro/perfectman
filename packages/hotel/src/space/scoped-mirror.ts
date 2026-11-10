import type { AgentBody, Presence, RoomId, RoomModel, SpaceModel, SpaceView } from "@perfectman/shared";
import type { ActorSpace, HotelSpaceMirror, OwnActor } from "./space-mirror.js";
import { parseScopedRef, scopeRef } from "./scoped-ref.js";

/**
 * One run's window on the shared `HotelSpaceMirror`. Every run shares the mirror (rooms are the hotel's, not a
 * run's), but a character's ref is only unique within its run: two runs of one scenario both have a `person-1`.
 * Inside the shared mirror an actor is therefore keyed by `r<run>.<ref>`; this class turns the run's plain refs
 * into those keys on the way in and back on the way out, so the run, its executor, gateway, ingestor and the
 * engine never see a scoped ref of their own, and never reach another run's actor by a plain one.
 *
 * Another run's actor in a shared room shows up under its scoped ref, which is unique, so it cannot be mistaken
 * for one of this run's cast.
 */
export class ScopedMirror implements ActorSpace {
  /** This run's refs as it registered them: a plain ref in here is always this run's, whatever it looks like. */
  private readonly mine = new Set<string>();

  /** The rooms this run's actors may walk into; null means every room the hotel names. */
  private allowedRooms: ReadonlySet<RoomId> | null = null;

  constructor(
    private readonly shared: HotelSpaceMirror,
    readonly run: number,
  ) {}

  /** Limits the doors a view offers to these rooms (the scenario's stage step). Pass null to lift the limit. */
  restrictTravel(rooms: Iterable<RoomId> | null): void {
    this.allowedRooms = rooms === null ? null : new Set(rooms);
  }

  /** The shared mirror's key for a ref as this run writes it. */
  key(ref: string): string {
    if (ref.startsWith("h:")) return ref;
    if (this.mine.has(ref)) return scopeRef(this.run, ref);
    const other = parseScopedRef(ref);
    // Another run's actor, named the way `view()` names it, is already a key.
    if (other && other.run !== this.run) return ref;
    return scopeRef(this.run, ref);
  }

  /** A shared key as this run reads it: its own refs plain, everyone else's as they are. */
  local(key: string): string {
    const p = parseScopedRef(key);
    return p && p.run === this.run ? p.ref : key;
  }

  /** Who is on the floor right now (the drama planner side's ledger); the views mark them so perception can tell a body from a person. */
  private fallenOf: ((ref: string) => Presence["fallen"]) | undefined;

  setFallen(source: ((ref: string) => Presence["fallen"]) | undefined): void {
    this.fallenOf = source;
  }

  /** Whether drama is negotiated and on for this run; while it is, every view says so and the prompt teaches the `act` key. Never set otherwise. */
  private dramaOn: (() => boolean) | undefined;

  setDrama(source: (() => boolean) | undefined): void {
    this.dramaOn = source;
  }

  /**
   * The style lines of an authored beat that is near for this agent at this run-clock time (the slim KB's runtime feed, `BeatCraft`). Set only
   * when a slim KB is configured and a beat has lines; while it is, the view of a person with a beat near carries `craft` and the prompt
   * shows it with the scene craft. Never set otherwise.
   */
  private craftOf: ((agentId: string, now: number) => string | undefined) | undefined;

  setCraft(source: ((agentId: string, now: number) => string | undefined) | undefined): void {
    this.craftOf = source;
  }

  private localPresence(p: Presence): Presence {
    const ref = this.local(p.ref);
    const fallen = this.fallenOf?.(ref);
    if (ref === p.ref && !fallen) return p;
    return { ...p, ref, ...(fallen ? { fallen } : {}) };
  }

  // ---- SpaceMirror (what the engine reads) -------------------------------------

  /**
   * A copy of the model with this run's refs plain. Built on every call: fine for the callers (audibility of one
   * line, the frame log's snapshot each pulse, tests), not for a hot loop; those use the targeted reads below.
   */
  model(): SpaceModel {
    const m = this.shared.model();
    const rooms = new Map<RoomId, RoomModel>();
    for (const [id, room] of m.rooms) {
      const occupants = new Map<string, Presence>();
      for (const p of room.occupants.values()) {
        const mine = this.localPresence(p);
        occupants.set(mine.ref, mine);
      }
      rooms.set(id, { ...room, occupants });
    }
    const agentRoom = new Map<string, RoomId | "in_transit">();
    for (const [ref, room] of m.agentRoom) agentRoom.set(this.local(ref), room);
    const body = new Map<string, AgentBody>();
    for (const [ref, b] of m.body) body.set(this.local(ref), b);
    return { rooms, agentRoom, body };
  }

  view(agentId: string, now: number): SpaceView | undefined {
    const v = this.shared.view(this.key(agentId), now);
    if (!v) return undefined;
    const out: SpaceView = { ...v, agentId: this.local(v.agentId) };
    const allowed = this.allowedRooms;
    if (allowed) out.adjacency = v.adjacency.filter((a) => allowed.has(a.roomId));
    if (v.room) out.room = { ...v.room, occupants: v.room.occupants.map((p) => this.localPresence(p)) };
    if (v.self) out.self = this.localPresence(v.self);
    if (this.dramaOn?.()) out.drama = true;
    const craft = this.craftOf?.(agentId, now);
    if (craft !== undefined) out.craft = craft;
    return out;
  }

  // ---- ActorSpace ---------------------------------------------------------------

  registerActor(actor: OwnActor, room: RoomId, now: number): void {
    this.mine.add(actor.ref);
    this.shared.registerActor({ ...actor, ref: scopeRef(this.run, actor.ref) }, room, now);
  }

  unregisterActor(ref: string): void {
    this.shared.unregisterActor(this.key(ref));
    this.mine.delete(ref);
  }

  avatarId(ref: string): number | undefined {
    return this.shared.avatarId(this.key(ref));
  }

  refOfAvatar(id: number): string {
    return this.local(this.shared.refOfAvatar(id));
  }

  isOwn(id: number): boolean {
    return this.shared.isOwn(id);
  }

  roomOfRef(ref: string): RoomId | undefined {
    return this.shared.roomOfRef(this.key(ref));
  }

  bodyOf(ref: string, now: number): AgentBody {
    return this.shared.bodyOf(this.key(ref), now);
  }

  peopleIn(room: RoomId, now: number): Presence[] {
    return this.shared.peopleIn(room, now).map((p) => this.localPresence(p));
  }

  presenceOf(ref: string): Presence | undefined {
    const p = this.shared.presenceOf(this.key(ref));
    return p ? this.localPresence(p) : undefined;
  }

  presenceIn(room: RoomId, ref: string): Presence | undefined {
    const p = this.shared.presenceIn(room, this.key(ref));
    return p ? this.localPresence(p) : undefined;
  }

  roomHealth(room: RoomId): { degraded: boolean; syncedAtWall: number } | undefined {
    return this.shared.roomHealth(room);
  }

  roomName(room: RoomId): string | undefined {
    return this.shared.roomName(room);
  }

  applyArrived(actorId: number, room: number, x: number, y: number, now: number): string | undefined {
    const key = this.shared.applyArrived(actorId, room, x, y, now);
    return key === undefined ? undefined : this.local(key);
  }

  applyMovedRoom(actorId: number, from: number, to: number, x: number, y: number, now: number): string | undefined {
    const key = this.shared.applyMovedRoom(actorId, from, to, x, y, now);
    return key === undefined ? undefined : this.local(key);
  }
}
