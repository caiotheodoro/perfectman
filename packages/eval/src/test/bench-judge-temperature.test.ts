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
      recoveredFallbacks: 0,
      probeResults: [],
      signalResults: [],
      passedSignals: 0,
      totalSignals: 0,
      latencyMs: 1,
      pulseResults: 1,
      promptVersions: [],
      templateVersions: [],
    }),
  },
}));

// Narration itself is real code (not under test here), but since narrator.ts
// now always attempts an LLM call (no more silent skip-when-no-key — that
// was the "narratives read empty" bug), leaving this unmocked makes bench.ts
// try a real network call to a local Ollama that isn't running in CI.
vi.mock("../narrator/narrator.js", () => ({
  narrateScene: vi.fn().mockResolvedValue({
    title: "T", recap: "R", hiddenShift: "H", narrator: "rule",
  }),
}));

vi.mock("../judge/judge.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../judge/judge.js")>();
  return {
    ...actual,
    llmJudge: vi.fn().mockResolvedValue({ axes: { in_character: 4 }, salvaged: false, imputedAxes: [] }),
    judgeNarration: vi.fn().mockResolvedValue({ axes: { concreteness: 4 }, salvaged: false, imputedAxes: [] }),
  };
});

const { runBench } = await import("../cli/bench.js");
const { llmJudge, judgeNarration } = await import("../judge/judge.js");

/**
 * calibrate.ts already passes `{ defaultTemperature: 0 }` specifically
 * because a judge sampling creatively cannot be a trustworthy calibration
 * gate — the same transcript can score wildly differently run to run for
 * reasons that have nothing to do with quality. bench.ts's judge calls
 * (transcript AND narration) must default the same way, or its
 * calibration/axis-mean numbers are noise, not signal.
 */
describe("runBench judge temperature defaults to 0 (deterministic judging, same reasoning as calibrate.ts)", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("passes temperature 0 to the transcript judge and the narration judge by default", async () => {
    await runBench({ mode: "mock", judge: "llm", limit: 1 });

    const judgeConfigArg = (llmJudge as ReturnType<typeof vi.fn>).mock.calls[0]![2] as { temperature?: number };
    expect(judgeConfigArg.temperature).toBe(0);

    const narrationConfigArg = (judgeNarration as ReturnType<typeof vi.fn>).mock.calls[0]![3] as { temperature?: number };
    expect(narrationConfigArg.temperature).toBe(0);
  });

  it("still honors an explicit PERFECTMAN_JUDGE_TEMPERATURE override", async () => {
    vi.stubEnv("PERFECTMAN_JUDGE_TEMPERATURE", "0.9");

    await runBench({ mode: "mock", judge: "llm", limit: 1 });

    const judgeConfigArg = (llmJudge as ReturnType<typeof vi.fn>).mock.calls[0]![2] as { temperature?: number };
    expect(judgeConfigArg.temperature).toBe(0.9);
  });
});
