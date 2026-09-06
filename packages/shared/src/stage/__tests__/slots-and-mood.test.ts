/**
 * Two rules that are invisible when they work and obvious when they break: a
 * figure must not move between beats it is not moving in, and the soundtrack
 * must not flip every other line.
 */
import { describe, expect, it } from "vitest";
import { assignSlots, slotsFor } from "../slots.js";
import { bedVolume, canChangeMood, moodFor, BEDS, MINIMUM_MOOD_HOLD_SECONDS } from "../mood.js";
import { chipFor, chipIndexFor, headShapeFor, CHARACTER_CHIPS } from "../palette.js";

describe("assignSlots", () => {
  it("keeps everyone where they were when the cast is unchanged", () => {
    const first = assignSlots([0, 1, 2], "public", new Map());
    const second = assignSlots([0, 1, 2], "public", first);
    expect([...second]).toEqual([...first]);
  });

  it("leaves the remaining figures alone when someone drops out", () => {
    const first = assignSlots([0, 1, 2], "public", new Map());
    const second = assignSlots([0, 2], "public", first);
    expect(second.get(0)).toBe(first.get(0));
    expect(second.get(2)).toBe(first.get(2));
    expect(second.has(1)).toBe(false);
  });

  it("puts a newcomer in the lowest free slot rather than shuffling the room", () => {
    const held = new Map([
      [0, 0],
      [2, 2],
    ]);
    const next = assignSlots([0, 2, 5], "public", held);
    expect(next.get(5)).toBe(1);
  });

  it("caps a room at the slots it has", () => {
    const next = assignSlots([0, 1, 2, 3, 4, 5, 6, 7], "public", new Map());
    expect(next.size).toBe(slotsFor("public").length);
  });

  it("never hands back a slot the new room does not have", () => {
    // A public room seats six and a private one five, so slot 5 exists in one
    // and not the other. Carrying it across crashed the stage on the first
    // private channel a real run opened.
    const inPublic = assignSlots([0, 1, 2, 3, 4, 5], "public", new Map());
    const inPrivate = assignSlots([0, 1, 2, 3, 4, 5], "private", inPublic);
    for (const slot of inPrivate.values()) {
      expect(slot).toBeLessThan(slotsFor("private").length);
    }
  });

  it("reseats everyone when a thought leaves room for one", () => {
    const inPublic = assignSlots([0, 1, 2], "public", new Map());
    const alone = assignSlots([2], "thought", inPublic);
    expect([...alone.values()]).toEqual([0]);
  });

  it("gives a private room fewer places than a public one, and a thought exactly one", () => {
    expect(slotsFor("private").length).toBeLessThan(slotsFor("public").length);
    expect(slotsFor("thought")).toHaveLength(1);
  });
});

describe("moodFor", () => {
  it("takes an explicit conflict cue over anything inferred", () => {
    expect(moodFor({ source: "driver", drivers: ["fear_of_exclusion"] })).toBe("tension");
  });

  it("agrees with the face when there is no explicit cue", () => {
    // A worried figure over warm music would read as a mistake.
    expect(moodFor({ source: "snapshot", values: { valence: -0.6, arousal: 0.2 } })).toBe("tension");
    expect(moodFor({ source: "snapshot", values: { valence: 0.6 } })).toBe("warmth");
  });

  it("is calm with nothing recorded yet", () => {
    expect(moodFor()).toBe("calm");
    expect(moodFor({ source: "snapshot", values: { valence: 0 } })).toBe("calm");
  });
});

describe("bed levels and holds", () => {
  it("scales every bed to the same floor, so none jumps out over dialogue", () => {
    const levels = (Object.keys(BEDS) as Array<keyof typeof BEDS>).map((mood) => bedVolume(mood) * 10 ** (BEDS[mood].lufs / 20));
    for (const level of levels) expect(level).toBeCloseTo(levels[0]!, 10);
  });

  it("turns the loudest bed down the furthest", () => {
    expect(bedVolume("calm")).toBeLessThan(bedVolume("tension"));
  });

  it("refuses a mood change inside the hold window", () => {
    expect(canChangeMood(0, MINIMUM_MOOD_HOLD_SECONDS - 0.1)).toBe(false);
    expect(canChangeMood(0, MINIMUM_MOOD_HOLD_SECONDS)).toBe(true);
  });
});

describe("character identity", () => {
  it("wraps the chip palette instead of running out of colours", () => {
    expect(chipFor(CHARACTER_CHIPS.length)).toBe(chipFor(0));
    expect(chipFor(0)).toBe(CHARACTER_CHIPS[0]);
    expect(CHARACTER_CHIPS).toContain(chipFor(11));
  });

  it("varies silhouette as well as colour, for anyone who cannot separate the chips", () => {
    const shapes = new Set([headShapeFor(0), headShapeFor(1), headShapeFor(2)]);
    expect(shapes.size).toBeGreaterThan(1);
  });

  it("gives a character the same colour whatever order the list arrived in", () => {
    // The preset card lists persona files alphabetically; the stage lists
    // agents in the order the scenario cast them. Both must agree.
    const card = ["bruno", "iris", "marcela"];
    const stage = ["iris", "bruno", "marcela"];
    for (const id of card) expect(chipIndexFor(id, card)).toBe(chipIndexFor(id, stage));
  });

  it("gives everyone in a normal cast a different colour", () => {
    const cast = ["iris", "bruno", "marcela", "theo"];
    const chips = new Set(cast.map((id) => chipFor(chipIndexFor(id, cast))));
    expect(chips.size).toBe(cast.length);
  });

  it("survives an id that is not in the roster rather than throwing", () => {
    expect(chipIndexFor("ghost", ["iris"])).toBe(0);
  });
});
