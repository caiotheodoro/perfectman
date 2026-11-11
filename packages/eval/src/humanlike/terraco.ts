import type { FurniModel, Tile } from "@perfectman/shared";
import type { RoomLayout } from "../embodiment/layouts.js";

/**
 * The Terraço (`pm_terraco` in the hotel's pm_wing, 16 x 11), the room of run 63 (Sobremesa), as the fake grid hotel takes a layout. The pieces and their tiles are the
 * room's own (`crates/server/data/pm_wing.json`); footprints are read off the art (the round table is 2 x 2 with a chair on each side, the railings run along the
 * south and east edges). Wall mounts (windows, lamps, clocks) are left out: they take no floor.
 */
const f = (id: number, defId: string, label: string, kinds: FurniModel["kinds"], tiles: Tile[], front: Tile[] = []): FurniModel => ({ id, defId, label, kinds, tiles, front, state: 0 });

const railing: FurniModel[] = [];
for (let x = 2; x <= 15; x++) railing.push(f(100 + x, "tokyo_c18_railing", "rail", ["decor"], [[x, 10]], [[x, 9]]));
for (let y = 2; y <= 9; y++) railing.push(f(120 + y, "tokyo_c18_railing", "rail", ["decor"], [[15, y]], [[14, y]]));

export const TERRACO: RoomLayout = {
  id: "terraco",
  name: "Terraço",
  template: "pm_terraco",
  w: 16,
  h: 11,
  entry: [0, 8],
  furni: [
    // the sofa group by the north wall, left
    f(1, "bohogarden_c21_rug", "rug", ["rug"], [[2, 1]]),
    f(2, "bohogarden_c21_rattansofa", "sofa", ["sit"], [[2, 0]], [[3, 0]]),
    f(3, "bohogarden_c21_rattansofa", "sofa", ["sit"], [[2, 2]], [[3, 2]]),
    f(4, "bohogarden_c21_rattansofacorner", "sofa", ["sit"], [[1, 1]], [[1, 2]]),
    f(5, "bohogarden_c21_rattansofacorner", "sofa", ["sit"], [[4, 1]], [[4, 2]]),
    f(6, "bohogarden_c21_rattantable", "table", ["table"], [[2, 1]]),
    // sun loungers, top right
    f(7, "habbo25_c25_sunlounger1", "lounger", ["sit", "lay"], [[13, 1]], [[13, 2]]),
    f(8, "habbo25_c25_sunlounger1", "lounger", ["sit", "lay"], [[14, 1]], [[14, 2]]),
    // the barbecue counter and its stools
    f(9, "hygge_c25_counter1", "bar", ["bar"], [[8, 0]], [[8, 1]]),
    f(10, "hblooza_bbq", "grill", ["bar"], [[9, 0]], [[9, 1]]),
    f(11, "hygge_c25_counter1", "bar", ["bar"], [[10, 0]], [[10, 1]]),
    f(12, "barchair_silo", "stool", ["sit"], [[8, 1]], [[8, 2]]),
    f(13, "barchair_silo", "stool", ["sit"], [[10, 1]], [[10, 2]]),
    // the round table with its four chairs (run 63's two seated, in the middle)
    f(14, "table_plasto3_round", "table", ["table"], [[7, 5], [8, 5], [7, 6], [8, 6]]),
    f(15, "chair_silo", "chair", ["sit"], [[6, 5]], [[5, 5]]),
    f(16, "chair_silo", "chair", ["sit"], [[7, 4]], [[7, 3]]),
    f(17, "chair_silo", "chair", ["sit"], [[9, 6]], [[10, 6]]),
    f(18, "chair_silo", "chair", ["sit"], [[8, 7]], [[8, 8]]),
    // the sofa group, bottom left
    f(19, "bohogarden_c21_rattansofacorner", "sofa", ["sit"], [[2, 7]], [[2, 6]]),
    f(20, "bohogarden_c21_rattansofacorner", "sofa", ["sit"], [[5, 7]], [[5, 6]]),
    f(21, "bohogarden_c21_rattantable", "table", ["table"], [[3, 7]]),
    f(22, "es_bench", "bench", ["sit"], [[12, 8], [13, 8]], [[12, 7], [13, 7]]),
    // plants
    f(23, "plant_yukka", "plant", ["plant"], [[0, 0]]),
    f(24, "bohogarden_c21_cheeseplant", "plant", ["plant"], [[15, 0]]),
    f(25, "bohogarden_c21_snakeplant", "plant", ["plant"], [[12, 0]]),
    f(26, "garden_bigpot", "plant", ["plant"], [[1, 9]]),
    ...railing,
  ],
  exits: {},
};

/** What run 63's scene is about, placed in the room: the envelope on the round table, the safe in the corner, the pen on the bench. Words are what the lines call them. */
export const RUN63_PROPS = [
  { id: "envelope", label: "envelope", tile: [7, 5] as Tile, words: ["envelope"] },
  { id: "cofre", label: "cofre", tile: [12, 8] as Tile, words: ["cofre"] },
  { id: "caneta", label: "caneta", tile: [8, 6] as Tile, words: ["caneta"] },
] as const;
