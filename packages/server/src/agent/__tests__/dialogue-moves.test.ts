import { describe, expect, it } from "vitest";
import type { OwedLine, CommittedEvent } from "@perfectman/shared";
import {
  ANSWER_WORDS,
  FILLER_WORDS,
  MOVE_PHRASES,
  SCRIPT_NORMS,
  answersFirst,
  isRealAnswer,
  joinedKeys,
  lowNovelty,
  majorMoveOf,
  motifRepeat,
  moveBefore,
  nameKeysOf,
  noveltyFloor,
  owedQuestion,
  wordsOf,
} from "@perfectman/shared";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import { PromptBuilder } from "../prompt-builder.js";
import { ActionIntentStep } from "../surface/action-intent-step.js";
import { answerNote, answerNoteFor } from "../script-guard.js";
import type { GuardKind } from "../repetition-guard.js";
import { hotelInput } from "./hotel-test-helpers.js";
import { NORMAL } from "./fixtures/ptbr-lines.js";
import { RUN60, RUN_LINES, roomOf, said } from "./fixtures/run-lines.js";

describe("moves made at an actor", () => {
  const names = (n: string) => nameKeysOf([n]);

  const room3 = nameKeysOf(["Heloísa", "Otávio", "Renato"]);

  it("run 60: Renato's 'eu vi a caneta na sua mão, Heloísa' is a reveal made at Heloísa, and only she is told", () => {
    const room = roomOf(259, "Heloísa").slice(-3);
    expect(room.at(-1)!.text).toBe(said(251));
    expect(moveBefore(room, names("Heloísa"), "heloisa", room3)).toMatchObject({ kind: "reveal", speaker: "Renato", named: true });
    // Otávio is in the room, but the line names Heloísa: it is not his to answer.
    expect(moveBefore(room.map((l) => ({ ...l, own: l.speaker === "Otávio" })), names("Otávio"), "otavio", room3)).toBeUndefined();
  });

  it("a line that names nobody is for everyone who hears it; one aimed at someone (an addressee or a reply target in the log) is for that person only", () => {
    const toTheRoom = [{ speaker: "Renato", text: "Eu vi a caneta na mão de alguém, cofre aberto e eu esqueço a assinatura.", own: false }];
    expect(moveBefore(toTheRoom, names("Heloísa"), "heloisa", room3)).toMatchObject({ kind: "reveal", named: false });
    expect(moveBefore(toTheRoom, names("Otávio"), "otavio", room3)).toMatchObject({ kind: "reveal", named: false });
    const aimed = [{ ...toTheRoom[0]!, aimedAt: ["heloisa"] }];
    expect(moveBefore(aimed, names("Heloísa"), "heloisa", room3)).toMatchObject({ kind: "reveal", named: true });
    expect(moveBefore(aimed, names("Otávio"), "otavio", room3)).toBeUndefined();
    // "você" to the aimed actor: nothing in the words names anyone, the log says who.
    const you = [{ speaker: "Renato", text: "Eu vi você com a caneta na mão.", own: false, aimedAt: ["otavio"] }];
    expect(moveBefore(you, names("Otávio"), "otavio", room3)).toMatchObject({ kind: "reveal", named: true });
    expect(moveBefore(you, names("Heloísa"), "heloisa", room3)).toBeUndefined();
    // A name nobody in the room has (a dead husband) names nobody here.
    const absent = [{ speaker: "Renato", text: "Eu vi a caneta do Henrique na sua mão.", own: false }];
    expect(moveBefore(absent, names("Otávio"), "otavio", room3)).toMatchObject({ named: false });
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

  it("fires after at most 5% of the 128 ordinary lines", () => {
    const fired: string[] = [];
    for (let i = 3; i < NORMAL.length; i++) {
      const room = NORMAL.slice(Math.max(0, i - 10), i).map((text, j) => ({ speaker: j % 2 ? "Ana" : "Bia", text }));
      if (moveBefore(room, names("Caco"), "caco", nameKeysOf(["Ana", "Bia", "Caco"]))) fired.push(room.at(-1)!.text);
    }
    expect(fired.length / (NORMAL.length - 3)).toBeLessThanOrEqual(0.05);
  });
});

describe("the prompt of an actor a move was made at", () => {
  const profile = { ...EXAMPLE_PROMPT_PROFILE, language: "pt-BR" as const, hotelMode: true, relationshipBiases: {}, messageLength: "short" as const, displayName: "Heloísa" };
  const withScript = { ...profile, scriptPrompt: { length: { aim: [5, 12] as [number, number], cap: 22, sentences: 2 } } };
  const ev = (id: string, actorId: string, name: string, content: string): CommittedEvent =>
    ({ id, simulationId: "sim-1", channelId: "room:lounge", actorId, type: "message_sent", payload: { content, senderName: name }, createdAt: 1, pulseIndex: 1, sourceEventIds: [], emotionalSalience: "low", visibility: { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public" } }) as CommittedEvent;
  const events = [ev("e0", "heloisa", "Heloísa", said(199)), ev("e1", "otavio", "Otávio", said(207)), ev("e2", "renato", "Renato", said(251))];

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

  it("only the person the line names is told: Otávio, in the same room, gets none", () => {
    const otavio = { ...withScript, displayName: "Otávio" };
    expect(PromptBuilder.build(hotelInput(events), otavio, "action_intent", undefined, "compact").answerNoted).toBeUndefined();
    expect(answerNoteFor(hotelInput(events), "Otávio", "pt-BR")).toBeUndefined();
    expect(answerNoteFor(hotelInput(events), "Heloísa", "pt-BR")).toContain("Renato acabou de revelar");
  });

  it("a line that names nobody, or is aimed at this actor in the log, reaches it", () => {
    const toRoom = [...events.slice(0, 2), ev("e3", "renato", "Renato", "Eu vi a caneta na mão de alguém, cofre aberto e eu esqueço a assinatura.")];
    expect(answerNoteFor(hotelInput(toRoom), "Otávio", "pt-BR")).toContain("Renato acabou de revelar");
    const aimedAtOther = [...events.slice(0, 2), { ...ev("e4", "renato", "Renato", "Eu vi a caneta na mão de alguém, cofre aberto."), payload: { content: "Eu vi a caneta na mão de alguém, cofre aberto.", senderName: "Renato", addresseeIds: ["heloisa"] } } as CommittedEvent];
    expect(answerNoteFor(hotelInput(aimedAtOther), "Otávio", "pt-BR")).toBeUndefined();
    const aimedAtMe = [...events.slice(0, 2), { ...ev("e5", "renato", "Renato", "Eu vi a caneta na mão de alguém, cofre aberto."), payload: { content: "Eu vi a caneta na mão de alguém, cofre aberto.", senderName: "Renato", replyToActorId: hotelInput().agentId } } as CommittedEvent];
    expect(answerNoteFor(hotelInput(aimedAtMe), "Otávio", "pt-BR")).toContain("Renato acabou de revelar");
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
    expect(lowNovelty(said(135), room, floor, { names, self: "Otávio" })).toMatchObject({ floor });
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

