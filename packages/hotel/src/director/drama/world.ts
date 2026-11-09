import type { AvatarState } from "@perfectman/shared";
import type { ActorSpace } from "../../space/space-mirror.js";

/** What the director reads of the room it acts in: who is where, and which avatars are the run's own actors. */
export type WorldAvatar = { id: number; human: boolean; tile: readonly [number, number]; state: AvatarState };

export interface DramaWorld {
  /** The wire id of one of the run's actors, by its `person-N` ref. */
  idOf(ref: string): number | undefined;
  /** The `person-N` ref of one of the run's own actors; undefined for a human or anyone else's actor. */
  refOf(id: number): string | undefined;
  /** The room an own actor stands in. */
  roomOf(id: number): number | undefined;
  /** Everyone in a room, actors and humans, as the mirror holds them. */
  avatarsIn(room: number): WorldAvatar[];
  /** The run's cast, for the contagion cap (LAD-10). */
  castSize(): number;
}

/** The mirror's window on one run as a `DramaWorld`. `refs` are the run's actors. */
export function mirrorWorld(space: ActorSpace, refs: () => readonly string[], now: () => number): DramaWorld {
  const own = new Set<string>();
  const known = (): ReadonlySet<string> => {
    own.clear();
    for (const r of refs()) own.add(r);
    return own;
  };
  return {
    idOf: (ref) => space.avatarId(ref),
    refOf(id) {
      const ref = space.refOfAvatar(id);
      return known().has(ref) ? ref : undefined;
    },
    roomOf(id) {
      const ref = space.refOfAvatar(id);
      const room = space.roomOfRef(ref);
      return room === undefined ? undefined : Number(room);
    },
    avatarsIn(room) {
      const out: WorldAvatar[] = [];
      for (const p of space.peopleIn(String(room), now())) {
        const id = space.avatarId(p.ref);
        if (id === undefined) continue;
        out.push({ id, human: p.kind === "human", tile: p.tile, state: p.state });
      }
      return out;
    },
    castSize: () => refs().length,
  };
}
