import { describe, expect, it } from "vitest";
import type { CommittedEvent, OwedLine } from "@perfectman/shared";
import {
  ANSWER_WORDS,
  FILLER_WORDS,
  MOVE_PHRASES,
  NARRATION_VERBS_PT,
  SCRIPT_NORMS,
  answersFirst,
  falseQuotes,
  isRealAnswer,
  joinedKeys,
  lowNovelty,
  majorMoveOf,
  motifRepeat,
  moveBefore,
  nameKeysOf,
  noveltyFloor,
  owedQuestion,
  sentencesOf,
  stripNarration,
  wordsOf,
  withoutFalseQuotes,
} from "@perfectman/shared";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import { PromptBuilder } from "../prompt-builder.js";
import { ActionIntentStep } from "../surface/action-intent-step.js";
import { answerNote, answerNoteFor, expressionFor, mergeRetryNotes, quoteRetryNote, silenceMotive, spokenLines } from "../script-guard.js";
import { GUARD_LOG_RULE } from "../repetition-guard.js";
import type { GuardKind } from "../repetition-guard.js";
import { hotelInput } from "./hotel-test-helpers.js";
import { NORMAL } from "./fixtures/ptbr-lines.js";
import { RUN60, RUN_LINES } from "./fixtures/run-lines.js";

/** The last 10 lines of the real run 60 before second `upTo`, as the guards read the room: the actor's own lines marked. */
const roomOf = (upTo: number, me: string): Array<OwedLine & { own: boolean }> =>
  RUN60.filter((l) => l.t < upTo)
    .slice(-10)
    .map((l) => ({ speaker: l.name, text: l.text, own: l.name === me }));
const said = (t: number): string => RUN60.find((l) => l.t === t)!.text;

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

