import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeInput, CommittedEvent, LLMProviderResult } from "@perfectman/shared";
import { lengthOf } from "@perfectman/shared";
import type { LLMConfig } from "../../../llm/llm-config.js";
import { llmBudget } from "../../../llm/llm-budget.js";
import { ActionIntentStep } from "../action-intent-step.js";
import type { StepRunContext } from "../llm-step.js";
import type { GuardKind, RepetitionPolicy } from "../../repetition-guard.js";
import { lengthTargetOf } from "../../script-guard.js";

const answer = (visibleContent: string): LLMProviderResult => ({
  content: JSON.stringify({ intentType: "send_message", channelTarget: "general", visibleContent, privateMotiveSummary: "Uma razão de verdade.", emotionDrivers: [], motivationDrivers: [] }),
  usage: { inputTokens: 50, outputTokens: 10 },
  latencyMs: 5,
  model: "m",
  requestedModel: "m",
  routedModel: "m",
  fallbackAttempts: 0,
});

let n = 0;
const line = (actorId: string, senderName: string, content: string, extra: Record<string, unknown> = {}): CommittedEvent =>
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

function input(visible: CommittedEvent[], own: string[] = [], trigger: CommittedEvent | null = null): AgentRuntimeInput {
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
    },
  } as AgentRuntimeInput;
}

const llmConfig = { providerType: "mock", modelName: "m", baseUrl: "http://localhost", temperature: 1, maxOutputTokens: 256, timeoutMs: 5000, retryCount: 0, responseFormatJson: true } as LLMConfig;
const prompt = { system: "sys", user: "user", inputTokensEstimate: 25, purpose: "action_intent" as const, version: "v" };
beforeEach(() => llmBudget.reset());

const HOTEL: RepetitionPolicy = { maxRetries: 2, roomThreshold: 0.7, strict: true, script: true };
const profileOf = (extra: Record<string, unknown> = {}) => ({ language: "pt-BR", displayName: "Bento", ...extra }) as StepRunContext["profile"];

async function run(answers: string[], inp: AgentRuntimeInput, policy: RepetitionPolicy = HOTEL, profile = profileOf()) {
  const generateIntent = vi.fn();
  for (const a of answers) generateIntent.mockResolvedValueOnce(answer(a));
  const seen: GuardKind[] = [];
  const ctx: StepRunContext = { now: 1000, pulseIndex: 3, provider: { generateIntent } as StepRunContext["provider"], llmConfig, profile, prompt, repetitionPolicy: { ...policy, onGuard: (k) => seen.push(k) } };
  const outcome = await new ActionIntentStep().execute(inp, ctx);
  const value = outcome.ok ? outcome.value : outcome.fallback;
  const system = (i: number): string => (generateIntent.mock.calls[i]![2] as { system: string }).system;
  return { value, calls: generateIntent.mock.calls.length, system, seen, said: value.intent.visibleContent ?? "" };
}

// Invented lines throughout.
const LONG = "Ian, você tá parado aí que nem lasanha de véspera: parece firme, mas por baixo tá tudo deslizando e ninguém percebe nada. Eu juro que vi o cofre aberto ontem à noite, perto da escada. Depois ele sumiu de repente.";
const QUIET = [line("ana", "Ana", "Quem abriu a janela do corredor?"), line("caco", "Caco", "Foi o vento, ninguém abriu nada."), line("ana", "Ana", "O vento não gira maçaneta, Caco.")];

describe("length", () => {
  it("retries a line over the cap once, naming its word count, and sends the short one", async () => {
    expect(lengthOf(LONG)).toBeGreaterThan(25);
    const r = await run([LONG, "Vi o cofre aberto ontem à noite."], input(QUIET));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain(`tinha ${lengthOf(LONG)} palavras e o limite é 25`);
    expect(r.system(1)).toContain("primeira frase");
    expect(r.said).toBe("Vi o cofre aberto ontem à noite.");
    expect(r.seen).toEqual(["len_retry"]);
  });

  it("cuts the line at a sentence boundary when the retry is still over, and does not retry a second time", async () => {
    const r = await run([LONG, LONG.replace("Ian,", "Caio,")], input(QUIET));
    expect(r.calls).toBe(2);
    expect(r.seen).toEqual(["len_retry", "len_trimmed"]);
    expect(lengthOf(r.said)).toBeLessThanOrEqual(25);
    expect(r.said).toMatch(/[.!?…]$/);
    expect(r.said.startsWith("Caio, você tá parado")).toBe(true);
    expect(r.value.fallbackApplied).toBe(false);
  });

  it("respects the persona's message length: a long talker may run to 60 words", async () => {
    const fifty = Array.from({ length: 40 }, (_, i) => `palavra${i}`).join(" ") + ".";
    const r = await run([fifty], input(QUIET), HOTEL, profileOf({ messageLength: "long" }));
    expect(r.calls).toBe(1);
    expect(r.seen).toEqual([]);
    expect(r.said).toBe(fifty);
    expect(lengthTargetOf("long", "pt-BR").cap).toBe(60);
  });

  it("is off without the policy flag: the long line goes out as the model wrote it", async () => {
    const r = await run([LONG], input(QUIET), { maxRetries: 2, roomThreshold: 0.7, strict: true });
    expect(r.calls).toBe(1);
    expect(r.said).toBe(LONG);
  });
});

