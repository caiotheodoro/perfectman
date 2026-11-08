import { describe, expect, it } from "vitest";
import { drawThought, dropLeave, dropPair, dropWalk } from "../director/cine/hold-spot.js";

describe("wing rooms hold the furniture", () => {
  it("lets the entrance walk through and drops every later walk", () => {
    expect(dropWalk(45, "person-1:enter")).toBe(false);
    expect(dropWalk(45, "person-1:abc")).toBe(true);
    expect(dropWalk(45, undefined)).toBe(true);
    expect(dropWalk(1, "person-1:abc")).toBe(false);
    for (const room of [43, 44, 49]) expect(dropWalk(room, "x")).toBe(true);
  });

  it("drops pair acts and thoughts only in the wing", () => {
    expect(dropPair(45)).toBe(true);
    expect(dropPair(12)).toBe(false);
    expect(dropLeave(45)).toBe(true);
    expect(dropLeave(12)).toBe(false);
    expect(drawThought(45)).toBe(false);
    expect(drawThought(12)).toBe(true);
  });
});
