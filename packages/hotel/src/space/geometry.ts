import type { Direction8, Tile } from "@perfectman/shared";

/** Chebyshev distance, the metric of the distance bands (embodiment.md 2). */
export function chebyshev(a: Tile, b: Tile): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
}

export const tileKey = (t: Tile): string => `${t[0]},${t[1]}`;

/** Tilehouse `direction()`: 0 is toward -y, increasing clockwise. */
export function sectorTo(from: Tile, to: Tile): Direction8 {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx === 0 && dy === 0) return 0;
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((((Math.round(deg / 45) % 8) + 8) % 8) as Direction8);
}

/** Smallest angular difference between two directions, in degrees (0..180). */
export function dirDiffDeg(a: number, b: number): number {
  const d = (((a - b) % 8) + 8) % 8;
  return Math.min(d, 8 - d) * 45;
}

/** Sector difference 0 or +-1 is facing, +-2 side-on, else back turned (embodiment.md 4). */
export function facingKind(selfDir: number, from: Tile, to: Tile): "facing" | "side_on" | "back_turned" {
  const rel = dirDiffDeg(sectorTo(from, to), selfDir) / 45;
  return rel <= 1 ? "facing" : rel === 2 ? "side_on" : "back_turned";
}

const AROUND: ReadonlyArray<Tile> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
];

export function neighbours8(t: Tile): Tile[] {
  return AROUND.map(([dx, dy]) => [t[0] + dx, t[1] + dy] as const);
}

/** Route length in tiles on an open grid: 8 directions, one tick each. */
export function routeTiles(from: Tile, to: Tile): number {
  return chebyshev(from, to);
}
