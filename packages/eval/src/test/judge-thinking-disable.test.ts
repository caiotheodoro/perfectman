import { describe, it, expect, vi, afterEach } from "vitest";
import { llmJudge, judgeNarration, llmJudgePerTurn } from "../judge/judge.js";
import { getScenario, type CommittedEvent } from "@perfectman/shared";
import type { Narration } from "../narrator/narrator.js";

const scenario = getScenario("v1_casual_chat")!;

// Root-caused via a real capture: a deepseek-v4-flash judge call returned
// completely empty content (raw length 0) — every judge call site sent no
// way to disable deepseek-v4's hidden reasoning phase, the same failure
// already fixed for the agent path and the narrator, just never applied
// here. All three call sites (transcript judge, narration judge, per-turn
// cohesion judge) share the fix via `deepseekV4ExtraBody`.
describe("judge deepseek-v4 thinking-disable", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubOk(content: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: unknown, init?: { body?: string }) => {
        const body = init?.body ? (JSON.parse(init.body) as { thinking?: unknown }) : {};
        (globalThis as { __lastBody?: unknown }).__lastBody = body;
        return Promise.resolve(
          new Response(
            JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : "" } }] }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }),
    );
  }

  it("llmJudge disables thinking for a deepseek-v4 model", async () => {
    stubOk('{"axes": {"in_character": 4}}');
    await llmJudge(scenario, [], { baseUrl: "http://x/v1", model: "deepseek/deepseek-v4-flash" });
    expect((globalThis as { __lastBody?: { thinking?: unknown } }).__lastBody?.thinking).toEqual({
      type: "disabled",
    });
  });

  it("llmJudge does not send thinking for a non-deepseek-v4 model", async () => {
    stubOk('{"axes": {"in_character": 4}}');
    await llmJudge(scenario, [], { baseUrl: "http://x/v1", model: "qwen3:8b" });
    expect((globalThis as { __lastBody?: { thinking?: unknown } }).__lastBody?.thinking).toBeUndefined();
  });

  it("judgeNarration disables thinking for a deepseek-v4 model", async () => {
    stubOk('{"axes": {"concreteness": 4}}');
    const narration: Narration = { title: "T", recap: "R", hiddenShift: "H", narrator: "llm" };
    await judgeNarration(scenario, [], narration, { baseUrl: "http://x/v1", model: "deepseek/deepseek-v4-flash" });
    expect((globalThis as { __lastBody?: { thinking?: unknown } }).__lastBody?.thinking).toEqual({
      type: "disabled",
    });
  });

  it("llmJudgePerTurn's cohesion pass disables thinking for a deepseek-v4 model", async () => {
    stubOk('{"axes": {"in_character": 4, "narrative_cohesion": 4}}');
    const events: CommittedEvent[] = [
      {
        id: "e1", simulationId: "s", channelId: "c", actorId: "caio", type: "message_sent",
        payload: { content: "oi" }, sourceEventIds: [], emotionalSalience: "medium", pulseIndex: 0,
        visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "x" },
        createdAt: 0,
      },
      {
        id: "e2", simulationId: "s", channelId: "c", actorId: "leo", type: "reply_sent",
        payload: { content: "e ai" }, sourceEventIds: [], emotionalSalience: "medium", pulseIndex: 1,
        visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "x" },
        createdAt: 0,
      },
    ];
    // Reset __lastBody so the assertion checks the LAST call (the cohesion
    // pass), not the first (the whole-transcript llmJudge call it wraps).
    await llmJudgePerTurn(scenario, events, { baseUrl: "http://x/v1", model: "deepseek/deepseek-v4-flash" });
    expect((globalThis as { __lastBody?: { thinking?: unknown } }).__lastBody?.thinking).toEqual({
      type: "disabled",
    });
  });
});
