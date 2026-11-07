import { describe, expect, it } from "vitest";
import { applySpaceAction, deriveZones, findPath, projectSpaceView, STALE_MS, facingKind, distanceBand, classifyFurni } from "../index.js";
import { furni, loungeModel, loungeSnapshot, person, T0, viewOf } from "./fixture.js";

describe("space reducer", () => {
  it("applies in-order deltas and moves and removes occupants", () => {
    const model = loungeModel([person("a1", "Ana", [5, 4]), person("a2", "Duda", [6, 4])]);
    expect(applySpaceAction(model, { type: "room_delta", at: T0 + 100, roomId: "lounge", rev: 2, change: { kind: "occupant_moved", ref: "a2", tile: [7, 4], dir: 2 } }).applied).toBe(true);
    expect(model.rooms.get("lounge")!.occupants.get("a2")!.tile).toEqual([7, 4]);
    applySpaceAction(model, { type: "room_delta", at: T0 + 200, roomId: "lounge", rev: 3, change: { kind: "occupant_left", ref: "a2" } });
    expect(model.rooms.get("lounge")!.occupants.has("a2")).toBe(false);
    expect(model.rooms.get("lounge")!.rev).toBe(3);
  });

  it("a rev gap degrades the room, asks for a resnapshot, and a snapshot heals it", () => {
    const model = loungeModel([person("a1", "Ana", [5, 4])]);
    const gap = applySpaceAction(model, { type: "room_delta", at: T0 + 100, roomId: "lounge", rev: 5, change: { kind: "occupant_turned", ref: "a1", dir: 4 } });
    expect(gap).toMatchObject({ applied: false, resnapshot: "lounge", reason: "gap" });
    expect(model.rooms.get("lounge")!.degraded).toBe(true);
    expect(viewOf(model).room!.occupants[0]!.dir).toBe(2);
    applySpaceAction(model, { type: "room_snapshot", at: T0 + 200, rev: 5, room: loungeSnapshot([person("a1", "Ana", [5, 4])]) });
    expect(model.rooms.get("lounge")!.degraded).toBe(false);
    expect(applySpaceAction(model, { type: "room_delta", at: T0 + 300, roomId: "lounge", rev: 5, change: { kind: "occupant_left", ref: "a1" } }).reason).toBe("duplicate");
  });

  it("a ping ahead of our rev is a gap; a ping at our rev only refreshes the clock; stale shows in the view", () => {
    const model = loungeModel([person("a1", "Ana", [5, 4])]);
    expect(applySpaceAction(model, { type: "room_ping", at: T0 + 10, roomId: "lounge", rev: 1 }).applied).toBe(true);
    expect(projectSpaceView(model, "a1", T0 + 10 + STALE_MS + 1)!.room!.stale).toBe(true);
    expect(projectSpaceView(model, "a1", T0 + 10 + 1000)!.room!.stale).toBe(false);
    expect(applySpaceAction(model, { type: "room_ping", at: T0 + 20, roomId: "lounge", rev: 4 }).reason).toBe("gap");
  });

  it("tracks the agent's room through moved_room bookkeeping and in transit", () => {
    const model = loungeModel([person("a1", "Ana", [5, 4])]);
    applySpaceAction(model, { type: "room_delta", at: T0 + 10, roomId: "lounge", rev: 2, change: { kind: "occupant_left", ref: "a1" } });
    expect(projectSpaceView(model, "a1", T0 + 20)!.where).toBe("in_transit");
    expect(projectSpaceView(model, "ghost", T0)).toBeUndefined();
  });
});

describe("deriveZones", () => {
  it("finds bar (with its stools), sofas, window, door, jukebox dance floor, corners and the middle", () => {
    const model = loungeModel([person("a1", "Ana", [5, 4])]);
    const zones = deriveZones(model.rooms.get("lounge")!);
    const byKind = (k: string) => zones.filter((z) => z.kind === k);
    expect(byKind("bar")).toHaveLength(1);
    expect(byKind("bar")[0]!.furniIds.sort()).toEqual([1, 2, 3, 4]);
    expect(byKind("seating")[0]).toMatchObject({ label: "sofas", furniIds: [5, 6] });
    expect(byKind("window")).toHaveLength(1);
    expect(byKind("door")[0]!.center).toEqual([0, 4]);
    expect(byKind("dance_floor")).toHaveLength(1);
    expect(byKind("corner").length).toBeGreaterThanOrEqual(3);
    expect(byKind("middle")).toHaveLength(1);
    expect(zones.map((z) => z.id)).toEqual(deriveZones(model.rooms.get("lounge")!).map((z) => z.id));
  });

  it("labels a seat cluster next to a table and classifies catalog names", () => {
    const room = loungeModel([person("a1", "Ana", [5, 4])]).rooms.get("lounge")!;
    room.furni.set(20, furni(20, "table", "table", ["table"], [[8, 6]]));
    expect(deriveZones(room).find((z) => z.kind === "seating")!.label).toBe("table with chairs");
    expect(classifyFurni("sofa_blue", "Blue Sofa")).toEqual({ label: "sofa", kinds: ["sit"] });
    expect(classifyFurni("x9", "Weird <b>Thing</b>").kinds).toEqual(["decor"]);
  });
});

describe("geometry and pathing", () => {
  it("bands, facing sectors, and BFS with the corner rule and void", () => {
    expect([1, 2, 5, 9, 13].map(distanceBand)).toEqual(["intimate", "personal", "social", "public", "out_of_sight"]);
    expect(facingKind(2, [0, 0], [5, 0])).toBe("facing");
    expect(facingKind(2, [0, 0], [0, 5])).toBe("side_on");
    expect(facingKind(6, [0, 0], [5, 0])).toBe("back_turned");
    const room = loungeModel([person("a1", "Ana", [5, 4])]).rooms.get("lounge")!;
    expect(findPath(room, [5, 4], [[5, 4]])).toEqual([]);
    const route = findPath(room, [5, 4], [[2, 4]])!;
    expect(route[route.length - 1]).toEqual([2, 4]);
    expect(route.length).toBe(3);
    // wall of void with the only gap closed diagonally: no route through the corner rule
    const heights = new Uint8Array(room.w * room.h);
    heights[4 * 12 + 6] = 255;
    heights[3 * 12 + 5] = 255;
    const walled = { ...room, heights };
    expect(findPath(walled, [5, 4], [[6, 3]])!.length).toBeGreaterThan(1);
    const sealed = new Uint8Array(room.w * room.h).fill(255);
    sealed[0] = 0;
    sealed[11 * 1] = 0;
    expect(findPath({ ...room, heights: sealed }, [0, 0], [[11, 0]])).toBeNull();
  });
});
