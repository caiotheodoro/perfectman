import { describe, expect, it } from "vitest";
import { STALE_MS, HotelSpaceMirror } from "../space/space-mirror.js";
import { avatar, delta, snapshot } from "../testing/fixtures.js";

const T0 = 5_000_000;

function mirror(listener = {}) {
  const m = new HotelSpaceMirror({ listener });
  m.applySnapshot(snapshot(12, 1, [avatar(9, "ana", 6, 5), avatar(-701, "Duda", 0, 4)]), T0);
  m.registerActor({ ref: "duda", id: -701, run: 7, name: "Duda" }, "12", T0);
  return m;
}

describe("space mirror", () => {
  it("builds the room model from a snapshot: layout, furni kinds, zones, people", () => {
    const m = mirror();
    const room = m.model().rooms.get("12");
    expect(room).toMatchObject({ w: 10, h: 8, rev: 1, door: [0, 4], degraded: false });
    expect([...(room?.furni.values() ?? [])].map((f) => [f.label, f.kinds])).toEqual([["sofa", ["sit"]], ["bar", ["bar"]]]);
    expect(room?.zones.map((z) => z.kind)).toEqual(expect.arrayContaining(["seating", "bar", "door", "middle"]));
    expect([...(room?.occupants.keys() ?? [])]).toEqual(["h:9", "duda"]);
  });

  it("applies per-room deltas that follow rev by exactly one, and reads them back through view()", () => {
    const m = mirror();
    expect(m.applyDelta(delta(12, 2, { t: "moves", moves: [{ id: -701, x: 3, y: 4, dir: 2, state: "walk" }] }), T0 + 300)).toEqual({ ok: true });
    const view = m.view("duda", T0 + 300);
    expect(view?.self).toMatchObject({ tile: [3, 4], state: "walk" });
    expect(view?.room?.stale).toBe(false);
  });

  it("treats a rev gap as degraded until a snapshot lands, and ignores deltas meanwhile", () => {
    const m = mirror();
    const res = m.applyDelta(delta(12, 4, { t: "moves", moves: [{ id: 9, x: 1, y: 1, dir: 0, state: "stand" }] }), T0 + 10);
    expect(res).toEqual({ ok: false, reason: "gap", room: "12" });
    expect(m.view("duda", T0 + 20)?.room?.stale).toBe(true);
    expect(m.applyDelta(delta(12, 2, { t: "avatar_left", id: 9 }), T0 + 30)).toMatchObject({ ok: false, reason: "degraded" });
    m.applySnapshot(snapshot(12, 6, [avatar(-701, "Duda", 2, 2)]), T0 + 40);
    expect(m.view("duda", T0 + 50)?.room?.stale).toBe(false);
    expect(m.applyDelta(delta(12, 7, { t: "avatar_left", id: -701 }), T0 + 60)).toEqual({ ok: true });
  });

  it("keeps rev per room: another room's frames do not make a gap", () => {
    const m = mirror();
    m.applySnapshot(snapshot(13, 40), T0);
    expect(m.applyDelta(delta(13, 41, { t: "typing", id: 1, on: true }), T0)).toEqual({ ok: true });
    expect(m.model().rooms.get("12")?.rev).toBe(1);
  });

  it("drops a delta for a room it never saw", () => {
    expect(mirror().applyDelta(delta(99, 1, { t: "avatar_left", id: 1 }), T0)).toEqual({ ok: false, reason: "unknown_room", room: "99" });
  });

  it("a ping ahead of the last rev is a gap; a ping at it keeps the room fresh", () => {
    const m = mirror();
    expect(m.applyPing({ t: "room_ping", room: 12, rev: 1 }, T0 + 4000)).toEqual({ ok: true });
    expect(m.view("duda", T0 + 8000)?.room?.stale).toBe(false);
    expect(m.applyPing({ t: "room_ping", room: 12, rev: 3 }, T0 + 4100)).toMatchObject({ ok: false, reason: "gap" });
  });

  it("calls a room stale after 5 s of silence, once, and asks for one resnapshot", () => {
    const m = mirror();
    expect(m.view("duda", T0 + STALE_MS)?.room?.stale).toBe(false);
    expect(m.view("duda", T0 + STALE_MS + 1)?.room?.stale).toBe(true);
    expect(m.staleRooms(T0 + STALE_MS + 1)).toEqual(["12"]);
    expect(m.staleRooms(T0 + STALE_MS + 2)).toEqual([]);
  });

  it("dead-reckons a walker whose last move is older than 600 ms, one tile per 300 ms", () => {
    const m = mirror();
    m.applyDelta(delta(12, 2, { t: "moves", moves: [{ id: -701, x: 1, y: 4, dir: 2, state: "walk" }] }), T0);
    m.applyWalkStarted(-701, [8, 4]);
    expect(m.view("duda", T0 + 500)?.self?.tile).toEqual([1, 4]);
    expect(m.view("duda", T0 + 1200)?.self?.tile).toEqual([5, 4]);
  });

  it("expires a human's typing and speech after 8 s without a refresh", () => {
    const m = mirror();
    m.applyDelta(delta(12, 2, { t: "typing", id: 9, on: true }), T0);
    m.applyDelta(delta(12, 3, { t: "chat", from: 9, name: "ana", text: "oi" }), T0);
    const fresh = m.peopleIn("12", T0 + 1000).find((p) => p.ref === "h:9");
    expect(fresh?.lastSpokeAt).toBe(T0);
    const old = m.peopleIn("12", T0 + 9000).find((p) => p.ref === "h:9");
    expect(old).toMatchObject({ typing: false });
    expect(old?.lastSpokeAt).toBeUndefined();
  });

  it("moves an own actor between rooms on moved_room and reports it in transit when the target is unknown", () => {
    const m = mirror();
    m.applySnapshot(snapshot(13, 1), T0);
    m.applyMovedRoom(-701, 12, 13, 0, 4, T0 + 10);
    expect(m.roomOfRef("duda")).toBe("13");
    expect(m.model().rooms.get("12")?.occupants.has("duda")).toBe(false);
    m.applyMovedRoom(-701, 13, 77, 0, 4, T0 + 20);
    expect(m.view("duda", T0 + 30)?.where).toBe("in_transit");
  });

  it("re-keys an avatar_joined that arrived before actor_spawned, and never renders another run's actor as an actor", () => {
    const m = new HotelSpaceMirror();
    m.applySnapshot(snapshot(12, 1, [avatar(-702, "Other", 3, 3)]), T0);
    m.applyDelta(delta(12, 2, { t: "avatar_joined", avatar: avatar(-701, "Duda", 0, 4) }), T0);
    m.registerActor({ ref: "duda", id: -701, run: 7, name: "Duda" }, "12", T0);
    const people = m.peopleIn("12", T0);
    expect(people.map((p) => [p.ref, p.kind])).toEqual([["h:-702", "human"], ["duda", "actor"]]);
  });

  it("tells the listener when someone moves and when a human types", () => {
    const events: string[] = [];
    const m = mirror({ onMoved: (ref: string) => events.push(`moved:${ref}`), onHumanTyping: (_r: string, ref: string, on: boolean) => events.push(`typing:${ref}:${on}`) });
    m.applyDelta(delta(12, 2, { t: "moves", moves: [{ id: 9, x: 7, y: 5, dir: 2, state: "stand" }] }), T0);
    m.applyDelta(delta(12, 3, { t: "typing", id: 9, on: true }), T0);
    expect(events).toEqual(["moved:h:9", "typing:h:9:true"]);
  });
});
