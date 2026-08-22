import { describe, it, expect, afterEach, vi } from "vitest";
import { juryJudge } from "../judge/judge.js";
import { getScenario } from "@perfectman/shared";

const scenario = getScenario("v1_casual_chat")!;

const baseConfig = {
  baseUrl: "http://judge-host/v1",
  model: "test-model",
};

function stubJudgeResponses(responses: Array<Record<string, number>>): void {
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => {
      const axes = responses[Math.min(call, responses.length - 1)]!;
      call++;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ axes }) } }],
        }),
      });
    }),
  );
}

describe("juryJudge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const configs = [
    { ...baseConfig, label: "family-a" },
    { ...baseConfig, label: "family-b" },
    { ...baseConfig, label: "family-c" },
  ];

  it("returns per-axis medians with per-judge scores for divergence inspection", async () => {
    stubJudgeResponses([
      { in_character: 2, voice_match: 3 },
      { in_character: 4, voice_match: 3 },
      { in_character: 5, voice_match: 3 },
    ]);
    const verdict = await juryJudge(scenario, [], configs);
    expect(verdict.axes["in_character"]).toBe(4);
    expect(verdict.axes["voice_match"]).toBe(3);
    expect(Object.keys(verdict.perJudge).sort()).toEqual(["family-a", "family-b", "family-c"]);
    expect(verdict.perJudge["family-a"]!.in_character).toBe(2);
  });

  it("resists a single biased outlier via the median", async () => {
    // family-c inflates everything; the median ignores it.
    stubJudgeResponses([
      { in_character: 3 },
      { in_character: 3 },
      { in_character: 5 },
    ]);
    const verdict = await juryJudge(scenario, [], configs);
    expect(verdict.axes["in_character"]).toBe(3);
  });

  it("drops failed judges and still reaches a verdict", async () => {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const fail = call === 0;
        call++;
        if (fail) return Promise.resolve({ ok: false, status: 500, text: async () => "boom" });
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: JSON.stringify({ axes: { in_character: 4 } }) } }],
          }),
        });
      }),
    );
    const verdict = await juryJudge(scenario, [], configs);
    expect(Object.keys(verdict.perJudge)).toHaveLength(2);
    expect(verdict.axes["in_character"]).toBe(4);
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
});
