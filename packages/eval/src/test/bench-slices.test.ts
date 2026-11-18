import { describe, it, expect } from "vitest";
import { BENCH_SLICES, resolveBenchSlice } from "../bench-slices.js";
import { SCENARIO_REGISTRY } from "@perfectman/shared";

describe("behavior slices", () => {
  it("resolves every slice id against the scenario registry", () => {
    const registryIds = new Set(SCENARIO_REGISTRY.map(s => s.id));
    for (const [name, ids] of Object.entries(BENCH_SLICES)) {
      const unknown = ids.filter(id => !registryIds.has(id));
      expect(unknown, `slice ${name} has unknown scenario ids`).toEqual([]);
    }
  });

  it("core slice has no duplicates", () => {
    const core = BENCH_SLICES.core ?? [];
    expect(core.length).toBeGreaterThan(0);
    expect(new Set(core).size).toBe(core.length);
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

  it("rejects inherited Object.prototype keys instead of crashing on them", () => {
    for (const name of ["toString", "constructor", "valueOf", "hasOwnProperty", "__proto__"]) {
      expect(resolveBenchSlice(name), `slice name ${name}`).toBeUndefined();
    }
  });
});
