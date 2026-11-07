import { describe, it, expect } from "vitest";
import { FakeGridHotel, type GridEvent } from "../embodiment/fake-grid-hotel.js";

function setup() {
  const events: GridEvent[] = [];
  const grid = new FakeGridHotel({ onEvent: (e) => events.push(e) });
  grid.spawnActor("rafa", "Rafa", "lounge", [1, 4]);
  grid.advance(250);
  grid.spawnActor("duda", "Duda", "lounge", [1, 6]);
  const where = (id: string) => grid.view(id, grid.now())?.self;
  return { grid, events, where };
}

describe("FakeGridHotel (Tilehouse rules the probes rely on)", () => {
  it("walks one tile per 300 ms along the engine route, then reports the arrival", async () => {
    const { grid, events, where } = setup();
    await grid.dispatch([{ agentId: "rafa", cmd: "walk", to: [4, 4] }]);
    grid.advance(300);
    expect(where("rafa")?.tile).toEqual([2, 4]);
    expect(where("rafa")?.state).toBe("walk");
    grid.advance(600);
    expect(where("rafa")?.tile).toEqual([4, 4]);
    expect(where("rafa")?.state).toBe("stand");
    expect(events).toContainEqual(expect.objectContaining({ type: "arrived", agentId: "rafa", tile: [4, 4] }));
  });

  it("sits on arrival at a seat with an even direction, and refuses a gesture while walking", async () => {
    const { grid, where } = setup();
    await grid.dispatch([{ agentId: "rafa", cmd: "sit", furniId: 4 }]);
    await grid.dispatch([{ agentId: "rafa", cmd: "gesture", a: "wave" }]);
    expect(grid.stats.refused).toBe(1);
    grid.advance(3000);
    const me = where("rafa");
    expect(me?.state).toBe("sit");
    expect(me?.seatId).toBe(4);
    expect((me?.dir ?? 1) % 2).toBe(0);
    await grid.dispatch([{ agentId: "rafa", cmd: "gesture", a: "laugh" }]);
    expect(where("rafa")?.action).toMatchObject({ a: "laugh", until: grid.now() + 2000 });
  });

  it("limits an actor to 8 commands per 5 s (walk included) and 4 chats per 6 s", async () => {
    const { grid } = setup();
    for (let i = 0; i < 10; i++) await grid.dispatch([{ agentId: "rafa", cmd: "face", dir: 2 }]);
    expect(grid.stats.slowDown).toBe(2);
    grid.advance(6000);
    for (let i = 0; i < 6; i++) await grid.dispatch([{ agentId: "duda", cmd: "chat", mode: "say", text: `oi ${i}` }]);
    expect(grid.stats.slowDown).toBe(4); // chat 5 and 6 refused
  });

  it("moves an actor between rooms through the door tile and keeps the model's room map in step", async () => {
    const { grid, events } = setup();
    await grid.dispatch([{ agentId: "rafa", cmd: "move_room", to: "hallway" }]);
    grid.advance(8000);
    expect(grid.view("rafa", grid.now())?.where).toBe("hallway");
    expect(events).toContainEqual({ type: "moved_room", agentId: "rafa", from: "lounge", to: "hallway" });
    expect(grid.model().rooms.get("lounge")?.occupants.has("rafa")).toBe(false);
    await grid.dispatch([{ agentId: "duda", cmd: "move_room", to: "bedroom" }]);
    expect(grid.stats.refused).toBe(1); // no door from the lounge to the bedroom
  });

  it("flags commands sent into a room whose mirror went stale", async () => {
    const { grid } = setup();
    grid.freezeSync("lounge");
    grid.advance(7000);
    await grid.dispatch([{ agentId: "rafa", cmd: "face", dir: 4 }]);
    grid.freezeSync("lounge", false);
    grid.advance(2000);
    await grid.dispatch([{ agentId: "rafa", cmd: "face", dir: 2 }]);
    const sent = grid.frameLog().frames.filter((fr) => fr.kind === "actor_cmd");
    expect(sent.map((fr) => fr.data["stale"])).toEqual([true, false]);
  });

  it("drives the model only through the reducer: every mirrored change is one revision", async () => {
    const { grid } = setup();
    const before = grid.model().rooms.get("lounge")!.rev;
    await grid.dispatch([{ agentId: "rafa", cmd: "walk", to: [3, 4] }]);
    grid.advance(1000);
    expect(grid.model().rooms.get("lounge")!.rev).toBeGreaterThan(before + 2);
    expect(grid.model().rooms.get("lounge")!.degraded).toBe(false);
  });
});
