import { describe, it, expect, vi, afterEach } from "vitest";
import { salvageAxisScoresFromProse, llmJudge } from "../judge/judge.js";
import { getScenario } from "@perfectman/shared";

const scenario = getScenario("v1_casual_chat")!;
const axisIds = scenario.rubric.axes.map(a => a.id);

describe("salvageAxisScoresFromProse", () => {
  it("rejects salvage when fewer than half the axes are recovered", () => {
    // Strictly below the >= half threshold for any rubric size.
    const fewCount = Math.max(1, Math.floor(axisIds.length / 2) - 1);
    const lines = axisIds
      .slice(0, fewCount)
      .map((id, i) => `**${id}**: ${(i % 5) + 1}/5 — some note`);
    const raw = `Roleplay Quality Score Summary\n\n${lines.join("\n")}`;
    expect(salvageAxisScoresFromProse(raw, axisIds)).toBeNull();
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

  it("ignores matched numbers outside the 1-5 range", () => {
    // "6" matches the single-digit capture but must be rejected by the
    // range guard (unlike "42", which the regex never captures at all).
    const lines = axisIds.map(id => `${id}: 6`).join("\n");
    expect(salvageAxisScoresFromProse(lines, axisIds)).toBeNull();
  });

  it("does not fabricate scores from the next line's list numbering", () => {
    // Each axis id is immediately followed by prose with no score, and the
    // *next* line happens to start with a markdown list number — that
    // number must never be read as this axis's score.
    const lines = axisIds.map((id, i) => `**${i + 1}. ${id}** — no numeric score here`);
    const raw = `Roleplay Quality Score Summary\n\n${lines.join("\n")}`;
    expect(salvageAxisScoresFromProse(raw, axisIds)).toBeNull();
  });
});

describe("llmJudge parse-failure defenses", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubResponses(contents: unknown[]): { calls: () => number; bodies: () => string[] } {
    let call = 0;
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: unknown, init?: { body?: string }) => {
        const content = contents[Math.min(call, contents.length - 1)];
        call++;
        bodies.push(init?.body ?? "");
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: typeof content === "string" ? content : "" } }],
          }),
        });
      }),
    );
    return { calls: () => call, bodies: () => bodies };
  }

  const config = { baseUrl: "http://localhost:11434/v1", model: "test-model" };

  it("parses fenced JSON with surrounding prose on the first pass", async () => {
    stubResponses(['Sure! Here you go:\n```json\n{"axes": {"in_character": 4}}\n```\nDone.']);
    const { axes, salvaged } = await llmJudge(scenario, [], config);
    expect(axes["in_character"]).toBe(4);
    expect(Object.keys(axes).length).toBe(axisIds.length);
    expect(salvaged).toBe(false);
  });

  it("retries with a stricter instruction after unparseable output", async () => {
    const { calls, bodies } = stubResponses([
      "<think>I reasoned forever but never emitted JSON",
      '{"axes": {"in_character": 2}}',
    ]);
    const { axes, salvaged } = await llmJudge(scenario, [], config);
    expect(calls()).toBe(2);
    expect(bodies()[1]!).toContain("not parseable JSON");
    expect(axes["in_character"]).toBe(2);
    expect(salvaged).toBe(false);
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
    const { axes, salvaged } = await llmJudge(scenario, [], config);
    expect(axes[axisIds[0]!]).toBeDefined();
    expect(salvaged).toBe(true);
  });

  it("throws honestly when every defense fails", async () => {
    stubResponses(["<think>truncated mid-thought with no answer at all"]);
    await expect(llmJudge(scenario, [], config)).rejects.toThrow(/unparseable response after retry/);
  });
});
