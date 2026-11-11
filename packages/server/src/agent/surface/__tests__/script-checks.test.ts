import { describe, expect, it } from "vitest";
import { isEngineAuthoredMotive, lengthOf } from "@perfectman/shared";
import { lengthTargetOf } from "../../script-guard.js";
import { HOTEL, LONG, QUIET, input, line, profileOf, run } from "./script-step-harness.js";

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

  it("reads the actor's own last lines from the packet too, not only the events in view", async () => {
    const mine = "O cofre emprestado sumiu da sala dos fundos esta madrugada, ninguém viu nada.";
    const again = "Madrugada fria, cofre sumido, ninguém viu quem levou da sala dos fundos o cofre emprestado.";
    const fresh = "Quem pagou a conta do bar foi o Caco, eu vi o recibo dobrado no bolso dele.";
    const withOwn = await run([again, fresh], input(QUIET, [mine]));
    // "again" is also an echo of "mine" by its topic words (7 of 10 shared, in another order): the short-line set rule flags it before the novelty check does.
    expect(withOwn.seen).toEqual(["repeat_own", "novelty_retry"]);
    expect(withOwn.said).toBe(fresh);
    // Without that own line in the packet nothing in view says it again.
    expect((await run([again], input(QUIET))).calls).toBe(1);
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
