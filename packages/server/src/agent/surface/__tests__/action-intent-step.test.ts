import { describe, it, expect, vi } from "vitest";
import type { AgentRuntimeInput, CommittedEvent, LLMProviderResult } from "@perfectman/shared";
import type { LLMConfig } from "../../llm/llm-config.js";
import { ActionIntentStep } from "../action-intent-step.js";
import { llmSurfaceRegistry } from "../index.js";
import type { StepRunContext } from "../llm-step.js";

function jsonResponse(content: string, promptTokens = 50, completionTokens = 10): LLMProviderResult {
  return {
    content,
    usage: { inputTokens: promptTokens, outputTokens: completionTokens },
    latencyMs: 5,
    model: "mock-model",
    requestedModel: "mock-model",
    routedModel: "mock-model",
    fallbackAttempts: 0,
  };
}

const REPEAT_TEXT = "kkkk sou eu de novo";

function makeInput(overrides: Partial<AgentRuntimeInput> = {}): AgentRuntimeInput {
  return {
    simulationId: "sim-1",
    agentId: "agent-a",
    budgetPriority: "normal",
    availableActions: [
      { intentType: "no_op" as const, channelTargets: [], personTargets: [], blocked: false },
      {
        intentType: "send_message" as const,
        channelTargets: ["general"],
        personTargets: [],
        blocked: false,
      },
    ],
    perceptionPacket: {
      agentId: "agent-a",
      triggeringEvent: null,
      visibleContextEvents: [],
      eventHandles: {},
      ownRecentUtterances: [REPEAT_TEXT],
      involvedPeople: [],
      relevantChannels: ["general"],
      relevantMemories: [],
      translatedEmotionalState: {
        moodDescription: "Feeling neutral.",
        socialContext: "Calm.",
        relationalFlavors: [],
        pressureDescriptions: [],
        inhibitionDescriptions: [],
      },
      availableActions: [],
    },
    ...overrides,
  };
}

function sendMessageJson(visibleContent: string): string {
  return JSON.stringify({
    intentType: "send_message",
    channelTarget: "general",
    visibleContent,
    privateMotiveSummary: "A real reason.",
    emotionDrivers: [],
    motivationDrivers: [],
  });
}

const llmConfig = {
  providerType: "mock",
  modelName: "mock-model",
  baseUrl: "http://localhost",
  temperature: 1,
  maxOutputTokens: 256,
  timeoutMs: 5000,
  retryCount: 0,
  responseFormatJson: true,
} as LLMConfig;

const prompt = {
  system: "sys",
  user: "user",
  inputTokensEstimate: 25,
  purpose: "action_intent" as const,
  version: "v-test",
};

function runStep(
  provider: { generateIntent: unknown },
  input: AgentRuntimeInput = makeInput(),
): Promise<ReturnType<ActionIntentStep["execute"]>> {
  const step = new ActionIntentStep();
  const ctx: StepRunContext = {
    now: 1000,
    pulseIndex: 3,
    provider: provider as StepRunContext["provider"],
    llmConfig,
    profile: {} as StepRunContext["profile"],
    prompt,
  };
  return step.execute(input, ctx);
}

