import { describe, expect, it } from "vitest";
import { BRUNO_PACK, CAIO_PACK, GOULART_PACK, LEO_PACK, MARIANA_PACK, SCRIPT_NORMS, lowNovelty, motifRepeat, nameKeysOf, noveltyFloor, lengthOf, lengthTargetFor } from "@perfectman/shared";
import { EXAMPLE_PROMPT_PROFILE } from "../persona-prompt-profile.js";
import { PromptBuilder } from "../prompt-builder.js";
import { lengthLine, lengthRetryNote, motifRetryNote, noveltyRetryNote, owedFor, owedNote, owedRetryNote, reactionFor, spokenLines } from "../script-guard.js";
import { hotelInput, humanLine } from "./hotel-test-helpers.js";
import { CAIO_JOKE, HELOISA, IAN_FIRST, IAN_SECOND, NORMAL, PISTOLINHA } from "./fixtures/ptbr-lines.js";
import type { CommittedEvent } from "@perfectman/shared";

describe("would the checks flag ordinary Portuguese chat?", () => {
  const floor = noveltyFloor(SCRIPT_NORMS, "pt");

  // The 128 ordinary lines the repetition guards are tested against: distinct lines, so a flag here is a false positive.
  it("flags under 5% of the ordinary lines, with the 6 before them as the room, in the order they are written and in rotations of it", () => {
    let turns = 0;
    let novelty = 0;
    let motif = 0;
    for (let shift = 0; shift < NORMAL.length; shift += 17) {
      const lines = [...NORMAL.slice(shift), ...NORMAL.slice(0, shift)];
      for (let i = 3; i < lines.length; i++) {
        const room = lines.slice(Math.max(0, i - 6), i).map((text, j) => ({ speaker: j % 2 ? "Ana" : "Bia", text }));
        turns++;
        if (lowNovelty(lines[i]!, room, floor)) novelty++;
        if (motifRepeat(lines[i]!, room, nameKeysOf(["Ana", "Bia"]))) motif++;
      }
    }
    expect(NORMAL.length).toBeGreaterThanOrEqual(128);
    expect(motif).toBe(0);
    expect((novelty + motif) / turns).toBeLessThan(0.05);
  });

  it("flags none of the personas' own hand-written lines, said in a room of the others'", () => {
    const authored = [BRUNO_PACK, CAIO_PACK, GOULART_PACK, LEO_PACK, MARIANA_PACK].flatMap((p) => p.styleExamples);
    let flagged = 0;
    for (let i = 6; i < authored.length; i++) {
      const room = authored.slice(i - 6, i).map((text) => ({ speaker: "x", text }));
      if (motifRepeat(authored[i]!, room, new Set())) flagged++;
    }
    expect(authored.length).toBeGreaterThan(20);
    expect(flagged).toBe(0);
  });

  it("does flag the production shapes: run 57's question in the room, run 56's sentence and joke", () => {
    const room = PISTOLINHA.slice(0, 3).map((text) => ({ speaker: "Pistolinha", text }));
    expect(motifRepeat(PISTOLINHA[3]!, room, new Set())?.said).toBe("pato de perto");
    // Ian's own earlier sentence is what the novelty check reads (the actor's last 3 lines and the turn before), not the room's last 6.
    expect(lowNovelty(IAN_SECOND, [{ speaker: "Ian", text: IAN_FIRST }, { speaker: "Caio", text: CAIO_JOKE }, { speaker: "Caio", text: CAIO_JOKE }], floor, { self: "Ian" })).toBeDefined();
    expect(motifRepeat(HELOISA[3]!, HELOISA.slice(0, 3).map((text) => ({ speaker: "Heloísa", text })), new Set())).toBeUndefined();
  });
});

describe("notes", () => {
  it("states the length in numbers, in the persona's language", () => {
    const pt = lengthLine(lengthTargetFor("short", "pt"), "pt-BR");
    expect(pt).toContain("de 5 a 12 palavras");
    expect(pt).toContain("nunca mais de 22 palavras");
    expect(pt).toContain("2 frases");
    expect(lengthLine(lengthTargetFor("short", "en"), "en")).toContain("6 to 14 words");
    expect(lengthLine(lengthTargetFor("rapid_fire", "pt"), "pt-BR")).toContain("uma frase");
  });

  it("names the count, the motif and who asked", () => {
    expect(lengthRetryNote(41, 22, "pt-BR")).toContain("41 palavras e o limite é 22");
    expect(lengthRetryNote(41, 22, "en")).toContain("41 words and the limit is 22");
    expect(motifRetryNote("pato de perto", "pt-BR")).toContain('"pato de perto"');
    expect(noveltyRetryNote("en")).toContain("one new thing");
    expect(owedRetryNote({ text: "Cadê a chave?", asker: "Ana", age: 2 }, "pt-BR")).toContain("Ana te perguntou");
    expect(owedNote({ text: "Cadê a chave?", asker: "Ana", age: 2 }, "en")).toContain("Answer first");
  });

  it("picks the same short reaction for the same turn", () => {
    expect(reactionFor("bento|3|50", "pt-BR")).toBe(reactionFor("bento|3|50", "pt-BR"));
    expect(new Set(["a", "b", "c", "d", "e", "f"].map((k) => reactionFor(k, "en"))).size).toBeGreaterThan(1);
  });
});