describe("moves made at an actor", () => {
  const names = (n: string) => nameKeysOf([n]);

  it("run 60: Renato's 'eu vi a caneta na sua mão, Heloísa' is a reveal, and the next speaker is told", () => {
    const room = roomOf(259, "Heloísa").slice(-3);
    expect(room.at(-1)!.text).toBe(said(251));
    const heloisa = moveBefore(room, names("Heloísa"), "heloisa");
    expect(heloisa).toMatchObject({ kind: "reveal", speaker: "Renato", named: true });
    // Otávio is not named: he is in the room, and a reveal said to the table is his to answer too.
    const otavio = moveBefore(room.map((l) => ({ ...l, own: l.speaker === "Otávio" })), names("Otávio"), "otavio");
    expect(otavio).toMatchObject({ kind: "reveal", named: false });
  });

  it("the note quotes the first 12 words and says what to do first", () => {
    const m = moveBefore(roomOf(259, "Heloísa").slice(-3), names("Heloísa"), "heloisa")!;
    expect(answerNote(m, "pt-BR")).toBe('Renato acabou de revelar: "Ahahah, tá bom. Mas eu vi a caneta na sua mão, Heloísa.". Reaja a isso primeiro: negar, admitir, contra-atacar ou ceder. Não ignore.');
    expect(answerNote({ ...m, kind: "accusation" }, "pt-BR")).toContain("acabou de acusar");
    expect(answerNote({ ...m, kind: "threat" }, "pt-BR")).toContain("acabou de ameaçar");
    expect(answerNote({ ...m, kind: "proposal" }, "pt-BR")).toContain("acabou de propor");
    expect(answerNote({ ...m, text: "I saw the pen in your hand." }, "en")).toBe('Renato just revealed: "I saw the pen in your hand.". React to that first: deny, admit, counter or give in. Do not ignore it.');
  });

  it("a neutral line, the actor's own line, a guest's line and an older line make no note", () => {
    expect(moveBefore(roomOf(251, "Heloísa").slice(-2), names("Heloísa"), "heloisa")).toBeUndefined(); // Ué. / Ah.
    expect(moveBefore(roomOf(259, "Renato").slice(-3), names("Renato"), "renato")).toBeUndefined(); // his own reveal
    const guest = [{ speaker: "Visitante", text: "Eu vi a caneta na sua mão, Heloísa.", untrusted: true }];
    expect(moveBefore(guest, names("Heloísa"), "heloisa")).toBeUndefined();
    const older = [...roomOf(259, "Heloísa").slice(-3), { speaker: "Otávio", text: "Café eu tomo, minha cara.", own: false }];
    expect(moveBefore(older, names("Heloísa"), "heloisa")).toBeUndefined();
  });

  it("the lexicon: reveal, accusation, blackmail and offer, with whole words and accents folded", () => {
    const kind = (text: string) => majorMoveOf(joinedKeys(wordsOf(text)));
    expect(kind("Eu vi você com a caneta.")).toBe("reveal");
    expect(kind("Sei que você assinou aquilo.")).toBe("accusation");
    expect(kind("Foi VOCÊ que falsificou a assinatura!")).toBe("accusation");
    expect(kind("Cofre hoje, senão eu conto pra mesa.")).toBe("threat");
    expect(kind("Cofre ou eu abro a boca.")).toBe("threat");
    expect(kind("Escândalo não interessa a ninguém aqui.")).toBe("threat");
    expect(kind("Se não pagar, eu conto tudo.")).toBe("threat");
    expect(kind("A mão que apertou era sua.")).toBe("reveal");
    expect(kind("Eu pago o que você viu, adiantado.")).toBe("proposal");
    expect(kind("I saw the pen in your hand.")).toBe("reveal");
    // Whole words: "mentiu" is not in "mentiubra", and "se não for incômodo" is not a threat.
    expect(kind("Mentiubra é uma palavra inventada.")).toBeUndefined();
    expect(kind("Se não for incômodo, eu queria um café.")).toBeUndefined();
    expect(kind("Hm.")).toBeUndefined();
    for (const list of Object.values(MOVE_PHRASES)) expect(list.length).toBeGreaterThan(5);
  });

  it("fires after at most 5% of the 128 ordinary lines, and the ones it fires on are moves", () => {
    const fired: string[] = [];
    for (let i = 3; i < NORMAL.length; i++) {
      const room = NORMAL.slice(Math.max(0, i - 10), i).map((text, j) => ({ speaker: j % 2 ? "Ana" : "Bia", text }));
      if (moveBefore(room, names("Caco"), "caco")) fired.push(room.at(-1)!.text);
    }
    expect(fired.length / (NORMAL.length - 3)).toBeLessThanOrEqual(0.05);
  });
});

