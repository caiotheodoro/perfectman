import type { FurniModel, RoomId, Tile } from "@perfectman/shared";

/**
 * Fixture rooms for the fake grid hotel (docs/plans/hotel-package.md 15).
 * Lounge <-> hallway <-> bedroom, joined by door tiles. Standing on an exit's
 * `door` tile and asking for `move_room` puts the actor on the `arrive` tile
 * of the next room.
 */
export type RoomExit = { door: Tile; arrive: Tile };

export type RoomLayout = {
  id: RoomId;
  name: string;
  template: string;
  w: number;
  h: number;
  /** Main entrance: where a newcomer appears. */
  entry: Tile;
  furni: FurniModel[];
  exits: Record<RoomId, RoomExit>;
};

const f = (id: number, defId: string, label: string, kinds: FurniModel["kinds"], tiles: Tile[], front: Tile[] = []): FurniModel => ({
  id,
  defId,
  label,
  kinds,
  tiles,
  front,
  state: 0,
});

export const LOUNGE: RoomLayout = {
  id: "lounge",
  name: "Lounge",
  template: "lounge",
  w: 12,
  h: 8,
  entry: [1, 4],
  furni: [
    f(1, "bar_counter", "bar", ["bar"], [[2, 1], [3, 1], [4, 1]], [[2, 2], [3, 2], [4, 2]]),
    f(2, "stool", "chair", ["sit"], [[2, 3]], [[2, 4]]),
    f(3, "stool", "chair", ["sit"], [[3, 3]], [[3, 4]]),
    f(4, "stool", "chair", ["sit"], [[4, 3]], [[4, 4]]),
    f(5, "sofa", "sofa", ["sit"], [[8, 5]], [[8, 4]]),
    f(6, "sofa", "sofa", ["sit"], [[9, 5]], [[9, 4]]),
    f(8, "window", "window", ["window"], [[11, 3]], []),
    f(9, "jukebox", "jukebox", ["game"], [[6, 0]], [[6, 1]]),
    f(10, "plant", "plant", ["plant"], [[0, 7]], [[1, 7]]),
  ],
  exits: { hallway: { door: [11, 6], arrive: [1, 1] } },
};

export const HALLWAY: RoomLayout = {
  id: "hallway",
  name: "Hallway",
  template: "hallway",
  w: 10,
  h: 3,
  entry: [1, 1],
  furni: [f(20, "bench", "bench", ["sit"], [[5, 0]], [[5, 1]])],
  exits: {
    lounge: { door: [0, 1], arrive: [10, 6] },
    bedroom: { door: [9, 1], arrive: [1, 3] },
  },
};

export const BEDROOM: RoomLayout = {
  id: "bedroom",
  name: "Bedroom",
  template: "bedroom",
  w: 8,
  h: 6,
  entry: [1, 3],
  furni: [
    f(30, "bed", "bed", ["bed", "lay"], [[6, 1], [6, 2]], [[5, 1]]),
    f(31, "chair", "chair", ["sit"], [[2, 1]], [[2, 2]]),
    f(32, "window", "window", ["window"], [[7, 4]], []),
  ],
  exits: { hallway: { door: [0, 3], arrive: [8, 1] } },
};

export const DEFAULT_LAYOUTS: readonly RoomLayout[] = [LOUNGE, HALLWAY, BEDROOM];
