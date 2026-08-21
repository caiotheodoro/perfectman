import { describe, it, expect, vi, afterEach } from "vitest";
import { salvageAxisScoresFromProse, llmJudge } from "../judge/judge.js";
import { getScenario } from "@perfectman/shared";

const scenario = getScenario("v1_casual_chat")!;
const axisIds = scenario.rubric.axes.map(a => a.id);

describe("salvageAxisScoresFromProse", () => {
  it("recovers scores from a markdown prose critique", () => {
    const raw = `**Roleplay Quality Score Summary**

1. Character Development (2/5) — the agents barely evolved.
2. ${axisIds[0]} (4/5): stayed in persona.
Overall ${axisIds[1]}: 3 out of 5.`;
    const salvaged = salvageAxisScoresFromProse(raw, axisIds);
    // Only a couple of axes present → below the >= half threshold → null.
    if (axisIds.length > 4) {
      expect(salvaged).toBeNull();
    }
  });

  it("accepts when at least half the axes are recovered", () => {
    const half = Math.ceil(axisIds.length / 2);
    const lines = axisIds
      .slice(0, half)
      .map((id, i) => `**${id}**: ${(i % 5) + 1}/5 — some note`);
    const raw = `Roleplay Quality Score Summary\n\n${lines.join("\n")}`;
    const salvaged = salvageAxisScoresFromProse(raw, axisIds);
    expect(salvaged).not.toBeNull();
    for (const id of axisIds.slice(0, half)) {
      expect(salvaged![id]).toBeGreaterThanOrEqual(1);
      expect(salvaged![id]).toBeLessThanOrEqual(5);
    }
  });

  it("returns null when no axes are found at all", () => {
    expect(salvageAxisScoresFromProse("a lovely poem about the weather", axisIds)).toBeNull();
  });

  it("ignores scores outside the 1-5 range", () => {
    const lines = axisIds.map(id => `${id}: 42`).join("\n");
    expect(salvageAxisScoresFromProse(lines, axisIds)).toBeNull();
  });
});

describe("llmJudge parse-failure defenses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubResponses(contents: unknown[]): () => number {
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => {
        const content = contents[Math.min(call, contents.length - 1)];
        call++;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: typeof content === "string" ? content : "" } }],
          }),
        });
      }),
    );
    return () => call;
  }

  const config = { baseUrl: "http://localhost:11434/v1", model: "test-model" };

  it("parses fenced JSON with surrounding prose on the first pass", async () => {
    stubResponses(['Sure! Here you go:\n```json\n{"axes": {"in_character": 4}}\n```\nDone.']);
    const axes = await llmJudge(scenario, [], config);
    expect(axes["in_character"]).toBe(4);
    expect(Object.keys(axes).length).toBe(axisIds.length);
  });

  it("retries with a stricter instruction after unparseable output", async () => {
    const calls = stubResponses([
      "<think>I reasoned forever but never emitted JSON",
      '{"axes": {"in_character": 2}}',
    ]);
    const axes = await llmJudge(scenario, [], config);
    expect(calls()).toBe(2);
    expect(axes["in_character"]).toBe(2);
  });

  it("falls back to prose salvage when both passes fail unparseably", async () => {
    const half = Math.ceil(axisIds.length / 2);
    const prose =
      "**Roleplay Quality Score Summary**\n\n" +
      axisIds
        .slice(0, half)
        .map((id, i) => `${id} (${(i % 5) + 1}/5) note`)
        .join("\n");
    stubResponses([prose]);
    const axes = await llmJudge(scenario, [], config);
    expect(axes[axisIds[0]!]).toBeDefined();
  });

  it("throws honestly when every defense fails", async () => {
    stubResponses(["<think>truncated mid-thought with no answer at all"]);
    await expect(llmJudge(scenario, [], config)).rejects.toThrow(/unparseable response after retry/);
  });
});
