import type { FurniModel, RoomModel, Tile } from "@perfectman/shared";

/** The slice of a room the pathfinder reads. */
export type PathRoom = Pick<RoomModel, "w" | "h" | "heights"> & {
  /** The model keeps a map, a per-agent `RoomView` an array. */
  furni: ReadonlyMap<number, FurniModel> | readonly FurniModel[];
};

export function furniList(room: Pick<PathRoom, "furni">): FurniModel[] {
  return Array.isArray(room.furni) ? [...(room.furni as readonly FurniModel[])] : [...(room.furni as ReadonlyMap<number, FurniModel>).values()];
}

const VOID = 255;

/** Kinds that block walking through the tile (the tile can still be a goal only for seats and beds). */
const HARD_KINDS = new Set(["table", "bar", "screen", "plant", "game", "decor"]);
const SOFT_KINDS = new Set(["sit", "lay", "bed"]);

type Block = "hard" | "soft" | "none";

function furniBlock(f: FurniModel): Block {
  if (f.kinds.includes("rug")) return "none";
  if (f.kinds.some((k) => SOFT_KINDS.has(k))) return "soft";
  if (f.kinds.some((k) => HARD_KINDS.has(k))) return "hard";
  return "none";
}

export function tileKey(t: Tile): string {
  return `${t[0]},${t[1]}`;
}

export function inBounds(room: Pick<RoomModel, "w" | "h">, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < room.w && y < room.h;
}

/** A floor tile exists here (in bounds, not void). */
export function isFloor(room: Pick<RoomModel, "w" | "h" | "heights">, x: number, y: number): boolean {
  return inBounds(room, x, y) && room.heights[y * room.w + x] !== VOID;
}

/** Per-tile furniture blocking, computed once per query. */
export function blockMap(room: PathRoom): Map<string, Block> {
  const map = new Map<string, Block>();
  for (const f of furniList(room)) {
    const b = furniBlock(f);
    if (b === "none") continue;
    for (const t of f.tiles) {
      const k = tileKey(t);
      if (map.get(k) === "hard") continue;
      map.set(k, b);
    }
  }
  return map;
}

const STEPS: readonly (readonly [number, number])[] = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

export type FindPathOptions = {
  /** Extra impassable tiles (for example other avatars the caller wants to route around). */
  avoid?: ReadonlySet<string>;
};

/**
 * Shortest 8-direction route from `from` to the nearest of `goals`, as the
 * tiles to step on (start excluded, goal included), or null when none is
 * reachable. A diagonal step needs both orthogonal neighbours passable (the
 * Tilehouse corner rule). Void tiles and hard furniture block; seats and beds
 * are not walked through but may be the goal. Deterministic.
 */
export function findPath(
  room: PathRoom,
  from: Tile,
  goals: readonly Tile[],
  opts: FindPathOptions = {},
): Tile[] | null {
  if (goals.length === 0) return null;
  const blocks = blockMap(room);
  const goalKeys = new Set(goals.map(tileKey));
  const fromKey = tileKey(from);
  if (goalKeys.has(fromKey)) return [];

  const passable = (x: number, y: number): boolean =>
    isFloor(room, x, y) && !blocks.has(`${x},${y}`) && !opts.avoid?.has(`${x},${y}`);
  // Corner rule: a seat beside the diagonal is fine, a wall or hard furniture is not.
  const cornerOk = (x: number, y: number): boolean =>
    isFloor(room, x, y) && blocks.get(`${x},${y}`) !== "hard" && !opts.avoid?.has(`${x},${y}`);
  const goalOk = (x: number, y: number): boolean => {
    if (!isFloor(room, x, y)) return false;
    return blocks.get(`${x},${y}`) !== "hard";
  };

  const prev = new Map<string, string>();
  const seen = new Set<string>([fromKey]);
  let queue: Tile[] = [from];
  while (queue.length > 0) {
    const next: Tile[] = [];
    for (const cur of queue) {
      for (const [dx, dy] of STEPS) {
        const nx = cur[0] + dx;
        const ny = cur[1] + dy;
        const k = `${nx},${ny}`;
        if (seen.has(k)) continue;
        const isGoal = goalKeys.has(k);
        if (isGoal ? !goalOk(nx, ny) : !passable(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && !(cornerOk(cur[0] + dx, cur[1]) && cornerOk(cur[0], cur[1] + dy))) continue;
        seen.add(k);
        prev.set(k, `${cur[0]},${cur[1]}`);
        if (isGoal) {
          const route: Tile[] = [];
          let at: string | undefined = k;
          while (at && at !== fromKey) {
            const [px, py] = at.split(",").map(Number) as [number, number];
            route.push([px, py]);
            at = prev.get(at);
          }
          return route.reverse();
        }
        next.push([nx, ny]);
      }
    }
    queue = next;
  }
  return null;
}

/** Walkable tiles within `radius` (Chebyshev) of `center`, nearest first, ties by (y, x). */
export function tilesAround(room: PathRoom, center: Tile, radius: number): Tile[] {
  const blocks = blockMap(room);
  const out: Tile[] = [];
  for (let y = center[1] - radius; y <= center[1] + radius; y++) {
    for (let x = center[0] - radius; x <= center[0] + radius; x++) {
      if (!isFloor(room, x, y) || blocks.has(`${x},${y}`)) continue;
      out.push([x, y]);
    }
  }
  return out.sort(
    (a, b) =>
      Math.max(Math.abs(a[0] - center[0]), Math.abs(a[1] - center[1])) -
        Math.max(Math.abs(b[0] - center[0]), Math.abs(b[1] - center[1])) ||
      a[1] - b[1] ||
      a[0] - b[0],
  );
}

/** Walkable tiles at exactly Chebyshev distance `dist` from `center` (a ring). */
export function ringTiles(room: PathRoom, center: Tile, dist: number): Tile[] {
  return tilesAround(room, center, dist).filter(
    (t) => Math.max(Math.abs(t[0] - center[0]), Math.abs(t[1] - center[1])) === dist,
  );
}

/** Walking time of a route. */
export function routeEtaMs(route: readonly Tile[], tickMs = 300): number {
  return route.length * tickMs;
}
