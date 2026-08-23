import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../judge/judge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../judge/judge.js")>();
  return {
    ...actual,
    juryJudge: vi.fn().mockResolvedValue({ axes: { in_character: 4 }, voterCount: 1, perJudge: {}, failed: {} }),
  };
});

const { runBench } = await import("../cli/bench.js");
const { juryJudge } = await import("../judge/judge.js");

async function tempJudgeFile(config: Record<string, unknown>): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "bench-dispatch-test-"));
  const path = join(dir, "judge.json");
  await writeFile(path, JSON.stringify(config));
  return { dir, path };
}

describe("runBench judge provider dispatch", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches providerType mock from a judge-config file to the deterministic mock judge", async () => {
    const { dir, path } = await tempJudgeFile({ providerType: "mock", modelName: "mock" });
    try {
      const report = await runBench({ mode: "mock", args: ["--judge-config", path] });
      const axes = report.perScenario[0]!.axisScores;
      expect(Object.values(axes).length).toBeGreaterThan(0);
      for (const v of Object.values(axes)) expect(v).toBe(3);
      expect(report.perScenario[0]!.judgeSalvaged).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("wires the file's jury into the openai-compatible path (--judge llm shorthand)", async () => {
    const { dir, path } = await tempJudgeFile({
      providerType: "rule",
      modelName: "rule",
      jury: [
        { providerType: "openai-compatible", modelName: "a", label: "one" },
        { providerType: "openai-compatible", modelName: "b", label: "two" },
      ],
    });
    try {
      const report = await runBench({ mode: "mock", judge: "llm", limit: 1, args: ["--judge-config", path] });
      expect(juryJudge).toHaveBeenCalledTimes(1);
      const configs = (juryJudge as ReturnType<typeof vi.fn>).mock.calls[0]![2] as Array<{ model: string; label?: string }>;
      expect(configs.map((c) => c.label)).toEqual(["one", "two"]);
      expect(report.perScenario[0]!.axisScores.in_character).toBe(4);
      // The jury verdict's provenance rides into the report (failed-juror
      // visibility from #77/#81) — a degraded jury must be traceable.
      expect(report.perScenario[0]!.juryVoterCount).toBe(1);
      expect(report.perScenario[0]!.juryFailed).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects --per-turn combined with a configured jury instead of silently ignoring it", async () => {
    const { dir, path } = await tempJudgeFile({
      providerType: "rule",
      modelName: "rule",
      jury: [{ providerType: "openai-compatible", modelName: "a", label: "one" }],
    });
    try {
      await expect(
        runBench({ mode: "mock", judge: "llm", perTurn: true, limit: 1, args: ["--judge-config", path] }),
      ).rejects.toThrow(/--per-turn cannot be combined with a configured jury/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the rule judge when the file says rule and no shorthand is passed", async () => {
    const { dir, path } = await tempJudgeFile({ providerType: "rule", modelName: "rule" });
    try {
      const report = await runBench({ mode: "mock", limit: 1, args: ["--judge-config", path] });
      // The file's providerType decides — the jury must not have been
      // consulted and the rule judge must have scored the (empty) artifact.
      expect(juryJudge).not.toHaveBeenCalled();
      expect(report.perScenario[0]!.judgeSalvaged).toBe(false);
      expect(Object.keys(report.perScenario[0]!.axisScores).length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
