import type { Affordance, FurniModel, RoomModel, Tile, Zone, ZoneKind } from "@perfectman/shared";
import { chebyshev } from "./geometry.js";
import { blockMap, furniList, isFloor, tilesAround, tileKey, type PathRoom } from "./pathing.js";

/** A scenario `places:` entry (compiled by the scenario compiler). */
export type AuthoredPlace = {
  name: string;
  /** A furniture/zone label to sit near, or an explicit tile. */
  near: string | Tile;
  radius?: number;
  tags?: string[];
};

export type ZoneRoomInput = Pick<RoomModel, "w" | "h" | "heights" | "door" | "furni" | "occupants">;

const MAX_LABEL = 32;

/** Strip control and bidi characters and cap the length; the renderer quotes the result. */
export function sanitizeLabel(raw: string, max = MAX_LABEL): string {
  return raw
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Semantic keyword and affordances of a catalog item (embodiment.md section 4).
 * Anything unmatched is `decor` labelled with its sanitized display name.
 */
export function classifyFurni(defId: string, displayName: string): { label: string; kinds: Affordance[] } {
  const text = `${defId} ${displayName}`.toLowerCase();
  const has = (re: RegExp): boolean => re.test(text);
  if (has(/\b(bar|counter)\b|bar_|_bar/)) return { label: "bar", kinds: ["bar"] };
  if (has(/sofa|couch|bench/)) return { label: "sofa", kinds: ["sit"] };
  if (has(/chair|stool|seat|armchair/)) return { label: "chair", kinds: ["sit"] };
  if (has(/window/)) return { label: "window", kinds: ["window"] };
  if (has(/\bbed\b|bed_|_bed/)) return { label: "bed", kinds: ["bed", "lay"] };
  if (has(/jukebox|speaker/)) return { label: "jukebox", kinds: ["game"] };
  if (has(/\btv\b|television|screen/)) return { label: "tv", kinds: ["screen"] };
  if (has(/piano/)) return { label: "piano", kinds: ["screen"] };
  if (has(/table|desk/)) return { label: "table", kinds: ["table"] };
  if (has(/plant|tree|flower/)) return { label: "plant", kinds: ["plant"] };
  if (has(/rug|carpet/)) return { label: "rug", kinds: ["rug"] };
  if (has(/door|gate/)) return { label: "door", kinds: ["door"] };
  return { label: sanitizeLabel(displayName || defId) || "decor", kinds: ["decor"] };
}

const KIND_ORDER: ZoneKind[] = [
  "bar", "seating", "window", "bed", "feature", "decor", "door", "dance_floor", "corner", "middle", "authored",
];

function bbox(tiles: Tile[]): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of tiles) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1 };
}

function centerOf(tiles: Tile[]): { center: Tile; radius: number } {
  const b = bbox(tiles);
  const center: Tile = [Math.round((b.x0 + b.x1) / 2), Math.round((b.y0 + b.y1) / 2)];
  return { center, radius: Math.max(2, Math.ceil(Math.max(b.x1 - b.x0, b.y1 - b.y0) / 2) + 1) };
}

/** Single-link clusters of furniture whose tiles come within `gap` of each other. */
function cluster(items: FurniModel[], gap: number): FurniModel[][] {
  const groups: FurniModel[][] = [];
  const done = new Set<number>();
  const near = (a: FurniModel, b: FurniModel): boolean =>
    a.tiles.some((ta) => b.tiles.some((tb) => chebyshev(ta, tb) <= gap));
  for (const item of items) {
    if (done.has(item.id)) continue;
    const group = [item];
    done.add(item.id);
    for (let i = 0; i < group.length; i++) {
      for (const other of items) {
        if (!done.has(other.id) && near(group[i]!, other)) {
          done.add(other.id);
          group.push(other);
        }
      }
    }
    groups.push(group);
  }
  return groups;
}

const byId = (a: FurniModel, b: FurniModel): number => a.id - b.id;

/**
 * Pure: zones from layout and furniture. Same input, same ids and order.
 * Authored places are resolved here when given; the reducer keeps previously
 * resolved authored zones across furniture deltas.
 */
