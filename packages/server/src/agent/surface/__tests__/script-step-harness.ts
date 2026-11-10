/** Shared set-up of the script-check tests: scripted model answers run through `ActionIntentStep` with the hotel policy, and what the guards reported. */
import { beforeEach, vi } from "vitest";
import type { AgentRuntimeInput, CommittedEvent, LLMProviderResult } from "@perfectman/shared";
import type { LLMConfig } from "../../../llm/llm-config.js";
import { llmBudget } from "../../../llm/llm-budget.js";
import { ActionIntentStep } from "../action-intent-step.js";
import type { StepRunContext } from "../llm-step.js";
import type { GuardKind, RepetitionPolicy } from "../../repetition-guard.js";
import { hotelPerception } from "../../__tests__/hotel-test-helpers.js";

export const answer = (visibleContent: string, extra: Record<string, unknown> = {}): LLMProviderResult => ({
  content: JSON.stringify({ intentType: "send_message", channelTarget: "general", visibleContent, privateMotiveSummary: "Uma razão de verdade.", emotionDrivers: [], motivationDrivers: [], ...extra }),
  usage: { inputTokens: 50, outputTokens: 10 },
  latencyMs: 5,
  model: "m",
  requestedModel: "m",
  routedModel: "m",
  fallbackAttempts: 0,
});

let n = 0;
export const line = (actorId: string, senderName: string, content: string, extra: Record<string, unknown> = {}): CommittedEvent =>
  ({
    id: `evt-${++n}`,
    simulationId: "sim-1",
    channelId: "general",
    actorId,
    type: "message_sent",
    payload: { content, senderName, ...extra },
    createdAt: n,
    pulseIndex: n,
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" },
  }) as CommittedEvent;

export function input(visible: CommittedEvent[], own: string[] = [], trigger: CommittedEvent | null = null, bodies = false): AgentRuntimeInput {
  return {
    simulationId: "sim-1",
    agentId: "bento",
    budgetPriority: "normal",
    availableActions: [
      { intentType: "no_op", channelTargets: [], personTargets: [], blocked: false },
      { intentType: "send_message", channelTargets: ["general"], personTargets: [], blocked: false },
    ],
    perceptionPacket: {
      agentId: "bento",
      triggeringEvent: trigger,
      visibleContextEvents: visible,
      eventHandles: {},
      ownRecentUtterances: own,
      involvedPeople: [],
      relevantChannels: ["general"],
      relevantMemories: [],
      translatedEmotionalState: { moodDescription: "Neutral.", socialContext: "Calm.", relationalFlavors: [], pressureDescriptions: [], inhibitionDescriptions: [] },
      availableActions: [],
      // Bodies on (hotel): a real body perception and its handles, so the body block of an answer is read and a silent turn may be given a face.
      ...(bodies ? { body: hotelPerception().body, bodyHandles: hotelPerception().handles } : {}),
    },
  } as AgentRuntimeInput;
}

const llmConfig = { providerType: "mock", modelName: "m", baseUrl: "http://localhost", temperature: 1, maxOutputTokens: 256, timeoutMs: 5000, retryCount: 0, responseFormatJson: true } as LLMConfig;
const prompt = { system: "sys", user: "user", inputTokensEstimate: 25, purpose: "action_intent" as const, version: "v" };
beforeEach(() => llmBudget.reset());

export const HOTEL: RepetitionPolicy = { maxRetries: 2, roomThreshold: 0.7, strict: true, script: true };
export const profileOf = (extra: Record<string, unknown> = {}) => ({ language: "pt-BR", displayName: "Bento", ...extra }) as StepRunContext["profile"];

export type Scripted = string | [string, Record<string, unknown>];

export async function run(answers: Scripted[], inp: AgentRuntimeInput, policy: RepetitionPolicy = HOTEL, profile = profileOf()) {
  const generateIntent = vi.fn();
  for (const a of answers) generateIntent.mockResolvedValueOnce(typeof a === "string" ? answer(a) : answer(a[0], a[1]));
  const seen: GuardKind[] = [];
  const infos: Array<{ kind: GuardKind; actor?: string; before?: string; after?: string }> = [];
  const ctx: StepRunContext = {
    now: 1000,
    pulseIndex: 3,
    provider: { generateIntent } as StepRunContext["provider"],
    llmConfig,
    profile,
    prompt,
    repetitionPolicy: { ...policy, onGuard: (k, info) => (seen.push(k), infos.push({ kind: k, ...info })) },
  };
  const outcome = await new ActionIntentStep().execute(inp, ctx);
  const value = outcome.ok ? outcome.value : outcome.fallback;
  const system = (i: number): string => (generateIntent.mock.calls[i]![2] as { system: string }).system;
  return { value, calls: generateIntent.mock.calls.length, system, seen, infos, said: value.intent.visibleContent ?? "" };
}

// Invented lines throughout.
export const LONG = "Ian, você tá parado aí que nem lasanha de véspera: parece firme, mas por baixo tá tudo deslizando e ninguém percebe nada. Eu juro que vi o cofre aberto ontem à noite, perto da escada. Depois ele sumiu de repente.";
export const QUIET = [line("ana", "Ana", "Quem abriu a janela do corredor?"), line("caco", "Caco", "Foi o vento, ninguém abriu nada."), line("ana", "Ana", "O vento não gira maçaneta, Caco.")];
