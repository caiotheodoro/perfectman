import type { CoreMood, Presence, RelationalState, RoomView, Tile } from "@perfectman/shared";
import { chebyshev, tileKey } from "../../space/geometry.js";
import { blockedTiles, isFree, occupiedTiles } from "../tiles.js";
import { HT, clamp, mix } from "./tuning.js";

export type RelClass = "intimate" | "warm" | "neutral" | "cool" | "faceoff" | "fear";

export type ProxWindow = { cls: RelClass; min: number; ideal: number; max: number };

/**
 * How two people stand by what they feel (Hall's bands, stylized): closer for affection and for a threat to be made, farther for fear and for cold.
 * `heated`: the exchange is a row (both aroused, hostile words); `hit`: this actor was just shoved or struck by the other.
 */
export function relationClass(rel: RelationalState | undefined, mood: CoreMood, o: { heated: boolean; hit: boolean }): RelClass {
  if (o.hit) return "fear";
  const threat = rel?.threat ?? 0;
  if (threat > 0.5) return "fear";
  const resentment = rel?.resentment ?? 0;
  if (o.heated && (resentment >= 0.3 || mood.valence < -0.2)) return "faceoff";
  if ((rel?.desireForDistance ?? 0) > 0.6 || (rel?.trust ?? 0) < -0.3 || resentment >= 0.45) return "cool";
  const attraction = rel?.attraction ?? 0;
  const comfort = rel?.comfort ?? 0;
  const affection = rel?.affection ?? 0;
  if ((attraction >= 0.55 && comfort >= 0.45) || affection >= 0.7) return "intimate";
  if (affection >= 0.35 || comfort >= 0.55) return "warm";
  return "neutral";
}

/**
 * The window (tiles) a conversation of this class lives in at dial `h`: the "as it was" window [1, 2, 6] at 0, the class's own at 1, and never wider than earshot
 * at any h above 0. The ideal is where a person who is out of the window goes to.
 */
export function windowFor(cls: RelClass, h: number): ProxWindow {
  const [lo, ideal, hi] = HT.prox[cls];
  const min = Math.round(mix(HT.prox.oldMin, lo, h));
  const max = Math.round(mix(HT.prox.oldMax, Math.min(hi, HT.prox.earshotMax), h));
  const want = Math.round(mix(HT.prox.oldIdeal, ideal, h));
  return { cls, min, max: Math.max(min, max), ideal: clamp(want, min, Math.max(min, max)) };
}

/** True when another avatar stands on `self`'s tile (a stack). The one that sorts later by ref steps off, so exactly one of two moves. */
export function mustUnstack(self: Presence, room: RoomView): boolean {
  return room.occupants.some((p) => p.ref !== self.ref && p.tile[0] === self.tile[0] && p.tile[1] === self.tile[1] && self.ref > p.ref);
}

/** The nearest free tile to step to, by distance from `self`, with a stable tie-break. Radius 3. */
export function nearestFree(room: RoomView, self: Presence, avoid: ReadonlySet<string> = new Set()): Tile | undefined {
  const blocked = blockedTiles(room);
  const occupied = occupiedTiles(room, self.ref);
  for (const k of avoid) occupied.add(k);
  let best: { t: Tile; d: number } | undefined;
  for (let r = 1; r <= 3 && !best; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const t: Tile = [self.tile[0] + dx, self.tile[1] + dy];
        if (!isFree(room, blocked, t, occupied)) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (!best || d < best.d || (d === best.d && (t[0] < best.t[0] || (t[0] === best.t[0] && t[1] < best.t[1])))) best = { t, d };
      }
    }
  }
  return best?.t;
}

const angleOf = (c: readonly [number, number], t: Tile): number => Math.atan2(t[1] - c[1], t[0] - c[0]);
const angularGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(d, 2 * Math.PI - d);
};

/** How well `t` sits in a conversational group around centroid `c` of `others`: lower is better. A ring at radius R, people at least `minSpacing` apart, and spread round the ring, not strung along a line. */
export function groupScore(t: Tile, c: readonly [number, number], others: readonly Tile[]): number {
  const R = HT.prox.groupRingRadius;
  const ring = Math.abs(Math.hypot(t[0] - c[0], t[1] - c[1]) - R);
  let near = 0;
  let minGap = Math.PI;
  const a = angleOf(c, t);
  for (const o of others) {
    const d = chebyshev(o, t);
    if (d < HT.prox.groupMinSpacing) near += (HT.prox.groupMinSpacing - d) * 3;
    minGap = Math.min(minGap, angularGap(a, angleOf(c, o)));
  }
  // The gap to the nearest neighbour on the ring: a person placed in line with another (gap near 0) is penalized, one placed opposite is favoured.
  return ring + near + (1 - minGap / Math.PI) * 2;
}

/**
 * Where `self` should stand to make the group a circle, or undefined when it already does. `others` are the other members' tiles (at least `groupMinSize - 1`).
 * Hysteresis: only moves when the new tile beats the current one by more than 1.0 and is a short walk.
 */
export function groupSpot(self: Presence, room: RoomView, others: readonly Tile[], reserved: ReadonlySet<string>): Tile | undefined {
  if (others.length < HT.prox.groupMinSize - 1) return undefined;
  const c: [number, number] = [others.reduce((s, t) => s + t[0], 0) / others.length, others.reduce((s, t) => s + t[1], 0) / others.length];
  const blocked = blockedTiles(room);
  const occupied = occupiedTiles(room, self.ref);
  for (const k of reserved) occupied.add(k);
  const cur = groupScore(self.tile, c, others);
  let best: { t: Tile; s: number } | undefined;
  const R = HT.prox.groupRingRadius + 2;
  for (let dx = -R; dx <= R; dx++) {
    for (let dy = -R; dy <= R; dy++) {
      const t: Tile = [Math.round(c[0]) + dx, Math.round(c[1]) + dy];
      if (!isFree(room, blocked, t, occupied) || chebyshev(t, self.tile) > 4) continue;
      const s = groupScore(t, c, others) + chebyshev(t, self.tile) * 0.15;
      if (!best || s < best.s || (s === best.s && tileKey(t) < tileKey(best.t))) best = { t, s };
    }
  }
  return best && best.s < cur - 1 ? best.t : undefined;
}