describe("the room as the checks read it", () => {
  const ev = (id: string, actorId: string, name: string, content: string, extra: Record<string, unknown> = {}): CommittedEvent => ({ ...humanLine(content, name), id, actorId, payload: { content, senderName: name, ...extra } }) as CommittedEvent;

  it("lists public speech oldest first, marks the actor's own lines and leaves whispers out", () => {
    const input = hotelInput([ev("e1", "ana", "Ana", "Bento, cadê a chave?"), ev("e2", "example-friend", "Ex", "Na gaveta."), ev("e3", "caco", "Caco", "Psiu.", { mode: "whisper" })]);
    const lines = spokenLines(input.perceptionPacket);
    expect(lines.map((l) => [l.speaker, l.own])).toEqual([["Ana", false], ["Ex", input.agentId === "example-friend"]]);
  });

  it("finds a question owed by this actor once two lines have passed", () => {
    const input = hotelInput([ev("e1", "ana", "Ana", "Exemplo, cadê a chave?"), ev("e2", "caco", "Caco", "Eu vi uma chave."), ev("e3", "bia", "Bia", "Ninguém mexeu em nada.")]);
    expect(owedFor(input, "Exemplo")?.asker).toBe("Ana");
    expect(owedFor(hotelInput([ev("e1", "ana", "Ana", "Exemplo, cadê a chave?"), ev("e2", "caco", "Caco", "Eu vi uma chave.")]), "Exemplo")).toBeUndefined();
  });
});

describe("the prompts", () => {
  const profile = { ...EXAMPLE_PROMPT_PROFILE, language: "pt-BR" as const, hotelMode: true, relationshipBiases: {}, messageLength: "short" as const };
  const withScript = { ...profile, scriptPrompt: { length: lengthTargetFor("short", "pt") } };

  it("compact: with the script checks on the length is a number of words and the model lines are cut to it; without them it is the old line", () => {
    const quiet = hotelInput();
    const off = PromptBuilder.build(quiet, profile, "action_intent", undefined, "compact").system;
    const on = PromptBuilder.build(quiet, withScript, "action_intent", undefined, "compact").system;
    expect(off).toContain("Length: one or two short lines, under about 140 characters.");
    expect(on).not.toContain("under about 140 characters");
    expect(on).toContain("de 5 a 12 palavras");
    for (const m of on.matchAll(/Sounds like \(tone, not lines to repeat\): (.*)/g)) for (const q of m[1]!.matchAll(/"([^"]+)"/g)) expect(lengthOf(q[1]!)).toBeLessThanOrEqual(12);
  });

  it("full: the message-length section carries the numbers", () => {
    const on = PromptBuilder.build(hotelInput(), withScript, "action_intent").system;
    expect(on).toContain("de 5 a 12 palavras");
    expect(on).not.toContain("under about 140 characters");
    expect(PromptBuilder.build(hotelInput(), profile, "action_intent").system).toContain("under about 140 characters");
  });

  it("puts the owed-answer note in the decision only when the checks are on, and flags the prompt", () => {
    const ev = (id: string, actorId: string, name: string, content: string): CommittedEvent => ({ ...humanLine(content, name), id, actorId, payload: { content, senderName: name } }) as CommittedEvent;
    const owed = hotelInput([ev("e1", "ana", "Ana", `${EXAMPLE_PROMPT_PROFILE.displayName}, cadê a chave?`), ev("e2", "caco", "Caco", "Eu vi uma chave."), ev("e3", "bia", "Bia", "Ninguém mexeu em nada.")]);
    const onBuilt = PromptBuilder.build(owed, withScript, "action_intent", undefined, "compact");
    const offBuilt = PromptBuilder.build(owed, profile, "action_intent", undefined, "compact");
    expect(onBuilt.user).toContain("te fez uma pergunta direta e você ainda não respondeu");
    expect(onBuilt.owedNoted).toBe(true);
    expect(offBuilt.user).not.toContain("pergunta direta");
    expect(offBuilt.owedNoted).toBeUndefined();
  });
});
