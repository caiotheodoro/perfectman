import type { Affordance, FurniModel, RoomModel, Tile, Zone, ZoneKind } from "@perfectman/shared";
import { chebyshev } from "./geometry.js";
import { sanitizeText } from "../util/text.js";

/**
 * Thin stand-in for the engine's `deriveZones` (embodiment.md 4, L3 owns the
 * real one). Keyword labels, seating clusters, bar, window, door, corners and
 * the middle. Swap `deriveZones` in the mirror's options when the engine ships.
 */
export type DeriveZones = (room: Pick<RoomModel, "id" | "w" | "h" | "heights" | "door" | "furni">) => Zone[];

const KEYWORDS: ReadonlyArray<{ re: RegExp; kind: Affordance; label: string }> = [
  { re: /bar|counter/, kind: "bar", label: "bar" },
  { re: /sofa|couch|bench|chair|stool/, kind: "sit", label: "seat" },
  { re: /window/, kind: "window", label: "window" },
  { re: /\bbed\b|bunk/, kind: "bed", label: "bed" },
  { re: /\btv\b|screen|piano|jukebox/, kind: "screen", label: "feature" },
  { re: /table|desk/, kind: "table", label: "table" },
  { re: /plant|flower|tree/, kind: "plant", label: "plant" },
  { re: /rug|carpet/, kind: "rug", label: "rug" },
  { re: /door|gate/, kind: "door", label: "door" },
];

/** Affordances and a semantic label for a furni definition (display names are untrusted, ADR-0023). */
export function classifyFurni(defId: string, name: string, seat: boolean, lay: boolean): { kinds: Affordance[]; label: string } {
  const text = `${defId} ${name}`.toLowerCase();
  const kinds = new Set<Affordance>();
  let label: string | undefined;
  for (const k of KEYWORDS) {
    if (k.re.test(text)) {
      kinds.add(k.kind);
      label ??= k.label;
    }
  }
  if (seat) kinds.add("sit");
  if (lay) kinds.add("lay");
  if (kinds.size === 0) kinds.add("decor");
  if (kinds.has("sit") && /sofa|couch/.test(text)) label = "sofa";
  return { kinds: [...kinds], label: label ?? (sanitizeText(name, 24) || "furniture") };
}

function isVoid(room: Pick<RoomModel, "w" | "h" | "heights">, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= room.w || y >= room.h) return true;
  return room.heights[y * room.w + x] === 255;
}

export const deriveZonesLite: DeriveZones = (room) => {
  const zones: Zone[] = [];
  let n = 0;
  const push = (kind: ZoneKind, label: string, center: Tile, radius: number, furniIds: number[], source: Zone["source"], tags: string[] = []): void => {
    zones.push({ id: `z${++n}`, kind, label, center, radius, furniIds, tags, source });
  };
  const furni = [...room.furni.values()];

  // Seating clusters: seats within 2 tiles of each other.
  const seats = furni.filter((f) => f.kinds.includes("sit"));
  const groups: FurniModel[][] = [];
  for (const s of seats) {
    const hit = groups.find((g) => g.some((o) => o.tiles.some((a) => s.tiles.some((b) => chebyshev(a, b) <= 2))));
    if (hit) hit.push(s);
    else groups.push([s]);
  }
  for (const g of groups) {
    const tiles = g.flatMap((f) => f.tiles);
    const cx = Math.round(tiles.reduce((s, t) => s + t[0], 0) / tiles.length);
    const cy = Math.round(tiles.reduce((s, t) => s + t[1], 0) / tiles.length);
    const radius = Math.max(1, ...tiles.map((t) => chebyshev(t, [cx, cy])));
    const sofas = g.some((f) => f.label === "sofa");
    push("seating", sofas ? "the sofas" : "the chairs", [cx, cy], radius, g.map((f) => f.id), "cluster", ["seating"]);
  }

  for (const f of furni) {
    const at = f.tiles[0];
    if (!at) continue;
    if (f.kinds.includes("bar")) push("bar", "the bar", at, 2, [f.id], "keyword");
    else if (f.kinds.includes("window")) push("window", "the window", at, 2, [f.id], "wall");
    else if (f.kinds.includes("bed")) push("bed", "the bed", at, 1, [f.id], "keyword");
    else if (f.kinds.includes("screen")) push(f.state > 0 ? "dance_floor" : "feature", f.label, at, 2, [f.id], "keyword");
  }

  push("door", "the door", room.door, 2, [], "geometry", ["door"]);

  // Corners: floor tiles with two or more void/blocked orthogonal neighbours, at most 4.
  const corners: Tile[] = [];
  for (let y = 0; y < room.h && corners.length < 4; y++) {
    for (let x = 0; x < room.w && corners.length < 4; x++) {
      if (isVoid(room, x, y)) continue;
      const blocked = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => isVoid(room, x + (dx ?? 0), y + (dy ?? 0))).length;
      if (blocked >= 2) corners.push([x, y]);
    }
  }
  for (const c of corners) push("corner", "a corner", c, 1, [], "geometry", ["quiet"]);

  push("middle", "the middle of the room", [Math.floor(room.w / 2), Math.floor(room.h / 2)], Math.max(1, Math.floor(Math.min(room.w, room.h) / 4)), [], "geometry");
  return zones.slice(0, 24);
};