describe("the prompt of an actor a move was made at", () => {
  const profile = { ...EXAMPLE_PROMPT_PROFILE, language: "pt-BR" as const, hotelMode: true, relationshipBiases: {}, messageLength: "short" as const, displayName: "Heloísa" };
  const withScript = { ...profile, scriptPrompt: { length: { aim: [5, 12] as [number, number], cap: 22, sentences: 2 } } };
  const ev = (id: string, actorId: string, name: string, content: string): CommittedEvent =>
    ({ id, simulationId: "sim-1", channelId: "room:lounge", actorId, type: "message_sent", payload: { content, senderName: name }, createdAt: 1, pulseIndex: 1, sourceEventIds: [], emotionalSalience: "low", visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" } }) as CommittedEvent;
  const events = [ev("e1", "otavio", "Otávio", said(207)), ev("e2", "renato", "Renato", said(251))];

  it("compact and full: the note is in the decision, the prompt is flagged, and with the checks off neither is", () => {
    for (const style of ["compact", undefined] as const) {
      const on = PromptBuilder.build(hotelInput(events), withScript, "action_intent", undefined, style);
      const off = PromptBuilder.build(hotelInput(events), profile, "action_intent", undefined, style);
      expect(on.system + on.user).toContain('Renato acabou de revelar: "Ahahah, tá bom. Mas eu vi a caneta');
      expect(on.answerNoted).toBe(true);
      expect(off.system + off.user).not.toContain("acabou de revelar");
      expect(off.answerNoted).toBeUndefined();
    }
  });

  it("a neutral last line gives no note", () => {
    const calm = [...events, ev("e3", "heloisa", "Heloísa", "Ah."), ev("e4", "otavio", "Otávio", "Café eu tomo, minha cara.")];
    const built = PromptBuilder.build(hotelInput(calm), withScript, "action_intent", undefined, "compact");
    expect(built.answerNoted).toBeUndefined();
    expect(answerNoteFor(hotelInput(calm), "Heloísa", "pt-BR")).toBeUndefined();
  });

  it("render() reports the note to the guard log with the text it added", () => {
    const seen: Array<[GuardKind, unknown]> = [];
    const built = new ActionIntentStep().render(hotelInput(events), {
      now: 1,
      pulseIndex: 1,
      provider: {} as never,
      llmConfig: { providerType: "mock", modelName: "m", baseUrl: "http://x", temperature: 1, maxOutputTokens: 100, timeoutMs: 1000, retryCount: 0, responseFormatJson: true } as never,
      profile: withScript,
      repetitionPolicy: { script: true, onGuard: (k, info) => seen.push([k, info]) },
    });
    expect(built.answerNoted).toBe(true);
    expect(seen).toEqual([["answer_note", { actor: "Heloísa", after: expect.stringContaining("Renato acabou de revelar") }]]);
  });
});

describe("what answers a question, for the guard", () => {
  it("a filler is not an answer, whatever its length", () => {
    for (const filler of ["Tá.", "Ah.", "Hm.", "Ué.", "Sei.", "Hm, sei.", "Ah, tá bom.", "Okay."]) expect(isRealAnswer(filler), filler).toBe(false);
    expect(FILLER_WORDS.has("ue")).toBe(true);
  });

  it("4 words, a yes, no or where-and-when word, or two words with a real one are", () => {
    for (const real of ["Não.", "Sim, claro.", "Fui eu.", "Ontem à noite.", "Na gaveta.", "Talvez, mano.", "O cofre abre amanhã.", "Não sei."]) expect(isRealAnswer(real), real).toBe(true);
    expect(ANSWER_WORDS.has("nao")).toBe(true);
  });

  it("run 60: Heloísa's 'Ah.' after Renato's reveal answers nothing, so the debt stays", () => {
    const lines: OwedLine[] = [
      { speaker: "Renato", text: "Heloísa, então me responde: quem segurou a caneta?", own: false },
      { speaker: "Heloísa", text: "Ah.", own: true },
      { speaker: "Otávio", text: "Café eu tomo, minha cara.", own: false },
      { speaker: "Otávio", text: "Rapaz, caneta de morto não paga.", own: false },
    ];
    const owed = owedQuestion(lines, (l) => l.own === true, nameKeysOf(["Heloísa"]), "heloisa", 2);
    expect(owed?.asker).toBe("Renato");
    const answered = owedQuestion([lines[0]!, { ...lines[1]!, text: "A caneta era do meu Henrique, ora." }, lines[2]!, lines[3]!], (l) => l.own === true, nameKeysOf(["Heloísa"]), "heloisa", 2);
    expect(answered).toBeUndefined();
  });

  it("a candidate answers first only with a real answer before its questions", () => {
    expect(answersFirst("Não sei. E você?")).toBe(true);
    expect(answersFirst("Tá. E você, onde estava?")).toBe(false);
    expect(answersFirst("Hm. Sei.")).toBe(false);
    expect(answersFirst("E você, onde estava? Eu estava em casa.")).toBe(false);
    expect(answersFirst("Eu estava em casa, Ana. E você?")).toBe(true);
  });
});

describe("novelty, judged against the actor's own lines and the turn before", () => {
  const floor = noveltyFloor(SCRIPT_NORMS, "pt");
  const names = nameKeysOf(["Heloísa", "Otávio", "Renato"]);

  it("run 60: the lines the old rule flagged for sharing the scene's words (the safe, the pen, the brother) are not flagged", () => {
    for (const t of [42, 52, 68, 180, 219, 230, 285, 342, 406]) {
      expect(lowNovelty(said(t), roomOf(t, RUN60.find((l) => l.t === t)!.name), floor, { names }), `t=${t}`).toBeUndefined();
    }
  });

  it("flags a line that says again what the actor said in its own last lines", () => {
    const flagged = lowNovelty(said(135), roomOf(135, "Otávio"), floor, { names });
    expect(flagged?.novelty).toBeLessThan(floor);
  });

  it("without own marks only the turn before counts; with `self` the actor's lines do", () => {
    const room = roomOf(135, "Otávio").map(({ speaker, text }) => ({ speaker, text }));
    expect(lowNovelty(said(135), room, floor, { names })).toBeUndefined();
    expect(lowNovelty(said(135), room, floor, { names, self: "Otávio" })).toBeDefined();
  });

  it("ignores the scene's own words: proper nouns and the five most frequent room words", () => {
    const room: OwedLine[] = [
      { speaker: "Ana", text: "O cofre da Heloísa está aberto, o cofre sempre abre.", own: false },
      { speaker: "Bia", text: "Cofre aberto de madrugada e ninguém viu a Heloísa.", own: false },
      { speaker: "Ana", text: "Heloísa guarda o cofre aberto com a chave dentro do cofre.", own: false },
    ];
    const candidate = "Heloísa deixou o cofre aberto, madrugada, ninguém viu, chave dentro, ninguém.";
    expect(lowNovelty(candidate, room, floor, { names: new Set() })).toBeUndefined();
  });

  it("flag rates: the 128 ordinary lines under 5% of turns, the bot lines of runs 52-60 below half the old rule's", () => {
    let turns = 0;
    let flaggedOrdinary = 0;
    for (let shift = 0; shift < NORMAL.length; shift += 17) {
      const lines = [...NORMAL.slice(shift), ...NORMAL.slice(0, shift)];
      for (let i = 3; i < lines.length; i++) {
        const room = lines.slice(Math.max(0, i - 6), i).map((text, j) => ({ speaker: (i - 6 + j) % 2 ? "Ana" : "Bia", text, own: (Math.max(0, i - 6) + j) % 2 === i % 2 }));
        turns++;
        if (lowNovelty(lines[i]!, room, floor, { names: nameKeysOf(["Ana", "Bia"]) })) flaggedOrdinary++;
      }
    }
    expect(flaggedOrdinary / turns).toBeLessThan(0.05);

    let bot = 0;
    let flaggedBot = 0;
    for (const lines of Object.values(RUN_LINES)) {
      const all = nameKeysOf(lines.map((l) => l.name));
      for (let i = 3; i < lines.length; i++) {
        const room = lines.slice(Math.max(0, i - 10), i).map((l) => ({ speaker: l.name, text: l.text, own: l.name === lines[i]!.name }));
        bot++;
        if (lowNovelty(lines[i]!.text, room, floor, { names: all })) flaggedBot++;
      }
    }
    // Measured 2026-11-10: the old rule (the room's last 6 turns) flagged 54% of these turns, this one 24%: the rest are runs that do loop on a few words.
    expect(flaggedBot / bot).toBeLessThan(0.3);
  });

  it("the motif check still names the production phrase", () => {
    const room = [
      { speaker: "Pistolinha", text: "Escuta, Caio, você já viu um pato de perto?" },
      { speaker: "Caio", text: "Pato de perto eu nunca vi, juro." },
      { speaker: "Pistolinha", text: "Eu preciso saber: você já viu um pato de perto?" },
    ];
    expect(motifRepeat("Calma, ninguém aqui julga: você já viu um pato de perto?", room, new Set())?.said).toBe("pato de perto");
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
