import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const runMock = vi.fn();
vi.mock("../run/scenario-runner.js", () => ({
  ScenarioRunner: { run: (...args: unknown[]) => runMock(...args) },
}));

const narrateMock = vi.fn();
vi.mock("../narrator/narrator.js", () => ({
  narrateScene: (...args: unknown[]) => narrateMock(...args),
}));

vi.mock("../judge/judge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../judge/judge.js")>();
  return {
    ...actual,
    llmJudge: vi.fn().mockResolvedValue({ axes: { in_character: 4, voice_match: 5 }, salvaged: false, imputedAxes: [] }),
    judgeNarration: vi.fn().mockResolvedValue({ axes: { concreteness: 4 }, salvaged: false, imputedAxes: [] }),
  };
});

const { runBench } = await import("../cli/bench.js");

function artifact(seed: unknown) {
  return {
    scenarioId: "s",
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
    promptVersions: ["p1"],
    templateVersions: ["t1"],
    seedEcho: seed,
    llmFailures: [
      { type: "llm_failure", agentId: "a", pulseIndex: 3, detail: "LLM parsing failed for agent a: No JSON object found in response", data: { errorDetail: "No JSON object found in response", rawHead: "", rawLength: 0 } },
    ],
    memoryProposals: { accepted: 2, dropped: 1 },
  };
}

afterEach(() => {
  runMock.mockReset();
  narrateMock.mockReset();
  delete process.env.PERFECTMAN_LLM_PROVIDER;
});

