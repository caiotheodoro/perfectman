import type { AvatarState, Direction8, FurniModel, Presence, SpaceModel, SpaceView, Tile } from "@perfectman/shared";
import { applySpaceAction, createSpaceModel, type RoomSnapshot } from "../space-reducer.js";
import { projectSpaceView } from "../project-view.js";

export const T0 = 1_000_000;

export function furni(id: number, defId: string, label: string, kinds: FurniModel["kinds"], tiles: Tile[], front: Tile[] = []): FurniModel {
  return { id, defId, label, kinds, tiles, front, state: 0 };
}

export function person(ref: string, name: string, tile: Tile, over: Partial<Presence> = {}): Presence {
  return {
    ref,
    name,
    kind: ref.startsWith("h:") ? "human" : "actor",
    tile,
    dir: 2 as Direction8,
    state: "stand" as AvatarState,
    since: 0,
    lastMovedAt: 0,
    ...over,
  };
}

/** A 12x8 lounge: bar with three stools, two sofas, a window, a jukebox, a plant. */
export function loungeSnapshot(occupants: Presence[], over: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    id: "lounge",
    name: "Lounge",
    template: "lounge",
    w: 12,
    h: 8,
    door: [0, 4],
    doorDir: 2,
    heights: new Array<number>(12 * 8).fill(0),
    furni: [
      furni(1, "bar_counter", "bar", ["bar"], [[2, 1], [3, 1], [4, 1]], [[2, 2], [3, 2], [4, 2]]),
      furni(2, "stool", "chair", ["sit"], [[2, 3]], [[2, 4]]),
      furni(3, "stool", "chair", ["sit"], [[3, 3]], [[3, 4]]),
      furni(4, "stool", "chair", ["sit"], [[4, 3]], [[4, 4]]),
      furni(5, "sofa", "sofa", ["sit"], [[8, 5]], [[8, 4]]),
      furni(6, "sofa", "sofa", ["sit"], [[9, 5]], [[9, 4]]),
      furni(8, "window", "window", ["window"], [[11, 3]], []),
      furni(9, "jukebox", "jukebox", ["game"], [[6, 0]], [[6, 1]]),
      furni(10, "plant", "plant", ["plant"], [[0, 7]], [[1, 7]]),
    ],
    occupants,
    adjacency: [{ roomId: "terrace", viaDoor: [11, 6], travelS: 6, name: "Terraço" }],
    ...over,
  };
}

export function loungeModel(occupants: Presence[], agentIds: string[] = ["a1"], over: Partial<RoomSnapshot> = {}): SpaceModel {
  const model = createSpaceModel();
  for (const id of agentIds) applySpaceAction(model, { type: "agent_room", agentId: id, room: "lounge" });
  applySpaceAction(model, { type: "room_snapshot", at: T0, rev: 1, room: loungeSnapshot(occupants, over) });
  return model;
}

export function viewOf(model: SpaceModel, agentId = "a1", now = T0 + 1000): SpaceView {
  const v = projectSpaceView(model, agentId, now);
  if (!v) throw new Error("no view");
  return v;
}
