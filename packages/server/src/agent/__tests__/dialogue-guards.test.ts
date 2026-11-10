import { describe, expect, it } from "vitest";
import type { CommittedEvent } from "@perfectman/shared";
import {
  NARRATION_VERBS_PT,
  falseQuotes,
  sentencesOf,
  stripNarration,
  withoutFalseQuotes,
} from "@perfectman/shared";
import { expressionFor, mergeRetryNotes, quoteRetryNote, silenceMotive, spokenLines } from "../script-guard.js";
import { GUARD_LOG_RULE } from "../repetition-guard.js";
import { hotelInput } from "./hotel-test-helpers.js";
import { NORMAL } from "./fixtures/ptbr-lines.js";
import { RUN_LINES, roomOf, said } from "./fixtures/run-lines.js";

describe("narration", () => {
  it("takes the two narrated sentences of run 60 out of the lines they were said in, and nothing else", () => {
    const renato = stripNarration(said(52));
    expect(renato.removed).toEqual(["Olho pra ela, sorriso atravessado."]);
    expect(renato.text.startsWith("Irmão não depõe, né?")).toBe(true);
    expect(renato.text.endsWith("O cofre tá ali, mano, é só abrir.")).toBe(true);
    const otavio = stripNarration(said(77));
    expect(otavio.removed).toEqual(["Boto um copo na mão dele e olho fixo."]);
    expect(otavio.text).toBe("Rapaz, baixa esse sorriso. Fala o que você viu na assinatura, alto, agora. Cofre a gente abre às nove. E aí você põe o preço, não ela.");
  });

  it("changes no other bot line of the 8 production runs, and none of the 128 ordinary lines", () => {
    const touched = Object.values(RUN_LINES)
      .flat()
      .filter((l) => stripNarration(l.text).removed.length > 0)
      .map((l) => l.text);
    expect(touched).toHaveLength(2);
    expect(NORMAL.length).toBeGreaterThanOrEqual(128);
    expect(NORMAL.filter((l) => stripNarration(l).removed.length > 0)).toEqual([]);
  });

  it("is empty when the line was only narration, and keeps what is spoken, quoted, asked or promised", () => {
    expect(stripNarration("Olho pra ela, sorriso atravessado.")).toEqual({ text: "", removed: ["Olho pra ela, sorriso atravessado."] });
    expect(stripNarration("Sento. Respiro fundo. Tá bom, eu falo.").text).toBe("Tá bom, eu falo.");
    expect(stripNarration("Abro o cofre amanhã, prometo.").removed).toEqual([]);
    expect(stripNarration("Dou o que você quiser.").removed).toEqual([]);
    expect(stripNarration("Deixo ele ir se você pagar.").removed).toEqual([]);
    expect(stripNarration('Ela disse "olho pra você". Olho?').removed).toEqual([]);
    expect(stripNarration("Olho pra ela, você viu?").removed).toEqual([]);
    expect(stripNarration("Eu olho pra ela e sorrio.").removed).toEqual([]);
  });

  it("reads me-verbs and a leading 'e', and English openers", () => {
    expect(stripNarration("Me levanto devagar. Cadê o dinheiro?").text).toBe("Cadê o dinheiro?");
    expect(stripNarration("E olho fixo pra ele. Fala.").text).toBe("Fala.");
    expect(stripNarration("I look at her, half smiling. Where is the money?").text).toBe("Where is the money?");
    expect(stripNarration("I put a glass in his hand. Drink.").text).toBe("Drink.");
    expect(stripNarration("I give you my word.").removed).toEqual([]);
  });

  it("knows about 80 first-person verbs", () => {
    expect(NARRATION_VERBS_PT.size).toBeGreaterThanOrEqual(80);
    for (const v of ["olho", "boto", "pego", "levanto", "sento", "sorrio", "viro", "cruzo", "encaro", "aponto", "bato", "puxo", "empurro", "abro", "fecho", "ponho", "dou", "tiro", "deixo", "ando", "caminho", "respiro", "suspiro", "cerro"]) {
      expect(NARRATION_VERBS_PT.has(v), v).toBe(true);
    }
  });

  it("never splits a quotation", () => {
    expect(sentencesOf('Ela disse: "Sai. Olho pra você." Mentira.')).toEqual(['Ela disse: "Sai. Olho pra você."', "Mentira."]);
    expect(sentencesOf("Ele falou «não vem. nunca» e saiu. Ok.")).toEqual(["Ele falou «não vem. nunca» e saiu.", "Ok."]);
  });
});

