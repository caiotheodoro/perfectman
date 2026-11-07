import type { DistanceBand, FacingKind } from "@perfectman/shared";
import type { Direction8, Tile } from "@perfectman/shared";
import { INTIMATE_MAX_TILES, PERSONAL_MAX_TILES, PUBLIC_MAX_TILES, SOCIAL_MAX_TILES } from "./constants.js";

/** Chebyshev distance in tiles (8-neighbour steps). */
export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

/** Band of a same-room distance. Another room is always `out_of_sight`; the caller decides that. */
export function distanceBand(tiles: number): DistanceBand {
  if (tiles <= INTIMATE_MAX_TILES) return "intimate";
  if (tiles <= PERSONAL_MAX_TILES) return "personal";
  if (tiles <= SOCIAL_MAX_TILES) return "social";
  if (tiles <= PUBLIC_MAX_TILES) return "public";
  return "out_of_sight";
}

/** Largest distance (tiles) a band reaches; used to pick approach goals. */
export function bandRadius(band: "intimate" | "personal" | "social"): number {
  return band === "intimate" ? INTIMATE_MAX_TILES : band === "personal" ? PERSONAL_MAX_TILES : 3;
}

/**
 * Sector of the direction from A to B: `round(atan2(dx, -dy) / 45deg) mod 8`.
 * 0 is toward -y, increasing clockwise (Tilehouse `direction()`).
 */
export function sectorBetween(from: Tile, to: Tile): Direction8 {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 && dy === 0) return 0;
  const sector = Math.round(Math.atan2(dx, -dy) / (Math.PI / 4));
  return (((sector % 8) + 8) % 8) as Direction8;
}

/** How a person standing at `from` with heading `dir` is oriented toward `to`. */
export function facingKind(dir: Direction8, from: Tile, to: Tile): FacingKind {
  const rel = (sectorBetween(from, to) - dir + 8) % 8;
  if (rel === 0 || rel === 1 || rel === 7) return "facing";
  if (rel === 2 || rel === 6) return "side_on";
  return "back_turned";
}

/** Unit step (dx, dy) of a Direction8. */
export function directionStep(dir: Direction8): readonly [number, number] {
  switch (dir) {
    case 0: return [0, -1];
    case 1: return [1, -1];
    case 2: return [1, 0];
    case 3: return [1, 1];
    case 4: return [0, 1];
    case 5: return [-1, 1];
    case 6: return [-1, 0];
    default: return [-1, -1];
  }
}

export function sameTile(a: Tile, b: Tile): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
