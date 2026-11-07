import type { Presence, RoomView, Tile } from "@perfectman/shared";
import { chebyshev, neighbours8, tileKey } from "../space/geometry.js";

/** Tiles an avatar cannot stand on: void, or under a non-walkable, non-seat piece. */
export function blockedTiles(room: RoomView): Set<string> {
  const blocked = new Set<string>();
  for (const f of room.furni) {
    const walkable = f.kinds.includes("rug") || f.kinds.includes("sit") || f.kinds.includes("lay");
    if (!walkable) for (const t of f.tiles) blocked.add(tileKey(t));
  }
  return blocked;
}

export function isFloor(room: RoomView, t: Tile): boolean {
  if (t[0] < 0 || t[1] < 0 || t[0] >= room.w || t[1] >= room.h) return false;
  return room.heights[t[1] * room.w + t[0]] !== 255;
}

export function isFree(room: RoomView, blocked: ReadonlySet<string>, t: Tile, occupied: ReadonlySet<string>): boolean {
  return isFloor(room, t) && !blocked.has(tileKey(t)) && !occupied.has(tileKey(t));
}

export function occupiedTiles(room: RoomView, except?: string): Set<string> {
  return new Set(room.occupants.filter((p) => p.ref !== except).map((p) => tileKey(p.tile)));
}

/** The three most crowded tiles (by people within 1), for the anti-cluster penalty. */
function crowdCentres(people: readonly Presence[]): Tile[] {
  const score = new Map<string, { t: Tile; n: number }>();
  for (const p of people) {
    for (const t of [p.tile, ...neighbours8(p.tile)]) {
      const k = tileKey(t);
      const cur = score.get(k) ?? { t, n: 0 };
      cur.n += 1;
      score.set(k, cur);
    }
  }
  return [...score.values()]
    .filter((s) => s.n >= 3)
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((s) => s.t);
}

export type PickOptions = {
  room: RoomView;
  self: string;
  /** Where we would like to be. */
  near: Tile;
  /** Search radius around `near`. */
  radius: number;
  /** Prefer tiles this far from `awayFrom` (a person to keep distance from, or to stand beside). */
  awayFrom?: { tile: Tile; ideal: number };
  rng: () => number;
  /** Tiles already promised to someone else this round (entry placement). */
  avoid?: ReadonlySet<string>;
};

/**
 * A free tile near `near`, penalizing the crowded spots (anti-cluster: tiles
 * within 2 of the 3 most crowded tiles) and, when asked, deviation from an
 * ideal distance to a person. Deterministic for a given rng.
 */
export function pickTile(o: PickOptions): Tile | undefined {
  const blocked = blockedTiles(o.room);
  const occupied = occupiedTiles(o.room, o.self);
  for (const k of o.avoid ?? []) occupied.add(k);
  const crowd = crowdCentres(o.room.occupants);
  let best: { t: Tile; cost: number } | undefined;
  for (let dx = -o.radius; dx <= o.radius; dx++) {
    for (let dy = -o.radius; dy <= o.radius; dy++) {
      const t: Tile = [o.near[0] + dx, o.near[1] + dy];
      if (!isFree(o.room, blocked, t, occupied)) continue;
      let cost = chebyshev(t, o.near) + o.rng() * 0.5;
      if (crowd.some((c) => chebyshev(c, t) <= 2)) cost += 3;
      if (o.awayFrom) cost += Math.abs(chebyshev(t, o.awayFrom.tile) - o.awayFrom.ideal) * 2;
      if (!best || cost < best.cost) best = { t, cost };
    }
  }
  return best?.t;
}
