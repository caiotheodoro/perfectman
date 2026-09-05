import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../run/scenario-runner.js", () => ({
  ScenarioRunner: {
    run: vi.fn().mockResolvedValue({
      scenarioId: "mock-scenario",
      events: [],
      agentStates: new Map(),
      llmCalls: new Map(),
      fallbackCount: 0,
      operatorFailures: 0,
      recoveredFallbacks: 2,
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

const { runBench, judgeConfig } = await import("../cli/bench.js");
const { BENCH_SLICES, resolveBenchSlice } = await import("../bench-slices.js");

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

  it("counts recovered fallbacks (retry fixed a guard violation) into the report, not just terminal failures", async () => {
    const outPath = join(mkdtempSync(join(tmpdir(), "bench-report-")), "report.json");

    const report = await runBench({ mode: "mock", limit: 1, out: outPath });

    expect(report.recoveredFallbacks).toBe(2);
    expect(report.perScenario[0]?.recoveredFallbacks).toBe(2);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.recoveredFallbacks).toBe(2);
  });
});

describe("runBench slice selection", () => {
  it("rejects --slice combined with --category instead of silently ignoring the category", async () => {
    await expect(runBench({ mode: "mock", slice: "edges", category: "edge_chaos" })).rejects.toThrow(
      /--slice or --category/,
    );
  });

  it("rejects a bare --slice flag rather than falling back to the whole registry", async () => {
    await expect(runBench({ mode: "mock", slice: "" })).rejects.toThrow(/Unknown slice ""/);
  });

  it("rejects a registered slice that resolves to no scenarios", async () => {
    BENCH_SLICES.empty = [];
    try {
      await expect(runBench({ mode: "mock", slice: "empty" })).rejects.toThrow(/resolved to no scenarios/);
    } finally {
      delete BENCH_SLICES.empty;
    }
  });

  it("truncates with --limit AFTER variant expansion, not at the scenario level", async () => {
    const report = await runBench({ mode: "mock", slice: "edges", limit: 3 });

    expect(resolveBenchSlice("edges")).toHaveLength(4);
    expect(report.scenariosRun).toBe(3);
  });
});

describe("judgeConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lets the judge use a separate endpoint from the arena (cross-family judging)", async () => {
    vi.stubEnv("PERFECTMAN_LLM_PROVIDER", "local");
    vi.stubEnv("PERFECTMAN_JUDGE_BASE_URL", "https://api.deepseek.com/v1");
    vi.stubEnv("PERFECTMAN_LLM_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("PERFECTMAN_JUDGE_MODEL", "deepseek-chat");
    vi.stubEnv("PERFECTMAN_LLM_MODEL", "qwen3:1.7b");
    vi.stubEnv("PERFECTMAN_JUDGE_TEMPERATURE", "0");

    const cfg = await judgeConfig();
    expect(cfg.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(cfg.model).toBe("deepseek-chat");
    expect(cfg.temperature).toBe(0);
  });

  it("falls back to the arena endpoint when no judge endpoint is set", async () => {
    vi.stubEnv("PERFECTMAN_LLM_PROVIDER", "local");
    vi.stubEnv("PERFECTMAN_LLM_BASE_URL", "http://localhost:11434/v1");
    delete process.env.PERFECTMAN_JUDGE_BASE_URL;

    expect((await judgeConfig()).baseUrl).toBe("http://localhost:11434/v1");
  });

  it("keeps the deepseek endpoint shortcut for env-only runs", async () => {
    vi.stubEnv("PERFECTMAN_LLM_PROVIDER", "deepseek");
    vi.stubEnv("PERFECTMAN_LLM_API_KEY", "sk-test");

    const cfg = await judgeConfig();
    expect(cfg.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(cfg.model).toBe("deepseek-chat");
    expect(cfg.apiKey).toBe("sk-test");
    expect(cfg.timeoutMs).toBe(90000);
  });
});
