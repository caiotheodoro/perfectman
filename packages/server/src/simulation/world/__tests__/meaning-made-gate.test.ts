import { describe, it, expect } from "vitest";
import type { WorldVerdict } from "@perfectman/shared";
import { deriveMeaningMade, resolveGoalLayerConfig } from "../world-evaluator.js";

/**
 * The meaning-made gate (issue #106, routed by ADR-0011 D-28): boundary
 * tests at the margins measured in calibration-2026-08-26.md sec 7 — the
 * healthy arc's closest approach (0.326), the contested window (0.376) and
 * the tightest flip-decisive margin (0.307, world-briefly-wrong).
 */
describe("deriveMeaningMade — the #106 meaning-made gate", () => {
  const reached: WorldVerdict = {
    goalId: "goal_meaning_made",
    objective: { distanceToTarget: 0, progressRate: 1, plateaued: false },
    consensus: "uncontested",
    determination: "reached",
    confidence: 0.9,
  };
  const notReached: WorldVerdict = { ...reached, determination: "not_reached" };

  it("derives meaning-made for a reached verdict strictly under the ceiling", () => {
    expect(deriveMeaningMade(reached, 0.326, 0.33)).toBe(true);
  });

  it("rejects at and above the ceiling — the comparison is strict (<)", () => {
    expect(deriveMeaningMade(reached, 0.33, 0.33)).toBe(false);
    expect(deriveMeaningMade(reached, 0.34, 0.33)).toBe(false);
    expect(deriveMeaningMade(reached, 0.376, 0.33)).toBe(false);
  });

  it("never derives meaning-made without a reached determination", () => {
    expect(deriveMeaningMade(notReached, 0, 0.33)).toBe(false);
  });

  it("honors the configured ceiling — the sweep surface (issue #106)", () => {
    expect(deriveMeaningMade(reached, 0.37, 0.4)).toBe(true);
    expect(deriveMeaningMade(reached, 0.37, 0.25)).toBe(false);
    expect(deriveMeaningMade(reached, 0.307, 0.3)).toBe(false);
  });

  it("resolveGoalLayerConfig defaults the ceiling to 0.33 and honors overrides", () => {
    expect(resolveGoalLayerConfig({ enabled: true }).ending).toEqual({
      offerAcceptPulses: 0,
      meaningMadeMaxDivergence: 0.33,
    });
    expect(
      resolveGoalLayerConfig({
        enabled: true,
        ending: { meaningMadeMaxDivergence: 0.4 },
      }).ending,
    ).toEqual({ offerAcceptPulses: 0, meaningMadeMaxDivergence: 0.4 });
  });
});