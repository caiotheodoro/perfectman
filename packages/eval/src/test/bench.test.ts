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
      probeResults: [],
      signalResults: [],
      passedSignals: 0,
      totalSignals: 0,
      latencyMs: 1,
      pulseResults: 1,
      promptVersions: ["abc123"],
      templateVersions: ["action-intent-hybrid-v1"],
    }),
  },
}));

const { runBench } = await import("../cli/bench.js");

describe("runBench", () => {
  it("persists the aggregated promptVersions and promptTemplateVersions to the written report", async () => {
    const outPath = join(mkdtempSync(join(tmpdir(), "bench-report-")), "report.json");

    const report = await runBench({ mode: "mock", limit: 1, out: outPath });

    expect(report.promptVersions).toEqual(["abc123"]);
    expect(report.promptTemplateVersions).toEqual(["action-intent-hybrid-v1"]);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.promptVersions).toEqual(["abc123"]);
    expect(written.promptTemplateVersions).toEqual(["action-intent-hybrid-v1"]);
  });
});
