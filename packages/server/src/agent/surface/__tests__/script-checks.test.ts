import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRuntimeInput, CommittedEvent, LLMProviderResult } from "@perfectman/shared";
import { lengthOf } from "@perfectman/shared";
import type { LLMConfig } from "../../../llm/llm-config.js";
import { llmBudget } from "../../../llm/llm-budget.js";
import { ActionIntentStep } from "../action-intent-step.js";
import type { StepRunContext } from "../llm-step.js";
import type { GuardKind, RepetitionPolicy } from "../../repetition-guard.js";
import { isEngineAuthoredMotive } from "@perfectman/shared";
import { lengthTargetOf } from "../../script-guard.js";
import { RUN60 } from "../../__tests__/fixtures/run-lines.js";

const answer = (visibleContent: string, extra: Record<string, unknown> = {}): LLMProviderResult => ({
  content: JSON.stringify({ intentType: "send_message", channelTarget: "general", visibleContent, privateMotiveSummary: "Uma razão de verdade.", emotionDrivers: [], motivationDrivers: [], ...extra }),
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

function input(visible: CommittedEvent[], own: string[] = [], trigger: CommittedEvent | null = null, bodies = false): AgentRuntimeInput {
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
      // Bodies on (hotel): the body block of the output is read against an empty handle map, and the guard may give a silent turn a face.
      ...(bodies ? { body: { people: [], places: [], furniture: [], rooms: [] }, bodyHandles: {} } : {}),
    },
  } as unknown as AgentRuntimeInput;
}

const llmConfig = { providerType: "mock", modelName: "m", baseUrl: "http://localhost", temperature: 1, maxOutputTokens: 256, timeoutMs: 5000, retryCount: 0, responseFormatJson: true } as LLMConfig;
const prompt = { system: "sys", user: "user", inputTokensEstimate: 25, purpose: "action_intent" as const, version: "v" };
beforeEach(() => llmBudget.reset());

const HOTEL: RepetitionPolicy = { maxRetries: 2, roomThreshold: 0.7, strict: true, script: true };
const profileOf = (extra: Record<string, unknown> = {}) => ({ language: "pt-BR", displayName: "Bento", ...extra }) as StepRunContext["profile"];

type Scripted = string | [string, Record<string, unknown>];

