import { describe, expect, it } from "vitest";
import { HotelSpaceMirror, parseScopedRef, scopeRef } from "../space/space-mirror.js";
import { avatar, snapshot } from "../testing/fixtures.js";

const T0 = 5_000_000;

/** Run 7's `duda` and run 8's `duda` in the same room: one character id, two runs. */
function shared() {
  const m = new HotelSpaceMirror();
  m.applySnapshot(snapshot(12, 1, [avatar(9, "ana", 6, 5), avatar(-701, "Duda", 1, 4), avatar(-801, "Duda", 3, 4)]), T0);
  const a = m.scoped(7);
  const b = m.scoped(8);
  a.registerActor({ ref: "duda", id: -701, run: 7, name: "Duda" }, "12", T0);
  b.registerActor({ ref: "duda", id: -801, run: 8, name: "Duda" }, "12", T0);
  return { m, a, b };
}

describe("a run's window on the shared mirror", () => {
  it("scopes a ref by run and reads it back", () => {
    expect(scopeRef(7, "person-1")).toBe("r7.person-1");
    expect(parseScopedRef("r7.person-1")).toEqual({ run: 7, ref: "person-1" });
    expect(parseScopedRef("r12.a.b")).toEqual({ run: 12, ref: "a.b" });
    expect(parseScopedRef("h:9")).toBeUndefined();
    expect(parseScopedRef("person-1")).toBeUndefined();
  });

  it("keeps two runs' actors with one ref apart: ids, tiles and rooms", () => {
    const { a, b } = shared();
    expect(a.avatarId("duda")).toBe(-701);
    expect(b.avatarId("duda")).toBe(-801);
    expect(a.view("duda", T0)?.self?.tile).toEqual([1, 4]);
    expect(b.view("duda", T0)?.self?.tile).toEqual([3, 4]);
    expect(a.refOfAvatar(-701)).toBe("duda");
    expect(a.refOfAvatar(-801)).toBe("r8.duda");
    expect(b.refOfAvatar(-801)).toBe("duda");
  });

  it("shows another run's actor under its scoped ref, never as one of the run's own", () => {
    const { a } = shared();
    const refs = a.view("duda", T0)?.room?.occupants.map((p) => p.ref).sort();
    expect(refs).toEqual(["duda", "h:9", "r8.duda"]);
    expect(a.peopleIn("12", T0).find((p) => p.ref === "r8.duda")?.kind).toBe("actor");
    expect(a.model().agentRoom.get("duda")).toBe("12");
    expect(a.model().rooms.get("12")?.occupants.get("duda")?.tile).toEqual([1, 4]);
  });

  it("moves one run's actor without touching the other's", () => {
    const { m, a, b } = shared();
    m.applySnapshot(snapshot(13, 1, []), T0);
    expect(a.applyMovedRoom(-701, 12, 13, 0, 4, T0 + 10)).toBe("duda");
    expect(a.roomOfRef("duda")).toBe("13");
    expect(b.roomOfRef("duda")).toBe("12");
    a.unregisterActor("duda");
    expect(a.avatarId("duda")).toBeUndefined();
    expect(b.avatarId("duda")).toBe(-801);
    expect(b.view("duda", T0 + 20)?.self?.tile).toEqual([3, 4]);
  });

  it("names a moved actor by its scoped ref to the manager, which hands each run its own", () => {
    const seen: string[] = [];
    const m = new HotelSpaceMirror({ listener: { onMoved: (ref) => seen.push(ref) } });
    m.applySnapshot(snapshot(12, 1, [avatar(-701, "Duda", 1, 4), avatar(-801, "Duda", 3, 4)]), T0);
    m.scoped(7).registerActor({ ref: "duda", id: -701, run: 7, name: "Duda" }, "12", T0);
    m.scoped(8).registerActor({ ref: "duda", id: -801, run: 8, name: "Duda" }, "12", T0);
    m.applyDelta({ t: "delta", room: 12, rev: 2, msg: { t: "moves", moves: [{ id: -801, x: 4, y: 4, dir: 2, state: "walk" }] } }, T0 + 10);
    expect(seen).toEqual(["r8.duda"]);
  });

  it("offers only the rooms a run is limited to, and every room again when the limit is lifted", () => {
    const { m, a, b } = shared();
    m.noteKnownRooms([{ id: "3", name: "Quarto" }, { id: "16", name: "Cozinha" }, { id: "44", name: "Sala do Ze" }]);
    const doors = (s: typeof a) => s.view("duda", T0)?.adjacency.map((x) => x.roomId).sort();
    expect(doors(a)).toEqual(["16", "3", "44"]);
    a.restrictTravel(["12", "3", "44"]);
    expect(doors(a)).toEqual(["3", "44"]);
    expect(doors(b)).toEqual(["16", "3", "44"]);
    a.restrictTravel([]);
    expect(doors(a)).toEqual([]);
    a.restrictTravel(null);
    expect(doors(a)).toEqual(["16", "3", "44"]);
  });

  it("[DEATH-2] marks the avatars on the floor in the views it gives, for perception of bodies, and only while they are", () => {
    const { a } = shared();
    const floor = new Map<string, "dead" | "fainted" | "down">();
    a.setFallen((ref) => floor.get(ref));
    expect(a.view("duda", T0)?.room?.occupants.some((p) => p.fallen !== undefined)).toBe(false);
    floor.set("h:9", "down");
    floor.set("duda", "fainted");
    const seen = a.view("duda", T0)?.room?.occupants.map((p) => [p.ref, p.fallen]).sort();
    expect(seen).toContainEqual(["h:9", "down"]);
    expect(seen).toContainEqual(["duda", "fainted"]);
    floor.clear();
    expect(a.view("duda", T0)?.room?.occupants.some((p) => p.fallen !== undefined)).toBe(false);
  });
});
