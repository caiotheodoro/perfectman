import { describe, it, expect } from "vitest";
import { BENCH_SLICES, resolveBenchSlice } from "../bench-slices.js";
import { SCENARIO_REGISTRY } from "@perfectman/shared";
import { GOLDEN_LABELS } from "../judge/golden-labels.js";

describe("bench slices", () => {
  it("resolves every slice id against the scenario registry", () => {
    const registryIds = new Set(SCENARIO_REGISTRY.map(s => s.id));
    for (const [name, ids] of Object.entries(BENCH_SLICES)) {
      const unknown = ids.filter(id => !registryIds.has(id));
      expect(unknown, `slice ${name} has unknown scenario ids`).toEqual([]);
    }
  });

  it("golden slice stays pinned to GOLDEN_LABELS (order and uniqueness)", () => {
    expect(BENCH_SLICES.golden).toEqual(GOLDEN_LABELS.map(g => g.scenarioId));
  });

  it("edges slice covers all four edge_chaos scenarios", () => {
    const edgeIds = SCENARIO_REGISTRY.filter(s => s.category === "edge_chaos").map(s => s.id);
    for (const id of edgeIds) {
      expect(BENCH_SLICES.edges, `edges slice includes ${id}`).toContain(id);
    }
  });

  it("returns a defensive copy from resolveBenchSlice", () => {
    const slice = resolveBenchSlice("canary")!;
    slice.pop();
    expect(resolveBenchSlice("canary")!.length).toBe(slice.length + 1);
  });

  it("returns undefined for unknown slice names", () => {
    expect(resolveBenchSlice("nope")).toBeUndefined();
  });
});
