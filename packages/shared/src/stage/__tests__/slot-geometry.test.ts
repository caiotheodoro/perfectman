/**
 * A name tag must be readable. The mid row stands behind the front row by
 * design, but its tag sits under its feet — and if that lands inside a front
 * figure's box, the name is hidden by a torso.
 *
 * Geometry in fractions of the room's width (W) with H = 7/16 W. A mark is 15%
 * of W wide, scaled; the figure is 168 tall in a 100-wide box plus a 19px tag,
 * so at scale s a mark spans [x − .075s, x + .075s] × [y − .616s·(16/7)/… , y].
 * The tag is budgeted at ten italic characters (~0.55em of 19px each).
 */
import { describe, expect, it } from "vitest";
import { slotsFor, type StageSlot } from "../slots.js";

const H_OVER_W = 7 / 16;
/** Figure height as a fraction of H at scale 1 — SVG 168 over a 100-wide mark at 15% of W. */
const FIGURE_H = 0.15 * 1.68 / H_OVER_W;
/** Name tag: ten characters at ~0.55em × 19px, in a 1200px-wide room. */
const TAG_HALF_W = (10 * 0.55 * 19) / 2 / 1200;
const TAG_H = 22 / (1200 * H_OVER_W);

type Box = { left: number; right: number; top: number; bottom: number };

function markBox(slot: StageSlot): Box {
  return {
    left: slot.x - 0.075 * slot.scale,
    right: slot.x + 0.075 * slot.scale,
    top: slot.y - FIGURE_H * slot.scale - TAG_H * slot.scale,
    bottom: slot.y,
  };
}

function tagBox(slot: StageSlot): Box {
  return {
    left: slot.x - (TAG_HALF_W * slot.scale) / 0.76,
    right: slot.x + (TAG_HALF_W * slot.scale) / 0.76,
    top: slot.y - TAG_H * slot.scale,
    bottom: slot.y,
  };
}

function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe("slot geometry", () => {
  for (const kind of ["public", "private"] as const) {
    it(`keeps every ${kind} name tag out of every closer figure's box`, () => {
      const slots = slotsFor(kind);
      const offenders: string[] = [];
      slots.forEach((slot, i) => {
        slots.forEach((other, j) => {
          if (i === j || other.scale <= slot.scale) return;
          if (intersects(tagBox(slot), markBox(other))) offenders.push(`${kind}[${i}] tag inside ${kind}[${j}]`);
        });
      });
      expect(offenders).toEqual([]);
    });
  }

  it("spaces the public rows evenly enough to read as a group", () => {
    const xs = slotsFor("public").slice(0, 4).map((s) => s.x).sort((a, b) => a - b);
    const gaps = xs.slice(1).map((x, i) => x - xs[i]!);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(0.12);
  });
});
