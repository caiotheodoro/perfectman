import { describe, it, expect } from "vitest";
import { GOLDEN_LABELS } from "../judge/golden-labels.js";
import { SCENARIO_REGISTRY, ROLEPLAY_V1_RUBRIC } from "@perfectman/shared";

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

  it("carries the full anchor axis set with in-range integer scores", () => {
    for (const g of GOLDEN_LABELS) {
      expect(Object.keys(g.axes).sort(), g.scenarioId).toEqual([...ANCHOR_AXES].sort());
      for (const [axis, v] of Object.entries(g.axes)) {
        expect(Number.isInteger(v), `${g.scenarioId}.${axis} integer`).toBe(true);
        expect(v, `${g.scenarioId}.${axis} range`).toBeGreaterThanOrEqual(1);
        expect(v, `${g.scenarioId}.${axis} range`).toBeLessThanOrEqual(5);
      }
    }
  });

  it("keeps the no-ai-leak invariant of the seed set", () => {
    for (const g of GOLDEN_LABELS) {
      expect(g.axes["no_ai_leak"], g.scenarioId).toBe(5);
    }
  });

  it("anchor axes stay consistent with the roleplay rubric", () => {
    const rubricAxisIds = ROLEPLAY_V1_RUBRIC.axes.map(a => a.id).sort();
    for (const axis of ANCHOR_AXES) {
      expect(rubricAxisIds).toContain(axis);
    }
  });
});
