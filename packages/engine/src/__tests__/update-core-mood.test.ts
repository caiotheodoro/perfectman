import { describe, it, expect } from "vitest";
import { updateCoreMood } from "../emotion/update-core-mood.js";
import { makeMood, makePersona } from "./fixtures.js";

function impulse(deltaValence: number, deltaArousal: number, magnitude = 0.5) {
  return { deltaValence, deltaArousal, magnitude };
}

describe("updateCoreMood", () => {
  it("raises valence after a positive impulse", () => {
    const next = updateCoreMood(makeMood({ valence: 0 }), [impulse(0.5, 0)], makePersona(), 1);
    expect(next.valence).toBeGreaterThan(0);
  });

  it("lowers valence after a negative impulse", () => {
    const next = updateCoreMood(makeMood({ valence: 0 }), [impulse(-0.5, 0)], makePersona(), 1);
    expect(next.valence).toBeLessThan(0);
  });

  it("caps the per-pulse mood swing to the MAX_DELTA bounds", () => {
    const next = updateCoreMood(makeMood({ valence: 0, arousal: 0.5 }), [impulse(5, 5, 1)], makePersona(), 1);
    expect(next.valence).toBeGreaterThanOrEqual(-0.5);
    expect(next.valence).toBeLessThanOrEqual(0.5);
  });

  it("shock impulses (magnitude >= 0.6) drop stability", () => {
    const next = updateCoreMood(makeMood({ stability: 0.8 }), [impulse(0, 0, 0.9)], makePersona(), 0);
    expect(next.stability).toBeLessThan(0.8);
  });

  it("regenerates energy toward its baseline", () => {
    const next = updateCoreMood(makeMood({ energy: 0.2 }), [], makePersona({ energyRegen: 0.5 }), 1);
    expect(next.energy).toBeGreaterThan(0.2);
  });

  it("clamps stability to the 0.1 floor and valence to [-1, 1]", () => {
    const next = updateCoreMood(makeMood({ stability: -5, valence: 2 }), [], makePersona(), 1);
    expect(next.stability).toBeGreaterThanOrEqual(0.1);
    expect(next.valence).toBeLessThanOrEqual(1);
  });

  it("constrains circumplex angle rotation by maxMoodRotation per dt", () => {
    const next = updateCoreMood(
      makeMood({ valence: 0, circumplexAngle: 0 }),
      [impulse(2, 2, 0.5)],
      makePersona({ maxMoodRotation: 0.2 }),
      1,
    );
    expect(Math.abs(next.circumplexAngle)).toBeLessThanOrEqual(0.2 + 1e-9);
  });
});
