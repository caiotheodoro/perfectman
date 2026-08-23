import { describe, it, expect, afterEach, vi } from "vitest";
import { juryJudge } from "../judge/judge.js";
import { getScenario } from "@perfectman/shared";

const scenario = getScenario("v1_casual_chat")!;

const baseConfig = {
  baseUrl: "http://judge-host/v1",
  model: "test-model",
};

describe("juryJudge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const configs = [
    { ...baseConfig, model: "family-a", label: "family-a" },
    { ...baseConfig, model: "family-b", label: "family-b" },
    { ...baseConfig, model: "family-c", label: "family-c" },
  ];

  it("returns per-axis medians with per-judge scores for divergence inspection", async () => {
    // Route by model so fixtures are deterministic under allSettled
    // concurrency regardless of call ordering inside callJudge.
    const fetchMock = vi.fn().mockImplementation((_url: unknown, init?: { body?: string }) => {
      const model = JSON.parse(init?.body ?? "{}").model as string;
      const axes =
        model === "family-a" ? { in_character: 2, voice_match: 3 }
        : model === "family-b" ? { in_character: 4, voice_match: 3 }
        : { in_character: 5, voice_match: 3 };
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Map(),
        json: async () => ({ choices: [{ message: { content: JSON.stringify({ axes }) } }] }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const verdict = await juryJudge(scenario, [], configs);
    expect(verdict.axes["in_character"]).toBe(4);
    expect(verdict.axes["voice_match"]).toBe(3);
    expect(verdict.voterCount).toBe(3);
    expect(Object.keys(verdict.perJudge).sort()).toEqual(["family-a", "family-b", "family-c"]);
    expect(verdict.perJudge["family-a"]!.axes.in_character).toBe(2);
    expect(verdict.perJudge["family-a"]!.salvaged).toBe(false);
    // the evidence trail records each juror's source
    expect(verdict.perJudge["family-a"]!.model).toBe("family-a");
    expect(verdict.perJudge["family-a"]!.baseUrl).toBe("http://judge-host/v1");
    expect(verdict.failed).toEqual({});
    // One fetch per judge, no retry: a parse-failure retry inside llmJudge
    // would shift the per-judge response mapping and this assertion reds.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resists a single biased outlier via the median", async () => {
    // family-c inflates everything; the median ignores it.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: unknown, init?: { body?: string }) => {
        const model = JSON.parse(init?.body ?? "{}").model as string;
        const axes = model === "family-c" ? { in_character: 5 } : { in_character: 3 };
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({ choices: [{ message: { content: JSON.stringify({ axes }) } }] }),
        });
      }),
    );
    const verdict = await juryJudge(scenario, [], configs);
    expect(verdict.axes["in_character"]).toBe(3);
  });

  it("keeps even-voter medians on the shared integer score domain", async () => {
    // 4 voters [2,3,4,4] -> median 3.5 -> clamped to 4, NOT a fractional
    // 3.5: fractional AxisScores would inflate kappa categories if a verdict
    // ever reached computeCalibration (all other scores are integers in [1,5]).
    const four = [
      { ...baseConfig, model: "j1", label: "j1" },
      { ...baseConfig, model: "j2", label: "j2" },
      { ...baseConfig, model: "j3", label: "j3" },
      { ...baseConfig, model: "j4", label: "j4" },
    ];
    const scores: Record<string, number> = { j1: 2, j2: 3, j3: 4, j4: 4 };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: unknown, init?: { body?: string }) => {
        const model = JSON.parse(init?.body ?? "{}").model as string;
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ axes: { in_character: scores[model]! } }) } }],
          }),
        });
      }),
    );
    const verdict = await juryJudge(scenario, [], four);
    expect(verdict.voterCount).toBe(4);
    expect(verdict.axes["in_character"]).toBe(4);
    expect(Number.isInteger(verdict.axes["in_character"])).toBe(true);
  });

  it("drops failed judges, records the reason, and still reaches a verdict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: unknown, init?: { body?: string }) => {
        const model = JSON.parse(init?.body ?? "{}").model as string;
        if (model === "family-a") {
          return Promise.resolve({ ok: false, status: 500, text: async () => "boom" });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({ choices: [{ message: { content: JSON.stringify({ axes: { in_character: 4 } }) } }] }),
        });
      }),
    );
    // Full configs: family-a IS in the jury and failing — passing a sliced
    // list would make the drops-failed path run zero times (regression pin
    // for a vacuous version of this test).
    const verdict = await juryJudge(scenario, [], configs);
    expect(Object.keys(verdict.perJudge)).toEqual(["family-b", "family-c"]);
    expect(Object.keys(verdict.failed)).toEqual(["family-a"]);
    expect(verdict.failed["family-a"]).toContain("500");
    expect(verdict.axes["in_character"]).toBe(4);
  });

  it("excludes axes a juror omitted from its JSON answer (imputed 3s never vote)", async () => {
    // family-a answers ONLY in_character; parseAxes fills the other seven
    // axes with 3 behind the scenes. Those 3s must not move the medians on
    // axes family-a never scored — with voice_match 5 and 3 from the other
    // two, the median is 4, NOT 3 (3,5,3).
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: unknown, init?: { body?: string }) => {
        const model = JSON.parse(init?.body ?? "{}").model as string;
        const axes =
          model === "family-a" ? { in_character: 4 }
          : model === "family-b" ? { voice_match: 5 }
          : { voice_match: 3 };
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({ choices: [{ message: { content: JSON.stringify({ axes }) } }] }),
        });
      }),
    );
    const verdict = await juryJudge(scenario, [], configs);
    expect(verdict.axes["in_character"]).toBe(4);
    expect(verdict.axes["voice_match"]).toBe(4); // b=5, c=3, a's imputed 3 excluded
    expect(verdict.perJudge["family-a"]!.imputedAxes).toContain("voice_match");
    expect(verdict.failed).toEqual({});
  });

  it("rejects same-endpoint jurors: three qwen3:8b configs are not a jury", async () => {
    await expect(
      juryJudge(scenario, [], [
        { baseUrl: "http://o:11434/v1", model: "qwen3:8b", label: "clone-1" },
        { baseUrl: "http://o:11434/v1", model: "qwen3:8b", label: "clone-2" },
      ]),
    ).rejects.toThrow(/Duplicate jury judge endpoint .* independently sourced/);
  });

  it("throws honestly when every judge fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "down" }),
    );
    await expect(juryJudge(scenario, [], configs)).rejects.toThrow(/All jury judges failed/);
  });

  it("requires at least one config", async () => {
    await expect(juryJudge(scenario, [], [])).rejects.toThrow(/at least one judge config/);
  });

  it("throws on duplicate labels instead of collapsing two votes into one", async () => {
    await expect(
      juryJudge(scenario, [], [
        { ...baseConfig, label: "same" },
        { ...baseConfig, label: "same" },
      ]),
    ).rejects.toThrow(/Duplicate jury judge labels: same/);
  });

  it("excludes salvaged jurors from medians while still reporting them", async () => {
    // Salvage fires when both passes return unparseable prose. Route by
    // request body — Promise.allSettled makes call order nondeterministic.
    const axisIds = scenario.rubric.axes.map(a => a.id);
    const half = Math.ceil(axisIds.length / 2) + 1;
    const prose =
      "**Scores**\n\n" +
      axisIds
        .slice(0, half)
        .map((id, i) => `${id} (${(i % 5) + 1}/5) note`)
        .join("\n");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: unknown, init?: { body?: string }) => {
        const body = init?.body ?? "";
        const isSalvageJuror = body.includes('"model":"salvage-model"');
        const content = isSalvageJuror
          ? prose
          : JSON.stringify({ axes: { in_character: 4 } });
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({ choices: [{ message: { content } }] }),
        });
      }),
    );

    const verdict = await juryJudge(scenario, [], [
      { ...baseConfig, label: "family-a", model: "salvage-model" },
      { ...baseConfig, label: "family-b", model: "clean-b" },
      { ...baseConfig, label: "family-c", model: "clean-c" },
    ]);

    expect(verdict.perJudge["family-a"]!.salvaged).toBe(true);
    // The salvaged juror's imputed defaults must NOT drag the median.
    expect(verdict.axes["in_character"]).toBe(4);
  });

  it("throws when every surviving judge required salvage", async () => {
    const axisIds = scenario.rubric.axes.map(a => a.id);
    const half = Math.ceil(axisIds.length / 2) + 1;
    const prose =
      "**Scores**\n\n" +
      axisIds
        .slice(0, half)
        .map((id, i) => `${id} (${(i % 5) + 1}/5) note`)
        .join("\n");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Map(),
          json: async () => ({ choices: [{ message: { content: prose } }] }),
        }),
      ),
    );
    await expect(juryJudge(scenario, [], configs)).rejects.toThrow(/required prose salvage/);
  });
});
