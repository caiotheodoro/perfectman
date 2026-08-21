import { describe, it, expect } from "vitest";
import { GOLDEN_LABELS } from "../judge/golden-labels.js";
import { SCENARIO_REGISTRY } from "@perfectman/shared";

const ANCHOR_AXES = [
  "in_character",
  "voice_match",
  "motive_authenticity",
  "interpretation",
  "creativity_unhinged",
  "memory_continuity",
  "no_ai_leak",
] as const;

describe("golden label coverage (#25)", () => {
  it("labels every registry scenario exactly once", () => {
    const registryIds = SCENARIO_REGISTRY.map(s => s.id).sort();
    const labeledIds = GOLDEN_LABELS.map(g => g.scenarioId).sort();
    expect(labeledIds).toEqual(registryIds);
  });

  it("carries the anchor axes plus each scenario's own rubric axes", () => {
    // narrative_cohesion is excluded from golden expectations by seed-set
    // design: it is scored per-turn against turn pairs, not whole scenes.
    const DERIVED_AXES = new Set(["narrative_cohesion"]);
    for (const g of GOLDEN_LABELS) {
      const scenario = SCENARIO_REGISTRY.find(s => s.id === g.scenarioId);
      expect(scenario, g.scenarioId).toBeDefined();
      const rubricAxes = scenario!.rubric.axes.map(a => a.id);
      // Required: anchors plus every structural rubric axis — otherwise the
      // judge's scores for that scene can never pair against golden
      // expectations and the scene goes inert in calibration.
      const required = new Set<string>([
        ...ANCHOR_AXES,
        ...rubricAxes.filter(id => !DERIVED_AXES.has(id)),
      ]);
      const allowed = new Set<string>([...ANCHOR_AXES, ...rubricAxes]);
      for (const req of required) {
        expect(g.axes[req], `${g.scenarioId}.${req} required`).toBeDefined();
      }
      for (const key of Object.keys(g.axes)) {
        expect(allowed.has(key), `${g.scenarioId}.${key} allowed`).toBe(true);
        const v = g.axes[key]!;
        expect(Number.isInteger(v), `${g.scenarioId}.${key} integer`).toBe(true);
        expect(v, `${g.scenarioId}.${key} range`).toBeGreaterThanOrEqual(1);
        expect(v, `${g.scenarioId}.${key} range`).toBeLessThanOrEqual(5);
      }
    }
  });

  it("keeps the no-ai-leak invariant of the seed set", () => {
    for (const g of GOLDEN_LABELS) {
      expect(g.axes["no_ai_leak"], g.scenarioId).toBe(5);
    }
  });
});