export function deriveZones(room: ZoneRoomInput, authored: readonly AuthoredPlace[] = []): Zone[] {
  const furni = [...room.furni.values()].sort(byId);
  const zones: Omit<Zone, "id">[] = [];
  const claimed = new Set<number>();
  const tilesOf = (group: FurniModel[]): Tile[] => group.flatMap((f) => f.tiles);

  // 1. Bars, with the stools beside them.
  const seats = furni.filter((f) => f.kinds.includes("sit"));
  const bars = furni.filter((f) => f.kinds.includes("bar"));
  for (const group of cluster(bars, 2)) {
    const stools = seats.filter((s) => group.some((b) => b.tiles.some((tb) => s.tiles.some((ts) => chebyshev(tb, ts) <= 2))));
    for (const s of stools) claimed.add(s.id);
    const all = [...group, ...stools];
    const { center, radius } = centerOf(tilesOf(all));
    zones.push({ kind: "bar", label: "bar", center, radius, furniIds: all.map((f) => f.id), tags: ["bar"], source: "keyword" });
  }

  // 2. Seating clusters.
  const tables = furni.filter((f) => f.kinds.includes("table"));
  for (const group of cluster(seats.filter((s) => !claimed.has(s.id)), 2)) {
    const hasTable = tables.some((t) => group.some((g) => g.tiles.some((tg) => t.tiles.some((tt) => chebyshev(tg, tt) <= 2))));
    const sofas = group.filter((g) => g.label === "sofa");
    const label = hasTable ? "table with chairs" : sofas.length > 0 ? (group.length === 1 ? "sofa" : "sofas") : "seats";
    const { center, radius } = centerOf(tilesOf(group));
    zones.push({ kind: "seating", label, center, radius, furniIds: group.map((f) => f.id), tags: ["seat"], source: "cluster" });
  }

  // 3. Windows and the door (wall zones).
  for (const group of cluster(furni.filter((f) => f.kinds.includes("window")), 2)) {
    const { center } = centerOf(tilesOf(group));
    zones.push({ kind: "window", label: "window", center, radius: 2, furniIds: group.map((f) => f.id), tags: ["window"], source: "wall" });
  }
  zones.push({ kind: "door", label: "door", center: room.door, radius: 2, furniIds: [], tags: ["door"], source: "wall" });

  // 4. Beds.
  for (const f of furni.filter((x) => x.kinds.includes("bed"))) {
    zones.push({ kind: "bed", label: "bed", center: f.tiles[0] ?? room.door, radius: 1, furniIds: [f.id], tags: ["bed", "lay"], source: "keyword" });
  }

  // 5. Features (tv, piano, jukebox).
  for (const group of cluster(furni.filter((f) => f.kinds.includes("screen") || f.kinds.includes("game")), 2)) {
    const { center } = centerOf(tilesOf(group));
    zones.push({ kind: "feature", label: group[0]!.label, center, radius: 2, furniIds: group.map((f) => f.id), tags: ["feature"], source: "keyword" });
  }

  // 6. Decor by distinct label, capped.
  const decorByLabel = new Map<string, FurniModel[]>();
  for (const f of furni) {
    if (!f.kinds.every((k) => k === "decor" || k === "plant" || k === "rug")) continue;
    const list = decorByLabel.get(f.label) ?? [];
    list.push(f);
    decorByLabel.set(f.label, list);
  }
  for (const [label, group] of [...decorByLabel].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 6)) {
    zones.push({ kind: "decor", label, center: group[0]!.tiles[0] ?? room.door, radius: 1, furniIds: group.map((f) => f.id), tags: ["decor"], source: "keyword" });
  }

  // 7. Geometry: corners, middle, dance floor.
  const blocks = blockMap(room);
  const floor: Tile[] = [];
  for (let y = 0; y < room.h; y++) for (let x = 0; x < room.w; x++) if (isFloor(room, x, y)) floor.push([x, y]);
  const corners: Tile[] = [];
  for (const [x, y] of floor) {
    if (blocks.has(`${x},${y}`)) continue;
    const walls = [[0, -1], [1, 0], [0, 1], [-1, 0]].filter(([dx, dy]) => !isFloor(room, x + dx!, y + dy!)).length;
    if (walls >= 2 && corners.every((c) => chebyshev(c, [x, y]) >= 4)) corners.push([x, y]);
  }
  for (const c of corners.slice(0, 4)) {
    zones.push({ kind: "corner", label: "corner", center: c, radius: 1, furniIds: [], tags: ["corner"], source: "geometry" });
  }
  if (floor.length > 0) {
    const b = bbox(floor);
    const mid: Tile = [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    const nearest = [...floor].sort((p, q) => Math.hypot(p[0] - mid[0], p[1] - mid[1]) - Math.hypot(q[0] - mid[0], q[1] - mid[1]) || p[1] - q[1] || p[0] - q[0])[0]!;
    zones.push({
      kind: "middle", label: "middle of the room", center: nearest,
      radius: Math.max(1, Math.round(0.25 * Math.max(b.x1 - b.x0 + 1, b.y1 - b.y0 + 1))),
      furniIds: [], tags: ["middle"], source: "geometry",
    });
  }
  const jukebox = furni.find((f) => f.label === "jukebox");
  const dancers = [...room.occupants.values()].filter((o) => o.state === "dance").map((o) => o.tile);
  if (jukebox) {
    zones.push({ kind: "dance_floor", label: "dance floor", center: jukebox.front[0] ?? jukebox.tiles[0] ?? room.door, radius: 3, furniIds: [jukebox.id], tags: ["dance"], source: "keyword" });
  } else if (dancers.length >= 2 && dancers.every((d) => chebyshev(d, dancers[0]!) <= 4)) {
    const { center } = centerOf(dancers);
    zones.push({ kind: "dance_floor", label: "dance floor", center, radius: 3, furniIds: [], tags: ["dance"], source: "cluster" });
  }

  // 8. Authored places.
  for (const place of authored) {
    const z = resolveAuthoredPlace(room, place);
    if (z) zones.push(z);
  }

  // Stable ids: kind order, then position.
  const counters = new Map<ZoneKind, number>();
  return zones
    .sort(
      (a, b) =>
        KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
        a.center[1] - b.center[1] ||
        a.center[0] - b.center[0] ||
        a.label.localeCompare(b.label),
    )
    .map((z) => {
      const n = (counters.get(z.kind) ?? 0) + 1;
      counters.set(z.kind, n);
      return { id: z.kind === "authored" ? `authored-${z.label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}` : `${z.kind}-${n}`, ...z };
    });
}