async function run(answers: Scripted[], inp: AgentRuntimeInput, policy: RepetitionPolicy = HOTEL, profile = profileOf()) {
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
const LONG = "Ian, você tá parado aí que nem lasanha de véspera: parece firme, mas por baixo tá tudo deslizando e ninguém percebe nada. Eu juro que vi o cofre aberto ontem à noite, perto da escada. Depois ele sumiu de repente.";
const QUIET = [line("ana", "Ana", "Quem abriu a janela do corredor?"), line("caco", "Caco", "Foi o vento, ninguém abriu nada."), line("ana", "Ana", "O vento não gira maçaneta, Caco.")];

describe("length", () => {
  it("retries a line over the cap once, naming its word count, and sends the short one", async () => {
    expect(lengthOf(LONG)).toBeGreaterThan(22);
    const r = await run([LONG, "Vi o cofre aberto ontem à noite."], input(QUIET));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain(`tinha ${lengthOf(LONG)} palavras e o limite é 22`);
    expect(r.system(1)).toContain("primeira frase");
    expect(r.said).toBe("Vi o cofre aberto ontem à noite.");
    expect(r.seen).toEqual(["len_retry"]);
  });

  it("cuts the line at a sentence boundary when the retry is still over, and does not retry a second time", async () => {
    const r = await run([LONG, LONG.replace("Ian,", "Caio,")], input(QUIET));
    expect(r.calls).toBe(2);
    expect(r.seen).toEqual(["len_retry", "len_trimmed"]);
    expect(lengthOf(r.said)).toBeLessThanOrEqual(22);
    expect(r.said).toMatch(/[.!?…]$/);
    expect(r.said.startsWith("Caio, você tá parado")).toBe(true);
    expect(r.value.fallbackApplied).toBe(false);
  });

  it("ends a scripted 30-word candidate under the cap, with the retry as long as the first try", async () => {
    const thirty = "Você pagou ontem à noite, mas a conta continua aberta no balcão, o Caco já cobrou duas vezes, e eu não vou esperar o seu aviso chegar, nem hoje, nunca.";
    expect(lengthOf(thirty)).toBe(30);
    const r = await run([thirty, thirty], input(QUIET));
    expect(r.calls).toBe(2);
    expect(lengthOf(r.said)).toBeLessThanOrEqual(lengthTargetOf("short", "pt-BR").cap);
    expect(r.seen).toEqual(["len_retry", "len_trimmed"]);
  });

  it("respects an explicit medium length (cap 40) and holds an unmarked persona to short (cap 22)", async () => {
    const thirty = "Você pagou ontem à noite, mas a conta continua aberta no balcão, o Caco já cobrou duas vezes, e eu não vou esperar o seu aviso chegar, nem hoje, nunca.";
    const medium = await run([thirty], input(QUIET), HOTEL, profileOf({ messageLength: "medium" }));
    expect(medium.calls).toBe(1);
    expect(medium.said).toBe(thirty);
    const unmarked = await run([thirty, thirty], input(QUIET));
    expect(unmarked.calls).toBe(2);
    expect(lengthOf(unmarked.said)).toBeLessThanOrEqual(22);
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

  it("goes quiet when the retry brings the motif back again: no filler is said in its place", async () => {
    const r = await run(["Um pato de perto não muda nada.", "Pato de perto, pato de perto, eu sei."], input(PATO));
    expect(r.calls).toBe(2);
    expect(r.seen).toEqual(["motif_retry", "guard_silenced"]);
    expect(r.value.intent.intentType).toBe("no_op");
    expect(r.value.intent.visibleContent).toBeUndefined();
    expect(r.value.intent.privateMotiveSummary).toMatch(/^Output guard: no fresh line/);
    expect(isEngineAuthoredMotive(r.value.intent.privateMotiveSummary)).toBe(true);
    expect(r.value.operatorEvents.some((e) => e.type === "llm_failure")).toBe(false);
    expect(r.value.operatorEvents.some((e) => e.type === "intent_blocked")).toBe(true);
  });

  it("PERFECTMAN_FILLER_SILENCE=0 brings the old short reaction back", async () => {
    process.env["PERFECTMAN_FILLER_SILENCE"] = "0";
    try {
      const r = await run(["Um pato de perto não muda nada.", "Pato de perto, pato de perto, eu sei."], input(PATO));
      expect(r.seen).toEqual(["motif_retry", "motif_reaction"]);
      expect(r.said).toMatch(/^(Ah|Hm|Ué|Sei|Tá)\.$/);
      expect(r.value.fallbackApplied).toBe(false);
    } finally {
      delete process.env["PERFECTMAN_FILLER_SILENCE"];
    }
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
    // The check reads the turn right before and the actor's own last three lines: this one says again, in other words, what the turn before it said.
    const stale = [line("ana", "Ana", "A lasanha esfriou no balcão ontem."), line("caco", "Caco", "Quanto custou aquele relógio do primo?"), line("ana", "Ana", "A lasanha suja ficou esquecida no balcão, ninguém comeu aquela porcaria.")];
    const echoey = "Ninguém comeu aquela lasanha suja no balcão, mas o cheiro de vinagre e mofo continua ali agora.";
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

  it("goes quiet when a line still dodges after its retry and nothing is left but questions", async () => {
    const r = await run(["Não sei. E você, onde estava?", "E a Bia, onde estava ontem à noite?"], input(OWED));
    // The first answer already answers first ("Não sei."), so nothing is retried for debt.
    expect(r.calls).toBe(1);
    expect(r.said).toBe("Não sei. E você, onde estava?");
    const r2 = await run(["E você, onde estava ontem à noite?", "E a Bia, onde estava ontem à noite?"], input(OWED));
    expect(r2.seen).toEqual(["debt_retry", "guard_silenced"]);
    expect(r2.value.intent.intentType).toBe("no_op");
  });

  it("keeps the statements of a line that still asks after its retry and drops its questions", async () => {
    const r = await run(["E você, onde estava ontem à noite?", "Onde você estava, Ana? Eu não sei de chave nenhuma."], input(OWED));
    expect(r.seen).toEqual(["debt_retry", "debt_stripped"]);
    expect(r.said).toBe("Eu não sei de chave nenhuma.");
  });

  it("does not hold an actor to a question that is not yet two turns old, or that was not aimed at it", async () => {
    const fresh = [line("caco", "Caco", "Ninguém mexeu em nada."), line("ana", "Ana", "Bento, cadê a chave do cofre?"), line("bia", "Bia", "Eu vi uma chave na mesa.")];
    const r = await run(["E o Caco, o que acha?"], input(fresh));
    expect(r.calls).toBe(1);
    const other = [line("ana", "Ana", "Caco, cadê a chave do cofre?"), line("bia", "Bia", "Eu vi uma chave na mesa."), line("caco", "Caco", "Não sei de chave nenhuma.")];
    expect((await run(["E o Bia, o que acha?"], input(other))).calls).toBe(1);
  });
});

// ---- the dialogue guards, on the lines of production run 60 (Heloísa, Otávio and Renato; bot actors only) ----------------------------------------

const roomBefore = (t: number, me: string): CommittedEvent[] => RUN60.filter((l) => l.t < t).map((l) => line(l.name === me ? "bento" : l.name.toLowerCase(), l.name, l.text));
const said60 = (t: number): string => RUN60.find((l) => l.t === t)!.text;
const as = (name: string) => profileOf({ displayName: name });

describe("narration in speech", () => {
  const RENATO_52 = said60(52);
  const OTAVIO_77 = said60(77);

  it("takes the narrated sentence out of Renato's real line before anything reads it", async () => {
    expect(RENATO_52).toContain("Olho pra ela, sorriso atravessado.");
    const short = "Irmão não depõe, né? O cofre tá ali, mano, é só abrir. Olho pra ela, sorriso atravessado.";
    const r = await run([short], input(roomBefore(52, "Renato")), HOTEL, as("Renato"));
    expect(r.calls).toBe(1);
    expect(r.said).toBe("Irmão não depõe, né? O cofre tá ali, mano, é só abrir.");
    expect(r.seen).toEqual(["narration_stripped"]);
    expect(r.infos[0]).toMatchObject({ kind: "narration_stripped", actor: "Renato", before: short, after: "Irmão não depõe, né? O cofre tá ali, mano, é só abrir." });
  });

  it("strips Otávio's real narrated tail and holds the rest to the cap", async () => {
    expect(OTAVIO_77).toContain("Boto um copo na mão dele e olho fixo.");
    const r = await run([OTAVIO_77, "Rapaz, baixa esse sorriso. Fala o que você viu na assinatura. Boto um copo na mão dele e olho fixo."], input(roomBefore(77, "Otávio")), HOTEL, as("Otávio"));
    expect(r.said).not.toMatch(/Boto|olho fixo/);
    expect(lengthOf(r.said)).toBeLessThanOrEqual(22);
    expect(r.seen.filter((k) => k === "narration_stripped")).toHaveLength(2);
    expect(r.calls).toBe(2);
  });

  it("retries a line that was only stage business, asking for the body channel, and says the real line", async () => {
    const r = await run(["Olho pra ela, sorriso atravessado.", "Irmão não depõe, né?"], input(roomBefore(52, "Renato")), HOTEL, as("Renato"));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain("body.gesture");
    expect(r.said).toBe("Irmão não depõe, né?");
    expect(r.seen).toEqual(["narration_stripped"]);
  });

  it("is silent when the retry is only stage business too, and keeps the model's face", async () => {
    const face = { body: { expression: "smile", order: "move_then_speak" } };
    const r = await run([["Olho pra ela, sorriso atravessado.", face], ["Sorrio de lado e cruzo os braços.", face]], input(roomBefore(52, "Renato"), [], null, true), HOTEL, as("Renato"));
    expect(r.calls).toBe(2);
    expect(r.value.intent.intentType).toBe("no_op");
    expect(r.value.intent.privateMotiveSummary).toMatch(/^Output guard: no fresh line \(only narration/);
    expect(r.value.intent.body?.expression).toBe("smile");
    expect(r.seen).toEqual(["narration_stripped", "narration_stripped", "guard_silenced"]);
  });

  it("is off with the script checks off", async () => {
    const r = await run([RENATO_52], input(roomBefore(52, "Renato")), { maxRetries: 2, roomThreshold: 0.7, strict: true }, as("Renato"));
    expect(r.said).toBe(RENATO_52);
  });
});

describe("quotes nobody made", () => {
  const OTAVIO_230 = said60(230);

  it("flags Otávio's real line (Heloísa never called Renato 'burro') in the one retry note, and strikes the sentence when it comes back", async () => {
    expect(OTAVIO_230).toContain("burro");
    const r = await run([OTAVIO_230, OTAVIO_230], input(roomBefore(230, "Otávio")), HOTEL, as("Otávio"));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain("burro");
    expect(r.system(1)).toContain("atribui a alguém algo que não foi dito");
    expect(r.said).toBe("Rapaz, chega aqui. Eu te ofereço o copo e um lugar na mesa.");
    // The line is also 24 words: both are in the one note (the real line is over the cap by 2).
    expect(r.system(1)).toContain("o limite é 22");
    expect(r.seen).toEqual(["len_retry", "quote_retry", "quote_struck"]);
    expect(r.infos.at(-1)).toMatchObject({ kind: "quote_struck", before: OTAVIO_230, after: r.said });
  });

  it("lets a true claim through: Heloísa did say 'irmão'", async () => {
    const r = await run(["Rapaz, chega aqui. Ela te chamou de irmão, só isso. Eu te ofereço o copo e um lugar na mesa."], input(roomBefore(230, "Otávio")), HOTEL, as("Otávio"));
    expect(r.calls).toBe(1);
    expect(r.seen).toEqual([]);
  });

  it("takes the retry that stops quoting", async () => {
    const r = await run([OTAVIO_230, "Rapaz, chega aqui. Eu te ofereço o copo e um lugar na mesa."], input(roomBefore(230, "Otávio")), HOTEL, as("Otávio"));
    expect(r.seen).toEqual(["len_retry", "quote_retry"]);
    expect(r.said).toBe("Rapaz, chega aqui. Eu te ofereço o copo e um lugar na mesa.");
  });
});

describe("one retry per turn", () => {
  const PATO = [
    line("ana", "Ana", "Você já viu um pato de perto, Bento?"),
    line("caco", "Caco", "Pato de perto eu nunca vi, juro."),
    line("ana", "Ana", "Quanto custou aquele relógio do primo?"),
  ];
  const BIG = "Um pato de perto não muda nada e eu ainda quero falar muito mais sobre isso porque essa história de pato de perto me incomoda demais desde ontem quando todo mundo ficou calado na sala.";

  it("puts every rule the first attempt broke in one note, makes one retry, and repairs what is left", async () => {
    expect(lengthOf(BIG)).toBeGreaterThan(22);
    const r = await run([BIG, BIG, BIG], input(PATO));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain("tem mais de um problema");
    expect(r.system(1)).toMatch(/1\. .*\n2\. /s);
    expect(r.system(1)).toContain("o limite é 22");
    expect(r.system(1)).toContain('"pato de perto"');
    expect(r.seen).toContain("len_retry");
    expect(r.seen).toContain("motif_retry");
  });

  it("does not offer a short reaction in the note any more", async () => {
    const r = await run(["Um pato de perto não muda nada.", "O relógio do primo parou ontem."], input(PATO));
    expect(r.system(1)).not.toContain("reação curta");
  });
});

describe("a silenced turn", () => {
  const PATO = [
    line("ana", "Ana", "Você já viu um pato de perto, Bento?"),
    line("caco", "Caco", "Pato de perto eu nunca vi, juro."),
    line("ana", "Ana", "Quanto custou aquele relógio do primo?"),
  ];
  const AGAIN = "Pato de perto, pato de perto, eu sei.";

  it("keeps the face the model gave it", async () => {
    const gesture = { body: { gesture: { kind: "laugh" }, order: "move_then_speak" } };
    const r = await run([["Um pato de perto não muda nada.", gesture], [AGAIN, gesture]], input(PATO, [], null, true));
    expect(r.value.intent.intentType).toBe("no_op");
    expect(r.value.intent.body?.gesture?.kind).toBe("laugh");
  });

  it("gives it a face for the strongest feeling the model named when it gave none", async () => {
    const r = await run([["Um pato de perto não muda nada.", { emotionDrivers: ["raiva contida"] }], [AGAIN, { emotionDrivers: ["raiva contida", "vergonha"] }]], input(PATO, [], null, true));
    expect(r.value.intent.intentType).toBe("no_op");
    expect(r.value.intent.body?.expression).toBe("angry");
    expect(r.value.intent.visibleContent).toBeUndefined();
  });

  it("adds no face when the run has no bodies, or the model named no feeling", async () => {
    const noBodies = await run([["Um pato de perto não muda nada.", { emotionDrivers: ["raiva"] }], [AGAIN, { emotionDrivers: ["raiva"] }]], input(PATO));
    expect(noBodies.value.intent.body).toBeUndefined();
    const noFeeling = await run([["Um pato de perto não muda nada.", { emotionDrivers: ["curiosidade"] }], [AGAIN, { emotionDrivers: ["curiosidade"] }]], input(PATO, [], null, true));
    expect(noFeeling.value.intent.body).toBeUndefined();
  });

  it("logs the line it held back: what the model wrote and nothing after", async () => {
    const r = await run(["Um pato de perto não muda nada.", AGAIN], input(PATO));
    expect(r.infos).toEqual([
      { kind: "motif_retry", actor: "Bento", before: "Um pato de perto não muda nada." },
      { kind: "guard_silenced", actor: "Bento", before: AGAIN, after: "" },
    ]);
  });
});
