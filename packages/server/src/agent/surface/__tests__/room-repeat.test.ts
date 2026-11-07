import { describe, it, expect, vi } from "vitest";
import type { AgentRuntimeInput, CommittedEvent, LLMProviderResult } from "@perfectman/shared";
import type { LLMConfig } from "../../../llm/llm-config.js";
import { ActionIntentStep } from "../action-intent-step.js";
import type { StepRunContext } from "../llm-step.js";
import type { RepetitionPolicy } from "../../repetition-guard.js";
import { isRoomCopy, roomLinesHeard } from "../../repetition-guard.js";

const answer = (visibleContent: string): LLMProviderResult => ({
  content: JSON.stringify({ intentType: "send_message", channelTarget: "general", visibleContent, privateMotiveSummary: "A real reason.", emotionDrivers: [], motivationDrivers: [] }),
  usage: { inputTokens: 50, outputTokens: 10 },
  latencyMs: 5,
  model: "m",
  requestedModel: "m",
  routedModel: "m",
  fallbackAttempts: 0,
});

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

const SAID = "Olha quem chegou, que bom ver você por aqui hoje";

function input(visible: CommittedEvent[], trigger: CommittedEvent | null = null): AgentRuntimeInput {
  return {
    simulationId: "sim-1",
    agentId: "agent-a",
    budgetPriority: "normal",
    availableActions: [
      { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
      { intentType: "send_message", channelTargets: ["general"], personTargets: [], blocked: false },
    ],
    perceptionPacket: {
      agentId: "agent-a",
      triggeringEvent: trigger,
      visibleContextEvents: visible,
      eventHandles: {},
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

function run(answers: string[], inp: AgentRuntimeInput, repetitionPolicy?: RepetitionPolicy) {
  const generateIntent = vi.fn();
  for (const a of answers) generateIntent.mockResolvedValueOnce(answer(a));
  const ctx: StepRunContext = { now: 1000, pulseIndex: 3, provider: { generateIntent } as StepRunContext["provider"], llmConfig, profile: {} as StepRunContext["profile"], prompt, ...(repetitionPolicy ? { repetitionPolicy } : {}) };
  return new ActionIntentStep().execute(inp, ctx).then((outcome) => ({ outcome, calls: generateIntent.mock.calls.length, generateIntent }));
}

const room = (): CommittedEvent[] => [line("e1", "agent-b", SAID)];

describe("cross-actor copies", () => {
  it("roomLinesHeard lists what others said, not the actor's own lines or a guest's", () => {
    const lines = roomLinesHeard({
      agentId: "agent-a",
      triggeringEvent: line("e9", "agent-c", "Outra fala da sala inteira aqui"),
      visibleContextEvents: [line("e1", "agent-b", SAID), line("e2", "agent-a", "minha própria fala bem longa"), line("e3", "h:1", "uma fala do visitante qualquer", { untrusted: true })],
    });
    expect(lines).toEqual([SAID, "Outra fala da sala inteira aqui"]);
  });

  it("only lines of three or more content words can be a copy", () => {
    expect(isRoomCopy("Verdade.", ["Verdade."], 0.7)).toBe(false);
    expect(isRoomCopy("Olha quem chegou, que bom ver você aqui", [SAID], 0.7)).toBe(true);
    expect(isRoomCopy("Ninguém sabe do gato desde ontem à noite", [SAID], 0.7)).toBe(false);
  });

  it("is off without a roomThreshold: a copy of another actor goes out untouched", async () => {
    const { outcome, calls } = await run([SAID], input(room()), { maxRetries: 2 });
    expect(calls).toBe(1);
    expect(outcome.ok && outcome.value.fallbackApplied).toBe(false);
  });

  it("retries a line another actor just said, with a note that names that, and takes the new line", async () => {
    const { outcome, calls, generateIntent } = await run([SAID, "Faz tempo que eu não passava no telhado"], input(room()), { maxRetries: 2, roomThreshold: 0.7 });
    expect(calls).toBe(2);
    const retryPrompt = generateIntent.mock.calls[1]![2] as { system: string; retry?: string };
    expect(retryPrompt.retry).toBe("correction");
    expect(retryPrompt.system).toContain("someone else in the room just said");
    expect(outcome.ok && outcome.value.intent.visibleContent).toBe("Faz tempo que eu não passava no telhado");
  });

  it("blocks with the repetition marker when the copy survives the retries, naming the room", async () => {
    const { outcome, calls } = await run([SAID, SAID, SAID], input(room()), { maxRetries: 2, roomThreshold: 0.7 });
    expect(calls).toBe(3);
    expect(outcome.ok && outcome.value.fallbackApplied).toBe(true);
    expect(outcome.ok && outcome.value.intent.privateMotiveSummary).toMatch(/^Repetition guard: near-duplicate of a line someone else in the room just said/);
  });

  it("still delivers a copy to a person who asked, after the retries", async () => {
    const asked = line("g1", "h:1", "Agent A, você viu o gato hoje?", { untrusted: true, addresseeIds: ["agent-a"] });
    const { outcome, calls } = await run([SAID, SAID, SAID], input([...room(), asked], asked), { maxRetries: 2, roomThreshold: 0.7 });
    expect(calls).toBe(3);
    expect(outcome.ok && outcome.value.fallbackApplied).toBe(false);
    expect(outcome.ok && outcome.value.intent.visibleContent).toBe(SAID);
  });
});

describe("ambient retries", () => {
  it("an ambient turn gets ambientMaxRetries, a turn somebody triggered gets maxRetries", async () => {
    const policy = { maxRetries: 2, roomThreshold: 0.7, ambientMaxRetries: 1 };
    const ambient = await run([SAID, SAID, SAID], input(room()), policy);
    expect(ambient.calls).toBe(2);
    expect(ambient.outcome.ok && ambient.outcome.value.fallbackApplied).toBe(true);
    const trigger = line("e2", "agent-c", "Alguém viu o gato do telhado por aí hoje?");
    const triggered = await run([SAID, SAID, SAID], input([...room(), trigger], trigger), policy);
    expect(triggered.calls).toBe(3);
  });
});

describe("a thought said out loud", () => {
  const answerWith = (visibleContent: string, privateMotiveSummary: string): LLMProviderResult => ({
    ...answer("x"),
    content: JSON.stringify({ intentType: "send_message", channelTarget: "general", visibleContent, privateMotiveSummary, emotionDrivers: [], motivationDrivers: [] }),
  });

  it("is retried with a note that names the thought, and takes the real sentence", async () => {
    const thought = "concordo e quero que saibam sem fazer discurso";
    const generateIntent = vi.fn().mockResolvedValueOnce(answerWith(thought, thought)).mockResolvedValueOnce(answerWith("Boa, também acho.", "concordo com ela"));
    const ctx: StepRunContext = { now: 1000, pulseIndex: 3, provider: { generateIntent } as StepRunContext["provider"], llmConfig, profile: {} as StepRunContext["profile"], prompt, repetitionPolicy: { maxRetries: 2, roomThreshold: 0.7 } };
    const out = await new ActionIntentStep().execute(input([]), ctx);
    expect(generateIntent).toHaveBeenCalledTimes(2);
    expect((generateIntent.mock.calls[1]![2] as { system: string }).system).toContain("private thought said out loud");
    expect(out.ok && out.value.intent.visibleContent).toBe("Boa, também acho.");
  });

  it("catches an example's private thought spoken as the line, even when the actor's own thought differs", async () => {
    const generateIntent = vi.fn().mockResolvedValueOnce(answerWith("achei graça e não escondo", "quero provocar o Tavo")).mockResolvedValueOnce(answerWith("Tavo, você não cansa de perder?", "quero provocar o Tavo"));
    const ctx: StepRunContext = { now: 1000, pulseIndex: 3, provider: { generateIntent } as StepRunContext["provider"], llmConfig, profile: {} as StepRunContext["profile"], prompt, repetitionPolicy: { maxRetries: 2, roomThreshold: 0.7 } };
    const out = await new ActionIntentStep().execute(input([]), ctx);
    expect(generateIntent).toHaveBeenCalledTimes(2);
    expect(out.ok && out.value.intent.visibleContent).toBe("Tavo, você não cansa de perder?");
  });

  it("is not looked for outside hotel mode (no roomThreshold)", async () => {
    const thought = "concordo e quero que saibam sem fazer discurso";
    const generateIntent = vi.fn().mockResolvedValueOnce(answerWith(thought, thought));
    const ctx: StepRunContext = { now: 1000, pulseIndex: 3, provider: { generateIntent } as StepRunContext["provider"], llmConfig, profile: {} as StepRunContext["profile"], prompt };
    await new ActionIntentStep().execute(input([]), ctx);
    expect(generateIntent).toHaveBeenCalledTimes(1);
  });
});
