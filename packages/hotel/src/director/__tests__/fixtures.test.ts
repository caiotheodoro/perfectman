import { describe, expect, expectTypeOf, it } from "vitest";
import {
  isHotelMsg,
  isSidecarMsg,
  type HotelFrame,
  type RoomSnapshot,
  type SidecarFrame,
} from "../index.js";

describe("director generated types", () => {
  it("narrows a sidecar-to-hotel actor_spawn frame", () => {
    const frame = JSON.parse(
      `{"t":"actor_spawn","seq":3,"run":1,"lease":1,"room":7,"cid":42,
        "name":"Ana","figure":"hd-180-1","ref":"agent-a","tile":[2,3]}`,
    ) as SidecarFrame;
    if (!isSidecarMsg(frame, "actor_spawn")) throw new Error("wrong frame");
    // These accesses only compile when the union narrowed on `t`.
    const name: string = frame.name;
    const cid: number = frame.cid;
    expect([name, cid]).toEqual(["Ana", 42]);
    expectTypeOf(frame).not.toHaveProperty("resume");
  });

  it("narrows a hotel-to-sidecar lease frame", () => {
    const frame = JSON.parse(
      `{"t":"lease","seq":1,"run":9,"lease":2}`) as HotelFrame;
    expect(isHotelMsg(frame, "lease")).toBe(true);
    if (isHotelMsg(frame, "lease")) {
      const lease: number = frame.lease;
      expect(lease).toBe(2);
    }
    expect(isHotelMsg(frame, "run_end")).toBe(false);
  });

  it("types a room_snapshot document", () => {
    const snap = JSON.parse(
      `{"avatars":[],"defs":{},"furni":[],"layout":{"door":[0,0],"door_dir":2,"rows":["0"]},"name":"R","owner":1,
        "rev":1,"room":7,"seats":[],"template":"t"}`,
    ) as RoomSnapshot;
    const rev: number = snap.rev;
    expect(rev).toBe(1);
  });
});