/** Resolve a scenario place against the room, or undefined when its anchor is not there. */
export function resolveAuthoredPlace(room: ZoneRoomInput, place: AuthoredPlace): Omit<Zone, "id"> | undefined {
  let center: Tile | undefined;
  let furniIds: number[] = [];
  if (typeof place.near === "string") {
    const label = place.near.toLowerCase();
    const hit = [...room.furni.values()].sort(byId).find((f) => f.label.toLowerCase() === label);
    if (!hit) return undefined;
    center = hit.front[0] ?? hit.tiles[0];
    furniIds = [hit.id];
  } else {
    center = place.near;
  }
  if (!center) return undefined;
  return {
    kind: "authored",
    label: sanitizeLabel(place.name),
    center,
    radius: place.radius ?? 2,
    furniIds,
    tags: place.tags ?? [],
    source: "authored",
  };
}

/**
 * Tiles an avatar can walk to in order to be "at" a zone: the fronts of its
 * furniture and its seats when it has any, else the walkable tiles around its
 * centre. Nearest to the centre first.
 */
export function zoneGoalTiles(room: PathRoom, zone: Zone): Tile[] {
  const goals: Tile[] = [];
  const seen = new Set<string>();
  const push = (t: Tile): void => {
    const k = tileKey(t);
    if (!seen.has(k) && isFloor(room, t[0], t[1])) {
      seen.add(k);
      goals.push(t);
    }
  };
  for (const id of zone.furniIds) {
    const f = furniList(room).find((x) => x.id === id);
    if (!f) continue;
    for (const t of f.front) push(t);
    if (f.kinds.includes("sit") || f.kinds.includes("lay")) for (const t of f.tiles) push(t);
  }
  if (goals.length === 0) for (const t of tilesAround(room, zone.center, zone.radius)) push(t);
  return goals;
}