describe("bench hygiene", () => {
  it("expands --seeds into one run per seed, threads seed and pulseLimit to the runner, and reports per-axis spread", async () => {
    runMock.mockImplementation(async (_scenario: unknown, opts: { seed?: number }) => artifact(opts.seed));
    const report = await runBench({ mode: "mock", scenarios: ["motive_gossip"], limit: 1, seeds: [42, 43], pulseLimit: 5 });
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(runMock.mock.calls.map(c => (c[1] as { seed?: number }).seed)).toEqual([42, 43]);
    expect((runMock.mock.calls[0]![1] as { pulseLimit?: number }).pulseLimit).toBe(5);
    expect(report.perScenario.map(s => s.seed)).toEqual([42, 43]);
    expect(report.seeds).toEqual([42, 43]);
    const stats = report.judgeAxisStats["in_character"];
    expect(stats?.n).toBe(2);
    expect(stats?.min).toBeLessThanOrEqual(stats?.max ?? 0);
  });

  it("records a narration failure as a warning instead of swallowing it, without failing the scenario", async () => {
    runMock.mockResolvedValue(artifact(undefined));
    narrateMock.mockRejectedValue(new Error("narrator HTTP 503: boom"));
    const report = await runBench({ mode: "mock", scenarios: ["motive_gossip"], limit: 1, judge: "llm", args: [] });
    expect(report.scenariosFailed).toBe(0);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatchObject({ stage: "narration", scenarioId: "motive_gossip__v0" });
    expect(report.warnings[0]!.message).toContain("503");
  });

  it("keeps an imputed axis out of the means, the spread and the calibration map, and records it per scenario", async () => {
    runMock.mockResolvedValue(artifact(undefined));
    const judge = await import("../judge/judge.js");
    vi.mocked(judge.llmJudge).mockResolvedValueOnce({
      axes: { in_character: 4, voice_match: 3 },
      salvaged: false,
      imputedAxes: ["voice_match"],
      evidence: { in_character: "[p01] a quote" },
    });
    const report = await runBench({ mode: "mock", scenarios: ["motive_gossip"], limit: 1, judge: "llm", args: [] });
    const scene = report.perScenario[0]!;
    expect(scene.imputedAxes).toEqual(["voice_match"]);
    expect(scene.axisScores.voice_match).toBe(3);
    expect(scene.judgeEvidence).toEqual({ in_character: "[p01] a quote" });
    expect(report.judgeAxisMeans.in_character).toBe(4);
    expect(report.judgeAxisMeans.voice_match).toBeUndefined();
    expect(report.judgeAxisStats.voice_match).toBeUndefined();
    expect(report.judgeAxisTargets.voice_match).toMatchObject({ met: false });
  });

  it("unions judge targets across the selected scenarios' rubrics", async () => {
    runMock.mockResolvedValue(artifact(undefined));
    // --limit truncates AFTER variant expansion (7 per scenario), so 8 runs
    // reach the first hoc variant.
    const report = await runBench({ mode: "mock", scenarios: ["motive_gossip", "hoc_fatia_que_nao_existe"], limit: 8 });
    expect(report.judgeAxisTargets["mask_integrity"]?.target).toBe(4);
    expect(report.judgeAxisTargets["in_character"]?.target).toBe(4);
    expect(Object.keys(report.judgeAxisMeansByRubric).sort()).toEqual(["hidden-objective-v1", "roleplay-v1"]);
  });

  it("--variants caps seed variants per scenario where --limit truncates the whole list", async () => {
    runMock.mockResolvedValue(artifact(undefined));
    const report = await runBench({ mode: "mock", scenarios: ["hoc_fatia_que_nao_existe", "hoc_banda_no_festival"], variants: 1 });
    expect(report.perScenario.map(s => s.id)).toEqual(["hoc_fatia_que_nao_existe__v0", "hoc_banda_no_festival__v0"]);
    const two = await runBench({ mode: "mock", scenarios: ["hoc_fatia_que_nao_existe"], variants: 2 });
    expect(two.perScenario.map(s => s.id)).toEqual(["hoc_fatia_que_nao_existe__v0", "hoc_fatia_que_nao_existe__v1"]);
  });

  it("stores letter grades only when a hidden-objective scene ran", async () => {
    runMock.mockResolvedValue(artifact(undefined));
    const plain = await runBench({ mode: "mock", scenarios: ["motive_gossip"], limit: 1 });
    expect(plain.grades).toBeUndefined();
    const hoc = await runBench({ mode: "mock", scenarios: ["hoc_fatia_que_nao_existe"], limit: 1, seeds: [42, 43] });
    expect(hoc.grades?.scenes.map(s => s.scenarioId)).toEqual(["hoc_fatia_que_nao_existe"]);
    expect(hoc.grades?.scenes[0]?.runs.map(r => r.seed)).toEqual([42, 43]);
    // a mock judge is a single opinion: never a settled grade
    expect(hoc.grades?.provisional).toBe(true);
    expect(["A+", "A", "A-", "B", "C", "D", "F"]).toContain(hoc.grades?.grade);
  });

  it("writes an evidence directory for --run-id with run-meta carrying env var names only, and refuses to overwrite without --force", async () => {
    runMock.mockResolvedValue(artifact(undefined));
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    const root = mkdtempSync(join(tmpdir(), "bench-evidence-"));
    const report = await runBench({ mode: "mock", scenarios: ["motive_gossip"], limit: 1, runId: "hoc-test", evidenceRoot: root, seeds: [7] });
    const dir = join(root, "hoc-test");
    expect(existsSync(join(dir, "bench-report.json"))).toBe(true);
    expect(existsSync(join(dir, "scenarios", "motive_gossip__v0__s7.json"))).toBe(true);
    // The fallback forensics trail rides into the per-run record.
    const record = JSON.parse(readFileSync(join(dir, "scenarios", "motive_gossip__v0__s7.json"), "utf8")) as { llmFailures?: Array<{ data?: { rawLength?: number } }> };
    expect(record.llmFailures).toHaveLength(1);
    expect(record.llmFailures?.[0]?.data?.rawLength).toBe(0);
    expect((record as { memoryProposals?: unknown }).memoryProposals).toEqual({ accepted: 2, dropped: 1 });
    const meta = JSON.parse(readFileSync(join(dir, "run-meta.json"), "utf8")) as Record<string, unknown>;
    expect(meta["runId"]).toBe("hoc-test");
    expect(meta["seeds"]).toEqual([7]);
    expect(meta["envVarNames"]).toContain("PERFECTMAN_LLM_PROVIDER");
    expect(JSON.stringify(meta)).not.toContain("sk-");
    expect(report.runId).toBe("hoc-test");

    await expect(runBench({ mode: "mock", scenarios: ["motive_gossip"], limit: 1, runId: "hoc-test", evidenceRoot: root })).rejects.toThrow(/--force/);
    const forced = await runBench({ mode: "mock", scenarios: ["motive_gossip"], limit: 1, runId: "hoc-test", evidenceRoot: root, force: true, seeds: [8] });
    expect(forced.runId).toBe("hoc-test");
    const rewritten = JSON.parse(readFileSync(join(dir, "run-meta.json"), "utf8")) as Record<string, unknown>;
    expect(rewritten["seeds"]).toEqual([8]);
  });
});