describe("quotes and claims nobody made", () => {
  it("flags Otávio's 'burro' (Heloísa never said it) and passes what she did say", () => {
    const room = roomOf(230, "Otávio");
    const real = falseQuotes(said(230), room);
    expect(real.map((i) => [i.kind, i.claim])).toEqual([["called", "burro"]]);
    expect(real[0]!.sentence).toBe("Ela te chamou de irmão e de burro na mesma frase.");
    expect(falseQuotes("Rapaz, chega aqui. Ela te chamou de irmão, só isso.", room)).toEqual([]);
    // Heloísa called him "rapaz": a named speaker, a word she said.
    expect(falseQuotes("Heloísa te chamou de rapaz de novo.", room)).toEqual([]);
    expect(falseQuotes("Heloísa te chamou de ladrão.", room).map((i) => i.claim)).toEqual(["ladrão"]);
  });

  it("checks a quoted span of 3 words or more against the last 10 lines: straight, curly and guillemet quotes", () => {
    const room = roomOf(80, "Otávio");
    expect(falseQuotes('Ela disse "irmão não depõe contra irmã" na minha cara.', room)).toEqual([]);
    expect(falseQuotes("Ela disse “irmão não depõe contra irmã” na minha cara.", room)).toEqual([]);
    expect(falseQuotes("Ela disse «irmão não depõe contra irmã» na minha cara.", room)).toEqual([]);
    for (const open of ['"', "“", "«"]) {
      const close = open === '"' ? '"' : open === "“" ? "”" : "»";
      const bad = falseQuotes(`Ela disse ${open}o cofre abre hoje de manhã${close} na minha cara.`, room);
      expect(bad.map((i) => i.kind), open).toEqual(["quote"]);
    }
    // A near-verbatim quote (80% of its trigrams in one line) is said; a two-word one is a word, not a claim.
    expect(falseQuotes('Ela disse "o rapaz é meu irmão, Otávio, e irmão não depõe" mesmo.', room)).toEqual([]);
    expect(falseQuotes('Ela disse "meu irmão" e riu.', room)).toEqual([]);
  });

  it("checks 'X disse que ...' on content words, for a speaker in view, and leaves what it cannot check", () => {
    const room = roomOf(100, "Otávio");
    expect(falseQuotes("Heloísa disse que o cofre abre amanhã.", room)).toEqual([]);
    expect(falseQuotes("Heloísa disse que vendeu a casa inteira ontem.", room).map((i) => i.kind)).toEqual(["said"]);
    // No line of Henrique in view, a claim of two content words, a quote with no one said it, "falou de" with no "que": nothing to check.
    expect(falseQuotes("Henrique disse que vendeu a casa inteira ontem.", room)).toEqual([]);
    expect(falseQuotes("Heloísa disse que vendeu tudo.", room)).toEqual([]);
    expect(falseQuotes('A carta diz "não confie em ninguém aqui" e eu confio.', roomOf(10, "Otávio"))).toEqual([]);
    expect(falseQuotes("Ela falou como quem já escolheu o culpado antes do café.", room)).toEqual([]);
  });

  it("strikes the sentence that carries the claim and nothing else", () => {
    const issues = falseQuotes(said(230), roomOf(230, "Otávio"));
    expect(withoutFalseQuotes(said(230), issues)).toBe("Rapaz, chega aqui. Eu te ofereço o copo e um lugar na mesa.");
    expect(withoutFalseQuotes("Ela te chamou de burro.", falseQuotes("Ela te chamou de burro.", roomOf(230, "Otávio")))).toBe("");
  });

  it("flags none of the bot lines of the 8 production runs except 'burro', and at most 1% of the 128 ordinary lines", () => {
    const flagged: string[] = [];
    for (const lines of Object.values(RUN_LINES)) {
      lines.forEach((l, i) => {
        const room = lines.slice(Math.max(0, i - 10), i).map((x) => ({ speaker: x.name, text: x.text, own: x.name === l.name }));
        if (falseQuotes(l.text, room).length > 0) flagged.push(l.text);
      });
    }
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toContain("burro");
    const ordinary = NORMAL.filter((text, i) => falseQuotes(text, NORMAL.slice(Math.max(0, i - 10), i).map((t, j) => ({ speaker: (i + j) % 2 ? "Ana" : "Bia", text: t }))).length > 0);
    // "Ele disse que é por causa da reforma do telhado." says what someone said with nothing in view that says it: the one flag.
    expect(ordinary.length / NORMAL.length).toBeLessThanOrEqual(0.01);
  });

  it("names the claim in the retry note, in the actor's language", () => {
    const issues = falseQuotes(said(230), roomOf(230, "Otávio"));
    expect(quoteRetryNote(issues, "pt-BR")).toContain('("burro")');
    expect(quoteRetryNote(issues, "en")).toContain('("burro")');
  });
});