describe("motif and novelty", () => {
  const PATO = [
    line("ana", "Ana", "Você já viu um pato de perto, Bento?"),
    line("caco", "Caco", "Pato de perto eu nunca vi, juro."),
    line("ana", "Ana", "Quanto custou aquele relógio do primo?"),
  ];

  it("retries a line that brings back a phrase two of the last turns carry, naming it", async () => {
    const r = await run(["Um pato de perto não muda nada.", "O relógio do primo parou ontem."], input(PATO));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain('"pato de perto" já apareceu em duas das últimas falas');
    expect(r.said).toBe("O relógio do primo parou ontem.");
    expect(r.seen).toEqual(["motif_retry"]);
  });

  it("swaps the line for a short reaction when the retry brings it back again", async () => {
    const r = await run(["Um pato de perto não muda nada.", "Pato de perto, pato de perto, eu sei."], input(PATO));
    expect(r.calls).toBe(2);
    expect(r.seen).toEqual(["motif_retry", "motif_reaction"]);
    expect(r.said).toMatch(/^(Ah|Hm|Ué|Sei|Tá)\.$/);
    expect(r.value.fallbackApplied).toBe(false);
  });

  it("keeps the sentences of a retried line that do not carry the motif", async () => {
    const r = await run(["Um pato de perto não muda nada.", "O cofre abriu sozinho. Pato de perto, eu sei."], input(PATO));
    expect(r.said).toBe("O cofre abriu sozinho.");
  });

  it("does not take a topic word for a motif", async () => {
    const talk = [line("ana", "Ana", "O envelope estava na mochila."), line("caco", "Caco", "Esse envelope não é meu, juro."), line("ana", "Ana", "Então me explica o envelope.")];
    const r = await run(["Nunca toquei nesse envelope, Ana, mas conheço o dono antigo daquela mochila."], input(talk));
    expect(r.calls).toBe(1);
    expect(r.seen).toEqual([]);
  });

  it("retries a line that only gives the room back what it said", async () => {
    const stale = [line("ana", "Ana", "A lasanha esfriou no balcão ontem."), line("caco", "Caco", "Ninguém comeu aquela lasanha, nem o pão."), line("ana", "Ana", "O balcão ficou sujo, o pão duro.")];
    const echoey = "Ontem ninguém comeu aquela lasanha suja no balcão, nem o pão duro.";
    const r = await run([echoey, "O cofre emprestado sumiu da sala dos fundos esta madrugada."], input(stale));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain("só repete o que a sala acabou de ouvir");
    expect(r.seen).toEqual(["novelty_retry"]);
  });

  it("delivers the line anyway to a person who just asked this actor something", async () => {
    const guest = line("h:42", "Visitante", "Bento, você já viu um pato de perto?", { untrusted: true, addresseeIds: ["bento"], mentionedAgentIds: ["bento"] });
    const r = await run(["Um pato de perto, claro que já vi.", "Já vi sim, um pato de perto, no sítio."], input([...PATO, guest], [], guest));
    // Retried once with the motif note like any line, and then delivered as it is: a person who asked gets an answer, not a reaction.
    expect(r.calls).toBe(2);
    expect(r.said).toBe("Já vi sim, um pato de perto, no sítio.");
    expect(r.seen).toEqual(["motif_retry"]);
  });
});

describe("question debt", () => {
  const OWED = [line("ana", "Ana", "Bento, cadê a chave do cofre?"), line("caco", "Caco", "Eu vi uma chave na mesa ontem."), line("bia", "Bia", "Ninguém mexeu em nada, eu garanto.")];

  it("retries an actor that asks while it owes an answer, naming who asked", async () => {
    const r = await run(["E você, Ana, onde estava ontem à noite?", "Na gaveta de baixo, junto das cartas."], input(OWED));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain("Ana te perguntou");
    expect(r.said).toBe("Na gaveta de baixo, junto das cartas.");
    expect(r.seen).toEqual(["debt_retry"]);
  });

  it("cuts the questions from a line that still dodges after its retry", async () => {
    const r = await run(["Não sei. E você, onde estava?", "E a Bia, onde estava ontem à noite?"], input(OWED));
    // The first answer already answers first ("Não sei."), so nothing is retried for debt.
    expect(r.calls).toBe(1);
    expect(r.said).toBe("Não sei. E você, onde estava?");
    const r2 = await run(["E você, onde estava ontem à noite?", "E a Bia, onde estava ontem à noite?"], input(OWED));
    expect(r2.seen).toEqual(["debt_retry", "debt_stripped"]);
    expect(r2.said).toMatch(/^(Ah|Hm|Ué|Sei|Tá)\.$/);
  });

  it("does not hold an actor to a question that is not yet two turns old, or that was not aimed at it", async () => {
    const fresh = [line("caco", "Caco", "Ninguém mexeu em nada."), line("ana", "Ana", "Bento, cadê a chave do cofre?"), line("bia", "Bia", "Eu vi uma chave na mesa.")];
    const r = await run(["E o Caco, o que acha?"], input(fresh));
    expect(r.calls).toBe(1);
    const other = [line("ana", "Ana", "Caco, cadê a chave do cofre?"), line("bia", "Bia", "Eu vi uma chave na mesa."), line("caco", "Caco", "Não sei de chave nenhuma.")];
    expect((await run(["E o Bia, o que acha?"], input(other))).calls).toBe(1);
  });
});
