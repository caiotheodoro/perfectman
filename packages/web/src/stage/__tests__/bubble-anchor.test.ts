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
import { BUBBLE_MARGIN, besideSide, besideWidth, bubbleBottom, bubbleClamped } from "../useBubbleAnchor.js";

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

  it("guesses the first paint from the 16:7 drawing before anything is measured", () => {
    // The real head is measured once laid out; this is only what the balloon
    // uses on its first frame, so it should be the drawing's own geometry.
    expect(FIGURE_HEIGHT_FRACTION).toBeCloseTo(0.15 * 1.68 * (16 / 7), 10);
  });
});

describe("bubbleClamped", () => {
  it("is false when the balloon fits above the head", () => {
    expect(bubbleClamped(0.6, ROOM, 60)).toBe(false);
  });

  it("is true when the balloon had to slide down over the figure", () => {
    // Back row, a full page of text: the only place it fits is over the face,
    // and the caller should move it beside the head instead.
    const headTop = headTopFor(slotsFor("public")[4]!);
    expect(bubbleClamped(headTop, ROOM, 150)).toBe(true);
  });
});

describe("beside the head", () => {
  it("opens away from the nearest wall", () => {
    expect(besideSide(0.3)).toBe("right");
    expect(besideSide(0.7)).toBe("left");
    expect(besideSide(0.5)).toBe("right");
  });

  it("gets exactly the room left on that side, so it wraps rather than leaves the frame", () => {
    // A centre figure at scale 1.25 in a 607px room: the balloon starts at
    // (0.5 + 0.109) of the width and may use what remains, minus a margin.
    expect(besideWidth(0.5, 0.109, 607, "right")).toBeCloseTo((1 - 0.609) * 607 - BUBBLE_MARGIN, 3);
    expect(besideWidth(0.7, 0.09, 600, "left")).toBeCloseTo((0.7 - 0.09) * 600 - BUBBLE_MARGIN, 3);
  });

  it("never goes below a readable minimum", () => {
    expect(besideWidth(0.95, 0.09, 300, "right")).toBe(124);
  });
});
