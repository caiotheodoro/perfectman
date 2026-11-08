import { describe, it, expect, vi } from "vitest";
import type { AgentRuntimeInput, CommittedEvent, LLMProviderResult } from "@perfectman/shared";
import type { LLMConfig } from "../../../llm/llm-config.js";
import { ActionIntentStep, aimedElsewhereNote, answerOwedNote } from "../action-intent-step.js";
import type { StepRunContext } from "../llm-step.js";

const reply = (raw: Record<string, unknown>): LLMProviderResult => ({
  content: JSON.stringify({ privateMotiveSummary: "A real reason.", emotionDrivers: [], motivationDrivers: [], ...raw }),
  usage: { inputTokens: 50, outputTokens: 10 },
  latencyMs: 5,
  model: "m",
  requestedModel: "m",
  routedModel: "m",
  fallbackAttempts: 0,
});

/** Run 11, Enzo: asked by a guest, the model answers with a reaction aimed at somebody else. */
const reactToOther = reply({ intentType: "react", channelTarget: "general", personTargets: ["agent-c"], reactionEmoji: "👍" });
const wordsToOther = reply({ intentType: "send_message", channelTarget: "general", personTargets: ["agent-b"], visibleContent: "Enzo, ainda bem que você começou isso." });
const wordsToGuest = reply({ intentType: "reply_to_message", channelTarget: "general", replyToEventId: "g1", visibleContent: "Gosto do jeito que a música toma conta do salão." });

const line = (id: string, actorId: string, content: string, extra: Record<string, unknown> = {}): CommittedEvent =>
  ({
    id,
    simulationId: "sim-1",
    channelId: "general",
    actorId,
    type: "message_sent",
    payload: { content, ...extra },
    createdAt: 1,
    pulseIndex: 1,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
  }) as CommittedEvent;

const asked = line("g1", "h:1", "Agent A, o que você mais gosta aqui?", { untrusted: true, addresseeIds: ["agent-a"], mentionedAgentIds: ["agent-a"] });
const idle = line("e2", "agent-b", "Alguém viu o gato do telhado por aí hoje?");

function input(trigger: CommittedEvent): AgentRuntimeInput {
  return {
    simulationId: "sim-1",
    agentId: "agent-a",
    budgetPriority: "normal",
    availableActions: [
      { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
      { intentType: "send_message", channelTargets: ["general"], personTargets: ["agent-b"], blocked: false },
      { intentType: "reply_to_message", channelTargets: ["general"], personTargets: ["agent-b"], blocked: false },
      { intentType: "react", channelTargets: ["general"], personTargets: ["agent-b"], blocked: false },
    ],
    perceptionPacket: {
      agentId: "agent-a",
      triggeringEvent: trigger,
      visibleContextEvents: [trigger],
      eventHandles: { e1: "g1" },
      ownRecentUtterances: [],
      involvedPeople: [],
      relevantChannels: ["general"],
      relevantMemories: [],
      translatedEmotionalState: { moodDescription: "Neutral.", socialContext: "Calm.", relationalFlavors: [], pressureDescriptions: [], inhibitionDescriptions: [] },
      availableActions: [],
    },
  } as AgentRuntimeInput;
}

const llmConfig = { providerType: "mock", modelName: "m", baseUrl: "http://localhost", temperature: 1, maxOutputTokens: 256, timeoutMs: 5000, retryCount: 0, responseFormatJson: true } as LLMConfig;
const prompt = { system: "sys", user: "user", inputTokensEstimate: 25, purpose: "action_intent" as const, version: "v" };

async function run(answers: LLMProviderResult[], trigger: CommittedEvent, language: "pt-BR" | "en" = "pt-BR") {
  const generateIntent = vi.fn();
  for (const a of answers) generateIntent.mockResolvedValueOnce(a);
  const ctx: StepRunContext = { now: 1000, pulseIndex: 3, provider: { generateIntent } as StepRunContext["provider"], llmConfig, profile: { language } as StepRunContext["profile"], prompt, repetitionPolicy: { maxRetries: 2, roomThreshold: 0.7 } };
  const outcome = await new ActionIntentStep().execute(input(trigger), ctx);
  return { outcome, generateIntent, systems: generateIntent.mock.calls.slice(1).map((c) => (c[2] as { system: string }).system) };
}

describe("a person asked this actor something (run 11, Enzo)", () => {
  it("an invalid answer is retried with a note that says why and asks for words, and the retry is committed", async () => {
    const { outcome, generateIntent, systems } = await run([reactToOther, wordsToGuest], asked);
    expect(generateIntent).toHaveBeenCalledTimes(2);
    expect(systems[0]).toContain("não pôde ser usada");
    expect(systems[0]).toContain("is not permitted for intent type 'react'");
    expect(outcome.ok && outcome.value.fallbackApplied).toBe(false);
    expect(outcome.ok && outcome.value.intent.visibleContent).toBe("Gosto do jeito que a música toma conta do salão.");
  });

  it("an answer aimed at somebody else is retried, and the answer to the person is committed (run 11, IQ Moller)", async () => {
    const { outcome, generateIntent, systems } = await run([wordsToOther, wordsToGuest], asked);
    expect(generateIntent).toHaveBeenCalledTimes(2);
    expect(systems[0]).toContain("foi dirigida a outra pessoa");
    expect(outcome.ok && outcome.value.intent.visibleContent).toBe("Gosto do jeito que a música toma conta do salão.");
  });

  it("an answer to the person who asked is left alone", async () => {
    const { outcome, generateIntent } = await run([wordsToGuest], asked);
    expect(generateIntent).toHaveBeenCalledTimes(1);
    expect(outcome.ok && outcome.value.fallbackApplied).toBe(false);
  });

  it("still delivers a line aimed at somebody else if the retries keep aiming there: some answer is better than none", async () => {
    const { outcome, generateIntent } = await run([wordsToOther, wordsToOther, wordsToOther], asked);
    expect(generateIntent).toHaveBeenCalledTimes(3);
    expect(outcome.ok && outcome.value.fallbackApplied).toBe(false);
    expect(outcome.ok && outcome.value.intent.visibleContent).toContain("Enzo");
  });

  it("falls back to a no-op when every try is invalid, after the bounded retries", async () => {
    const { outcome, generateIntent } = await run([reactToOther, reactToOther, reactToOther, reactToOther], asked);
    expect(generateIntent.mock.calls.length).toBeLessThanOrEqual(3);
    expect(outcome.ok === false || outcome.value.fallbackApplied).toBe(true);
  });

  it("does nothing new for a turn nobody asked: an invalid answer is still a fallback with no retry", async () => {
    const { outcome, generateIntent } = await run([reactToOther], idle);
    expect(generateIntent).toHaveBeenCalledTimes(1);
    expect(outcome.ok === false || outcome.value.fallbackApplied).toBe(true);
    const aimed = await run([wordsToOther], idle);
    expect(aimed.generateIntent).toHaveBeenCalledTimes(1);
  });
});

describe("the notes", () => {
  it("speak the profile's language and keep the problem short", () => {
    expect(answerOwedNote("x".repeat(500), "en").length).toBeLessThan(500);
    expect(answerOwedNote("bad target", "en")).toContain("could not be used (bad target)");
    expect(aimedElsewhereNote("oi", "pt-BR")).toContain("outra pessoa");
  });
});
