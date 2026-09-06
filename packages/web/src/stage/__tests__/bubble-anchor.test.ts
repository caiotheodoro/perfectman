/**
 * The balloon hangs off a head, and must not leave the frame doing it.
 *
 * The numbers here are the real ones: a room around 300px tall, and the slot
 * geometry from `slots.ts` — a figure occupies 57.6% of the room's height, so
 * a back-row figure at y 0.52 and scale 0.6 has its head about 52px below the
 * room's top edge. A full page of text is twice that.
 */
import { describe, expect, it } from "vitest";
import { FIGURE_HEIGHT_FRACTION, headTopFor, slotsFor } from "@perfectman/shared";
import { BUBBLE_MARGIN, bubbleBottom } from "../useBubbleAnchor.js";

const ROOM = 300;

/** Where the balloon's top lands, measured from the room's top edge. */
function topInside(headTop: number, bubbleHeight: number, room = ROOM): number {
  return room - bubbleBottom(headTop, room, bubbleHeight) - bubbleHeight;
}

describe("bubbleBottom", () => {
  it("sits just above the head when there is room", () => {
    const headTop = 0.6;
    const bottom = bubbleBottom(headTop, ROOM, 60);
    expect(bottom).toBeCloseTo((1 - headTop) * ROOM + ROOM * 0.02, 5);
  });

  it("slides down rather than out when the balloon is taller than the headroom", () => {
    // Back row, a full page of text: the natural position would put the top
    // roughly 100px above the frame.
    const headTop = headTopFor(slotsFor("public")[4]!);
    expect(topInside(headTop, 150)).toBe(BUBBLE_MARGIN);
  });

  it("keeps the top inside for every slot and any plausible text length", () => {
    for (const kind of ["public", "private", "thought"] as const) {
      for (const slot of slotsFor(kind)) {
        for (const height of [40, 80, 120, 160, 200]) {
          for (const room of [220, 300, 420]) {
            expect(topInside(headTopFor(slot), height, room)).toBeGreaterThanOrEqual(0);
          }
        }
      }
    }
  });

  it("gives up gracefully rather than going negative when nothing can fit", () => {
    // A balloon taller than the whole room: pinned to the floor, still inside.
    expect(bubbleBottom(0.2, 200, 400)).toBe(0);
  });

  it("agrees with the figure height the CSS draws", () => {
    // If these drift the balloon detaches from the head it belongs to.
    expect(FIGURE_HEIGHT_FRACTION).toBeCloseTo(0.15 * 1.68 * (16 / 7), 10);
  });
});
