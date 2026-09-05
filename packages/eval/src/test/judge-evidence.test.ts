import { describe, it, expect, vi, afterEach } from "vitest";
import { llmJudge, judgeNarration, juryJudge } from "../judge/judge.js";
import { getScenario } from "@perfectman/shared";
import type { Narration } from "../narrator/narrator.js";

const scenario = getScenario("v1_casual_chat")!;

// The judge's output contract asks for one quote or [pNN] reference per
// axis so a score has to point at a line. It is requested, never required:
// a judge that answers only axes still parses, and only string evidence
// survives — a stray number or object is dropped, not stored.
describe("judge evidence field", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type Body = { model?: string; max_tokens?: number; messages?: Array<{ role: string; content: string }> };
  const bodies: Body[] = [];

  function stub(answer: (model: string | undefined) => unknown) {
    bodies.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: unknown, init?: { body?: string }) => {
        const body = init?.body ? (JSON.parse(init.body) as Body) : {};
        bodies.push(body);
        return Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer(body.model)) } }] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }),
    );
  }

  it("asks for evidence in the output contract", async () => {
    stub(() => ({ axes: { in_character: 4 } }));
    await llmJudge(scenario, [], { baseUrl: "http://x/v1", model: "m" });
    const system = bodies[0]?.messages?.find((m) => m.role === "system")?.content ?? "";
    expect(system).toContain('"evidence"');
    expect(system).toMatch(/\[pNN\]/);
  });

  it("parses per-axis evidence alongside axes", async () => {
    stub(() => ({
      axes: { in_character: 4, voice_match: 2 },
      evidence: { in_character: '[p03] "sexta que vem é rápido"', voice_match: 7, creativity_unhinged: "   " },
    }));
    const result = await llmJudge(scenario, [], { baseUrl: "http://x/v1", model: "m" });
    expect(result.axes.in_character).toBe(4);
    expect(result.evidence).toEqual({ in_character: '[p03] "sexta que vem é rápido"' });
  });

  it("tolerates a judge that omits evidence entirely", async () => {
    stub(() => ({ axes: { in_character: 4 } }));
    const result = await llmJudge(scenario, [], { baseUrl: "http://x/v1", model: "m" });
    expect(result.salvaged).toBe(false);
    expect(result.evidence).toEqual({});
  });

  it("sends config.maxTokens, defaulting to 1500 for the transcript and 1200 for narration", async () => {
    stub(() => ({ axes: { in_character: 4 } }));
    await llmJudge(scenario, [], { baseUrl: "http://x/v1", model: "m" });
    expect(bodies[0]?.max_tokens).toBe(1500);
    await llmJudge(scenario, [], { baseUrl: "http://x/v1", model: "m", maxTokens: 4000 });
    expect(bodies[1]?.max_tokens).toBe(4000);
    const narration: Narration = { title: "T", recap: "R", hiddenShift: "H", narrator: "llm" };
    stub(() => ({ axes: { concreteness: 4 } }));
    await judgeNarration(scenario, [], narration, { baseUrl: "http://x/v1", model: "m" });
    expect(bodies[0]?.max_tokens).toBe(1200);
    await judgeNarration(scenario, [], narration, { baseUrl: "http://x/v1", model: "m", maxTokens: 2500 });
    expect(bodies[1]?.max_tokens).toBe(2500);
  });

  it("jury: carries each juror's evidence and counts the votes behind every axis", async () => {
    // family-b omits voice_match: its median is a single vote from family-a
    // and axisVoterCounts must say so, while in_character has two.
    stub((model) =>
      model === "family-a"
        ? { axes: { in_character: 4, voice_match: 2 }, evidence: { in_character: "[p01] opens with the deadline" } }
        : { axes: { in_character: 2 } },
    );
    const verdict = await juryJudge(scenario, [], [
      { baseUrl: "http://judge-host/v1", model: "family-a", label: "family-a" },
      { baseUrl: "http://judge-host/v1", model: "family-b", label: "family-b" },
    ]);
    expect(verdict.axisVoterCounts.in_character).toBe(2);
    expect(verdict.axisVoterCounts.voice_match).toBe(1);
    expect(verdict.axes.voice_match).toBe(2);
    expect(verdict.perJudge["family-a"]!.evidence).toEqual({ in_character: "[p01] opens with the deadline" });
    expect(verdict.perJudge["family-b"]!.evidence).toBeUndefined();
    // an axis nobody scored is absent, never a fabricated 3
    expect(verdict.axes.creativity_unhinged).toBeUndefined();
    expect(verdict.axisVoterCounts.creativity_unhinged).toBeUndefined();
  });
});
