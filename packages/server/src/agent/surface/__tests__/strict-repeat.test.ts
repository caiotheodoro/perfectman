import { beforeEach, describe, it, expect, vi } from "vitest";
import type { AgentRuntimeInput, CommittedEvent, LLMProviderResult } from "@perfectman/shared";
import type { LLMConfig } from "../../../llm/llm-config.js";
import { llmBudget } from "../../../llm/llm-budget.js";
import { ActionIntentStep, garbleRetryNote, loopRetryNote } from "../action-intent-step.js";
import type { StepRunContext } from "../llm-step.js";
import type { GuardKind, RepetitionPolicy } from "../../repetition-guard.js";
import { CAIO_JOKE, GARBLED, HELOISA, IAN_FIRST, IAN_SECOND, NORMAL, PISTOLINHA } from "../../__tests__/fixtures/ptbr-lines.js";

const answer = (visibleContent: string): LLMProviderResult => ({
  content: JSON.stringify({ intentType: "send_message", channelTarget: "general", visibleContent, privateMotiveSummary: "Uma razão de verdade.", emotionDrivers: [], motivationDrivers: [] }),
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

function input(own: string[], visible: CommittedEvent[] = [], trigger: CommittedEvent | null = null): AgentRuntimeInput {
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
// The budget is process-wide and counts calls per simulation per minute: a retry past the limit would be denied.
beforeEach(() => llmBudget.reset());

const HOTEL: RepetitionPolicy = { maxRetries: 2, roomThreshold: 0.7, strict: true };
const profile = { language: "pt-BR" } as StepRunContext["profile"];

async function run(answers: string[], inp: AgentRuntimeInput, policy: RepetitionPolicy = HOTEL) {
  const generateIntent = vi.fn();
  for (const a of answers) generateIntent.mockResolvedValueOnce(answer(a));
  const seen: GuardKind[] = [];
  const ctx: StepRunContext = { now: 1000, pulseIndex: 3, provider: { generateIntent } as StepRunContext["provider"], llmConfig, profile, prompt, repetitionPolicy: { ...policy, onGuard: (k) => seen.push(k) } };
  const outcome = await new ActionIntentStep().execute(inp, ctx);
  const value = outcome.ok ? outcome.value : outcome.fallback;
  const system = (n: number): string => (generateIntent.mock.calls[n]![2] as { system: string }).system;
  return { value, calls: generateIntent.mock.calls.length, system, seen, said: value.intent.visibleContent, motive: value.intent.privateMotiveSummary };
}

describe("the shapes that got through on 2026-11-10", () => {
  it("run 56, Ian: his sentence with a changed tail goes out untouched without strict mode (the production gap)", async () => {
    const r = await run([IAN_SECOND], input([IAN_FIRST]), { maxRetries: 2, roomThreshold: 0.7 });
    expect(r.calls).toBe(1);
    expect(r.value.fallbackApplied).toBe(false);
    expect(r.said).toBe(IAN_SECOND);
  });

  it("run 56, Ian: with strict mode it is retried with the repeat note and the new line goes out", async () => {
    const r = await run([IAN_SECOND, "Caio, abre esse envelope de uma vez."], input([IAN_FIRST]));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain("parecida demais com algo que você já disse");
    expect(r.said).toBe("Caio, abre esse envelope de uma vez.");
    expect(r.seen).toEqual(["repeat_own"]);
  });

  it("run 56, Caio: the same joke 27 s later, with other lines between, is blocked when the retries repeat it", async () => {
    const own = [CAIO_JOKE, NORMAL[3]!, NORMAL[9]!];
    const r = await run([CAIO_JOKE, CAIO_JOKE.replace("KKKKK", "KKKKKKK"), CAIO_JOKE], input(own));
    expect(r.calls).toBe(3);
    expect(r.value.fallbackApplied).toBe(true);
    expect(r.value.intent.intentType).toBe("no_op");
    expect(r.motive).toMatch(/^Repetition guard: near-duplicate of a message you already sent, even after 2 retries/);
    expect(r.seen).toEqual(["repeat_own", "repeat_own", "repeat_own", "repeat_blocked"]);
  });

  it("run 56: a copy of what another actor just said is retried and then blocked, naming the room", async () => {
    const said = line("e1", "agent-b", CAIO_JOKE);
    const r = await run([CAIO_JOKE, CAIO_JOKE, CAIO_JOKE], input([], [said]));
    expect(r.calls).toBe(3);
    expect(r.motive).toMatch(/someone else in the room just said/);
    expect(r.seen).toEqual(["repeat_room", "repeat_room", "repeat_room", "repeat_blocked"]);
  });

  it("run 57, Pistolinha: the pato question is retried with a note that names it and asks for news or a decision", async () => {
    const r = await run(["Antes de qualquer coisa eu preciso saber, e não adianta fugir da pergunta, Caio: você já viu um pato de perto?", "Abre o envelope, Caio. Agora."], input(PISTOLINHA.slice(0, 3)));
    expect(r.calls).toBe(2);
    const note = r.system(1);
    expect(note).toContain("você já viu um pato de perto");
    expect(note).toContain("Traga uma informação nova ou tome uma decisão agora");
    expect(r.said).toBe("Abre o envelope, Caio. Agora.");
    expect(r.seen).toEqual(["phrase_loop"]);
  });

  it("run 57: the loop survives the retries and the turn is blocked with a motive that names the phrase, not a send", async () => {
    const again = "Antes de mais nada eu preciso saber, e não adianta fugir da pergunta, Caio: você já viu um pato de perto?";
    const r = await run([again, again, again], input(PISTOLINHA.slice(0, 3)));
    expect(r.calls).toBe(3);
    expect(r.value.intent.intentType).toBe("no_op");
    expect(r.motive).toMatch(/^Repetition guard: a signature phrase \("[^"]*viu um pato de perto[^"]*"\) you keep coming back to, even after 2 retries/);
    expect(r.seen.at(-1)).toBe("repeat_blocked");
  });

  it("run 53, Heloísa: the closing tic is named and banned on the retry", async () => {
    const tic = "Ninguém precisa saber do que o Otávio assinou, meu bem... não é, querido?";
    const r = await run([tic, "Foi o Otávio quem assinou, e eu vi com meus olhos."], input(HELOISA.slice(0, 3)));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain('"não é querido"');
    expect(r.said).toBe("Foi o Otávio quem assinou, e eu vi com meus olhos.");
  });

  it("run 56: a garbled token is retried once with a note that names it, and the clean line goes out", async () => {
    const r = await run([GARBLED[0]!, "Mano, fala sério, ninguém merece isso."], input([]));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain("Éduğunu");
    expect(r.said).toBe("Mano, fala sério, ninguém merece isso.");
    expect(r.seen).toEqual(["garble"]);
  });

  it("run 56: a second garbled answer is dropped, after exactly one retry even though two are allowed", async () => {
    const r = await run([GARBLED[0]!, GARBLED[1]!, "nunca chega aqui"], input([]));
    expect(r.calls).toBe(2);
    expect(r.value.fallbackApplied).toBe(true);
    expect(r.value.intent.intentType).toBe("no_op");
    expect(r.motive).toMatch(/^Output guard: corrupt text \("umapreciação"\) in the line, even after a retry/);
    expect(r.seen).toEqual(["garble", "garble", "garble_dropped"]);
    // A dropped line is not a provider failure: it must not feed the breaker or the health watch.
    expect(r.value.operatorEvents.map((e) => e.type)).not.toContain("llm_failure");
    expect(r.value.operatorEvents.map((e) => e.type)).toContain("intent_blocked");
  });
});

describe("what stays as it was", () => {
  it("is inert without strict: a loop, a garble and a changed-tail repeat all go out", async () => {
    for (const [said, own] of [
      ["Me diz, você já viu um pato de perto?", PISTOLINHA.slice(0, 3)],
      [GARBLED[0]!, []],
      [IAN_SECOND, [IAN_FIRST]],
    ] as const) {
      const r = await run([said], input([...own]), { maxRetries: 2, roomThreshold: 0.7 });
      expect(r.calls).toBe(1);
      expect(r.said).toBe(said);
      expect(r.seen).toEqual([]);
    }
  });

  it("a normal line is never retried and nothing is counted", async () => {
    const r = await run(["Fui eu que abri a porta, e daí?"], input(NORMAL.slice(0, 8)));
    expect(r.calls).toBe(1);
    expect(r.seen).toEqual([]);
  });

  it("a person who asked is still answered with a repeat after the retries, but never with corrupt text", async () => {
    const asked = line("g1", "h:1", "Agent A, você viu o gato hoje?", { untrusted: true, addresseeIds: ["agent-a"] });
    const same = await run([IAN_FIRST, IAN_FIRST, IAN_FIRST], input([IAN_FIRST], [asked], asked));
    expect(same.calls).toBe(3);
    expect(same.value.fallbackApplied).toBe(false);
    expect(same.said).toBe(IAN_FIRST);
    const garbled = await run([GARBLED[0]!, GARBLED[1]!], input([], [asked], asked));
    expect(garbled.value.intent.intentType).toBe("no_op");
    expect(garbled.seen.at(-1)).toBe("garble_dropped");
  });

  it("a person who asked gets a loop note that keeps the answer aimed at them", () => {
    expect(loopRetryNote("viu um pato", "pt-BR", true)).toContain("espera uma resposta");
    expect(loopRetryNote("viu um pato", "pt-BR", false)).toContain("tome uma decisão");
    expect(loopRetryNote("seen a duck", "en", false)).toContain("make a decision now");
    expect(garbleRetryNote("Éduğunu", "en")).toContain("Éduğunu");
  });

  it("a counter hook that throws does not break the turn", async () => {
    const generateIntent = vi.fn().mockResolvedValueOnce(answer(IAN_SECOND)).mockResolvedValueOnce(answer("Caio, abre o envelope."));
    const ctx: StepRunContext = { now: 1000, pulseIndex: 3, provider: { generateIntent } as StepRunContext["provider"], llmConfig, profile, prompt, repetitionPolicy: { ...HOTEL, onGuard: () => { throw new Error("boom"); } } };
    const out = await new ActionIntentStep().execute(input([IAN_FIRST]), ctx);
    expect(out.ok && out.value.intent.visibleContent).toBe("Caio, abre o envelope.");
  });
});
