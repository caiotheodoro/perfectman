import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../run/scenario-runner.js", () => ({
  ScenarioRunner: {
    run: vi.fn().mockResolvedValue({
      scenarioId: "mock-scenario",
      events: [],
      agentStates: new Map(),
      llmCalls: new Map(),
      fallbackCount: 0,
      operatorFailures: 0,
      recoveredFallbacks: 0,
      probeResults: [{ probe: "silence-rate", measured: 0.5, passed: true }],
      signalResults: [],
      passedSignals: 3,
      totalSignals: 4,
      skippedSignals: 1,
      latencyMs: 1,
      pulseResults: 1,
      promptVersions: [],
      templateVersions: [],
    }),
  },
}));

const { ScenarioRunner } = await import("../run/scenario-runner.js");
const { runBehavior } = await import("../cli/behavior.js");
const { BENCH_SLICES, resolveBenchSlice } = await import("../bench-slices.js");

describe("runBehavior", () => {
  it("aggregates signals and probes and writes the report", async () => {
    const outPath = join(mkdtempSync(join(tmpdir(), "behavior-")), "report.json");
    const report = await runBehavior({ limit: 2, out: outPath });

    expect(report.version).toBe("behavior-report-v1");
    expect(report.scenariosRun).toBe(2);
    expect(report.signalPassRate).toBe(0.75);
    expect(report.signalsSkipped).toBe(2);
    expect(report.probeAverages["silence-rate"]).toEqual({ mean: 0.5, passedPct: 1 });
    expect(report.drama).toBeUndefined();
    expect(JSON.parse(readFileSync(outPath, "utf8")).scenariosRun).toBe(2);
  });

  it("always runs with the mock provider", async () => {
    await runBehavior({ limit: 1 });
    expect(vi.mocked(ScenarioRunner.run).mock.calls.at(-1)?.[1]).toMatchObject({ llmMode: "mock" });
  });

  it("expands --seeds into one run per seed and threads pulseLimit", async () => {
    const report = await runBehavior({ limit: 1, seeds: [1, 2], pulseLimit: 5 });
    expect(report.scenariosRun).toBe(2);
    expect(report.perScenario.map(s => s.seed)).toEqual([1, 2]);
    expect(vi.mocked(ScenarioRunner.run).mock.calls.at(-1)?.[1]).toMatchObject({ seed: 2, pulseLimit: 5 });
  });

  it("records a failing run instead of throwing", async () => {
    vi.mocked(ScenarioRunner.run).mockRejectedValueOnce(new Error("boom"));
    const report = await runBehavior({ limit: 1 });
    expect(report.scenariosFailed).toBe(1);
    expect(report.perScenario[0]?.failed).toBe("boom");
  });
});

describe("runBehavior scenario selection", () => {
  it("rejects --slice combined with --category", async () => {
    await expect(runBehavior({ slice: "edges", category: "edge_chaos" })).rejects.toThrow(/--slice or --category/);
  });

  it("rejects a bare --slice flag rather than falling back to the whole registry", async () => {
    await expect(runBehavior({ slice: "" })).rejects.toThrow(/Unknown slice ""/);
  });

  it("rejects a registered slice that resolves to no scenarios", async () => {
    BENCH_SLICES.empty = [];
    try {
      await expect(runBehavior({ slice: "empty" })).rejects.toThrow(/resolved to no scenarios/);
    } finally {
      delete BENCH_SLICES.empty;
    }
  });

  it("truncates with --limit after variant expansion", async () => {
    const report = await runBehavior({ slice: "edges", limit: 3 });
    expect(resolveBenchSlice("edges")).toHaveLength(4);
    expect(report.scenariosRun).toBe(3);
  });
});