describe("helpers", () => {
  it("a silenced turn's motive is engine-written, and the retry notes merge under one heading", () => {
    expect(silenceMotive("nothing the room had not just heard")).toMatch(/^Output guard: no fresh line \(nothing/);
    expect(mergeRetryNotes(["IMPORTANTE: a", "IMPORTANTE: b"], "pt-BR")).toBe("IMPORTANTE: sua última tentativa tem mais de um problema; corrija todos de uma vez.\n1. a\n2. b");
    expect(mergeRetryNotes(["IMPORTANT: only"], "en")).toBe("IMPORTANT: only");
    expect(mergeRetryNotes([], "en")).toBe("");
  });

  it("gives the strongest named feeling a face, and no face to one it has none for", () => {
    expect(expressionFor(["raiva contida", "vergonha"])).toBe("angry");
    expect(expressionFor(["Vergonha"])).toBe("sad");
    expect(expressionFor(["surpresa", "raiva"])).toBe("surprised");
    expect(expressionFor(["amusement"])).toBe("smile");
    expect(expressionFor(["curiosidade", "pressa"])).toBeUndefined();
    expect(expressionFor([])).toBeUndefined();
  });

  it("every kind of thing a guard does that changes a line has a log rule", () => {
    const kinds = Object.keys(GUARD_LOG_RULE);
    expect(kinds).toContain("guard_silenced");
    expect(GUARD_LOG_RULE.stall_nudge).toBeUndefined();
    expect(GUARD_LOG_RULE.held_repeat).toBeUndefined();
    expect(new Set(Object.values(GUARD_LOG_RULE))).toEqual(
      new Set(["len_retry", "len_trim", "motif_retry", "novelty_retry", "echo_own", "echo_room", "phrase_loop", "garble", "garble_drop", "debt_note", "debt_retry", "silenced", "narration_stripped", "quote_struck", "answer_note", "motif_strike", "debt_strip", "quote_retry"]),
    );
  });

  it("spokenLines marks a guest's line so no note quotes it", () => {
    const input = hotelInput([{ id: "g1", simulationId: "s", channelId: "room:lounge", actorId: "h:42", type: "message_sent", payload: { content: "Eu vi tudo.", senderName: "Visitante", untrusted: true }, createdAt: 1, pulseIndex: 1, sourceEventIds: [], emotionalSalience: "low", visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" } } as CommittedEvent]);
    expect(spokenLines(input.perceptionPacket).map((l) => l.untrusted)).toEqual([true]);
  });
});
