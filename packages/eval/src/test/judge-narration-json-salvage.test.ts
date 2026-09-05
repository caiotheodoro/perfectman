import { describe, it, expect, vi, afterEach } from "vitest";
import { judgeNarration } from "../judge/judge.js";
import { NARRATIVE_RUBRIC, getScenario } from "@perfectman/shared";
import type { Narration } from "../narrator/narrator.js";

const scenario = getScenario("v1_casual_chat")!;
const axisIds = NARRATIVE_RUBRIC.axes.map(a => a.id);

const narration: Narration = {
  title: "Test",
  recap: "Test recap.",
  hiddenShift: "Test hidden shift.",
  narrator: "llm",
};

describe("judgeNarration parse-failure defenses (same skeleton as llmJudge)", () => {
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
        return Promise.resolve(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: typeof content === "string" ? content : "" } }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }),
    );
    return { calls: () => call, bodies: () => bodies };
  }

  const config = { baseUrl: "http://localhost:11434/v1", model: "test-model" };

  it("parses fenced JSON with surrounding prose on the first pass", async () => {
    stubResponses(['Sure! Here you go:\n```json\n{"axes": {"concreteness": 4}}\n```\nDone.']);
    const { axes, salvaged } = await judgeNarration(scenario, [], narration, config);
    expect(axes["concreteness"]).toBe(4);
    expect(Object.keys(axes).length).toBe(axisIds.length);
    expect(salvaged).toBe(false);
  });

  it("retries with a stricter instruction after unparseable output", async () => {
    const { calls, bodies } = stubResponses([
      "<think>I reasoned forever but never emitted JSON",
      '{"axes": {"concreteness": 2}}',
    ]);
    const { axes, salvaged } = await judgeNarration(scenario, [], narration, config);
    expect(calls()).toBe(2);
    expect(bodies()[1]!).toContain("not parseable JSON");
    expect(axes["concreteness"]).toBe(2);
    expect(salvaged).toBe(false);
  });

  it("falls back to prose salvage when both passes fail unparseably", async () => {
    const half = Math.ceil(axisIds.length / 2);
    const prose =
      "**Narration Quality Score Summary**\n\n" +
      axisIds
        .slice(0, half)
        .map((id, i) => `${id} (${(i % 5) + 1}/5) note`)
        .join("\n");
    stubResponses([prose]);
    const { axes, salvaged } = await judgeNarration(scenario, [], narration, config);
    expect(axes[axisIds[0]!]).toBeDefined();
    expect(salvaged).toBe(true);
  });

  it("throws honestly when every defense fails", async () => {
    stubResponses(["<think>truncated mid-thought with no answer at all"]);
    await expect(judgeNarration(scenario, [], narration, config)).rejects.toThrow(/unparseable response after retry/);
  });
});