describe("ActionIntentStep", () => {
  it("is registered for the action_intent purpose with a stable label", () => {
    const step = new ActionIntentStep();
    expect(step.purpose).toBe("action_intent");
    expect(step.label).toBe("action_intent");
  });

  it("registry exposes only implemented surfaces and each entry conforms to LLMStep", () => {
    // Fail-closed: adding a new prompt purpose must be an explicit registry entry.
    expect(Object.keys(llmSurfaceRegistry).sort()).toEqual(["action_intent"]);
    for (const step of Object.values(llmSurfaceRegistry)) {
      expect(typeof step.purpose).toBe("string");
      expect(typeof step.label).toBe("string");
      expect(typeof step.render).toBe("function");
      expect(typeof step.gate).toBe("function");
      expect(typeof step.execute).toBe("function");
    }
  });

  it("returns ok with a composed intent and no fallback on a valid model answer", async () => {
    const outcome = await runStep({
      generateIntent: vi.fn().mockResolvedValue(
        jsonResponse(
          JSON.stringify({ intentType: "no_op", privateMotiveSummary: "Staying quiet.", emotionDrivers: [], motivationDrivers: [] }),
        ),
      ),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(false);
    expect(outcome.value.intent.intentType).toBe("no_op");
    expect(outcome.value.llmUsage?.inputTokens).toBe(50);
  });

  it("returns a typed failure outcome with a fallback intent when the provider throws", async () => {
    const outcome = await runStep({
      generateIntent: vi.fn().mockRejectedValue(new Error("connection reset")),
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.fallback.fallbackApplied).toBe(true);
    expect(outcome.fallback.intent.intentType).toBe("no_op");
    const failure = outcome.fallback.operatorEvents.find((e) => e.type === "llm_failure");
    expect(failure?.detail).toContain("connection reset");
  });

  it("carries an in-band parse fallback (controlled disposition, not a thrown error)", async () => {
    const outcome = await runStep({
      generateIntent: vi.fn().mockResolvedValue(jsonResponse("not json at all")),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(true);
    expect(outcome.value.intent.intentType).toBe("no_op");
    expect(outcome.value.operatorEvents.some((e) => e.type === "llm_failure")).toBe(true);
  });

  it("recovers from a repeated first answer via a single retry that returns new content", async () => {
    const provider = {
      generateIntent: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(sendMessageJson(REPEAT_TEXT), 50, 10))
        .mockResolvedValueOnce(jsonResponse(sendMessageJson("falando de outra coisa agora"), 60, 15)),
    };
    const outcome = await runStep(provider);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(false);
    expect(outcome.value.intent.visibleContent).toBe("falando de outra coisa agora");
    // Both calls' tokens are summed in budget + telemetry alike.
    expect(outcome.value.llmUsage?.inputTokens).toBe(110);
    expect(outcome.value.llmUsage?.outputTokens).toBe(25);
    // latency is also aggregated across main+retry
    expect(outcome.value.llmUsage?.latencyMs).toBe(10);
    const telemetry = outcome.value.operatorEvents.find((e) => e.type === "pulse_metrics");
    expect(telemetry?.data?.inputTokens).toBe(110);
    expect(telemetry?.data?.outputTokens).toBe(25);
    expect(provider.generateIntent).toHaveBeenCalledTimes(2);
  });

  it("blocks with intent_blocked (no llm_failure) when the retry still repeats", async () => {
    const provider = {
      generateIntent: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(sendMessageJson(REPEAT_TEXT)))
        .mockResolvedValueOnce(jsonResponse(sendMessageJson(REPEAT_TEXT))),
    };
    const outcome = await runStep(provider);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(true);
    expect(outcome.value.operatorEvents.some((e) => e.type === "intent_blocked")).toBe(true);
    expect(outcome.value.operatorEvents.some((e) => e.type === "llm_failure")).toBe(false);
  });

  it("reports llm_failure (not intent_blocked) when the retry returns unparseable content", async () => {
    const provider = {
      generateIntent: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(sendMessageJson(REPEAT_TEXT)))
        .mockResolvedValueOnce(jsonResponse("not json at all")),
    };
    const outcome = await runStep(provider);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(true);
    expect(outcome.value.operatorEvents.some((e) => e.type === "llm_failure")).toBe(true);
    expect(outcome.value.operatorEvents.some((e) => e.type === "intent_blocked")).toBe(false);
  });

  it("reports llm_failure (not intent_blocked) when the retry provider call throws", async () => {
    const provider = {
      generateIntent: vi
        .fn()
        .mockResolvedValueOnce(jsonResponse(sendMessageJson(REPEAT_TEXT)))
        .mockRejectedValueOnce(new Error("retry blew up")),
    };
    const outcome = await runStep(provider);

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.fallbackApplied).toBe(true);
    const failure = outcome.value.operatorEvents.find((e) => e.type === "llm_failure");
    expect(failure).toBeDefined();
    expect(outcome.value.operatorEvents.some((e) => e.type === "intent_blocked")).toBe(false);
  });

  describe("reply/reaction target resolution", () => {
    const trigger: CommittedEvent = {
      id: "evt_trigger",
      simulationId: "sim-1",
      channelId: "general",
      actorId: "agent-peer",
      type: "message_sent",
      payload: { content: "did you see this?" },
      createdAt: 1,
      pulseIndex: 2,
      sourceEventIds: [],
      emotionalSalience: "low",
      visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
    };

    function targetInput(overrides: Partial<AgentRuntimeInput["perceptionPacket"]> = {}): AgentRuntimeInput {
      const base = makeInput({
        availableActions: [
          { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
          { intentType: "send_message", channelTargets: ["general"], personTargets: [], blocked: false },
          { intentType: "reply_to_message", channelTargets: ["general"], personTargets: ["agent-peer"], blocked: false },
          { intentType: "react", channelTargets: ["general"], personTargets: [], blocked: false },
        ],
      });
      return {
        ...base,
        perceptionPacket: {
          ...base.perceptionPacket,
          ownRecentUtterances: [],
          triggeringEvent: trigger,
          visibleContextEvents: [trigger],
          eventHandles: { e1: "evt_trigger" },
          ...overrides,
        },
      };
    }

    function replyJson(replyToEventId: string): string {
      return JSON.stringify({
        intentType: "reply_to_message",
        channelTarget: "general",
        personTargets: ["agent-peer"],
        visibleContent: "yes I did",
        replyToEventId,
        privateMotiveSummary: "engage",
        emotionDrivers: [],
        motivationDrivers: [],
      });
    }

    it("commits a valid-handle reply with the real event id and resolved actor, no retry", async () => {
      const provider = { generateIntent: vi.fn().mockResolvedValue(jsonResponse(replyJson("e1"))) };
      const outcome = await runStep(provider, targetInput());

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.fallbackApplied).toBe(false);
      expect(outcome.value.intent.intentType).toBe("reply_to_message");
      expect(outcome.value.intent.replyToEventId).toBe("evt_trigger");
      expect(outcome.value.intent.replyToActorId).toBe("agent-peer");
      expect(provider.generateIntent).toHaveBeenCalledTimes(1);
    });

    it("retries exactly once with a correction note naming the bad handle, then accepts a corrected handle", async () => {
      const provider = {
        generateIntent: vi
          .fn()
          .mockResolvedValueOnce(jsonResponse(replyJson("marianas-message")))
          .mockResolvedValueOnce(jsonResponse(replyJson("e1"))),
      };
      const outcome = await runStep(provider, targetInput());

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(provider.generateIntent).toHaveBeenCalledTimes(2);
      const retryPrompt = provider.generateIntent.mock.calls[1]![2] as { system: string };
      expect(retryPrompt.system).toContain("marianas-message");
      expect(retryPrompt.system).toContain("e1");
      expect(retryPrompt.system).toContain("send_message");
      expect(outcome.value.fallbackApplied).toBe(false);
      expect(outcome.value.intent.replyToEventId).toBe("evt_trigger");
      expect(outcome.value.intent.replyToActorId).toBe("agent-peer");
    });

    it("falls to the triggering-event floor after one failed retry (no empty target committed)", async () => {
      const provider = {
        generateIntent: vi
          .fn()
          .mockResolvedValueOnce(jsonResponse(replyJson("bogus-1")))
          .mockResolvedValueOnce(jsonResponse(replyJson("bogus-2"))),
      };
      const outcome = await runStep(provider, targetInput());

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(provider.generateIntent).toHaveBeenCalledTimes(2);
      expect(outcome.value.intent.intentType).toBe("reply_to_message");
      expect(outcome.value.intent.replyToEventId).toBe("evt_trigger");
      expect(outcome.value.intent.replyToActorId).toBe("agent-peer");
      expect(outcome.value.fallbackApplied).toBe(false);

      const floorEvent = outcome.value.operatorEvents.find((e) => e.type === "target_resolution_floored");
      expect(floorEvent).toBeDefined();
      expect(floorEvent!.detail).toContain("bogus-1");
      expect(floorEvent!.data).toMatchObject({
        field: "replyToEventId",
        badHandle: "bogus-1",
        outcome: "triggering_or_visible_event",
        resolvedEventId: "evt_trigger",
      });
      expect(outcome.value.operatorEvents.some((e) => e.type === "llm_failure")).toBe(false);
    });

    it("drops a reaction with an unresolvable target and no triggering event / visible message", async () => {
      const reactJson = JSON.stringify({
        intentType: "react",
        channelTarget: "general",
        emoji: "🔥",
        targetEventId: "some-slug",
        privateMotiveSummary: "approve",
        emotionDrivers: [],
        motivationDrivers: [],
      });
      const provider = { generateIntent: vi.fn().mockResolvedValue(jsonResponse(reactJson)) };
      const outcome = await runStep(
        provider,
        targetInput({ triggeringEvent: null, visibleContextEvents: [], eventHandles: {} }),
      );

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.intent.intentType).toBe("no_op");
      expect(outcome.value.intent.targetEventId).toBeUndefined();
      expect(outcome.value.fallbackApplied).toBe(true);
      expect(outcome.value.operatorEvents.some((e) => e.type === "llm_failure")).toBe(true);
    });

    it("downgrades a reply to send_message when there is no event to target", async () => {
      const provider = { generateIntent: vi.fn().mockResolvedValue(jsonResponse(replyJson("nope"))) };
      const outcome = await runStep(
        provider,
        targetInput({ triggeringEvent: null, visibleContextEvents: [], eventHandles: {} }),
      );

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.value.intent.intentType).toBe("send_message");
      expect(outcome.value.intent.replyToEventId).toBeUndefined();
      expect(outcome.value.intent.visibleContent).toBe("yes I did");

      const floorEvent = outcome.value.operatorEvents.find((e) => e.type === "target_resolution_floored");
      expect(floorEvent).toBeDefined();
      expect(floorEvent!.data).toMatchObject({
        field: "replyToEventId",
        badHandle: "nope",
        outcome: "downgraded_to_send_message",
      });
      expect(floorEvent!.data?.resolvedEventId).toBeUndefined();
    });
  });
});
