import { describe, expect, it } from "vitest";
import { roomNames } from "@perfectman/shared";
import { findOwnEcho, voiceOf } from "../echo-guard.js";
import { isNearRepeat } from "../repetition-guard.js";
import { RUN62, RUN62_NAMES } from "./fixtures/run62-lines.js";

/**
 * Short lines. A median hotel turn is 13 words under a cap of 22, and the echo checks were made for lines of 40: a 6-word shared opening, a 6-word run over 60% of the
 * shorter line, 60% of the trigrams, nothing under 5 words. These tests are the lines that got through that in production run 62 (45 minutes, three bot actors), as candidates.
 */

const NAMES = roomNames(RUN62_NAMES);
const at = (name: string, t: number): string => RUN62.find((l) => l.name === name && l.t === t)!.text;

describe("what a short line says, without the address", () => {
  it("takes names and forms of address off the ends of every clause", () => {
    const v = voiceOf("Otávio, meu bem, sente-se. Aceita um cafezinho?", NAMES);
    expect(v.keys).toEqual(["sente", "se", "aceita", "um", "cafezinho"]);
    expect(v.leadTerms).toEqual(["meu bem"]);
    expect(v.trailTerms).toEqual([]);
    const w = voiceOf("Mas o que ele viu, minha cara, você não desmente, rapaz.", NAMES);
    expect(w.keys).toEqual(["mas", "o", "que", "ele", "viu", "voce", "nao", "desmente"]);
    expect(w.trailTerms).toEqual(["rapaz"]);
    expect(w.leadTerms).toEqual([]);
  });

  it("reads a form of address in the middle as address, not as a way the line starts or ends", () => {
    const v = voiceOf("Vinho não, minha cara. O rapaz ali já falou o que precisava.", NAMES);
    expect(v.keys.slice(0, 3)).toEqual(["vinho", "nao", "o"]);
    expect(v.leadTerms).toEqual([]);
    expect(v.trailTerms).toEqual([]);
  });

  it("keeps a word that names something even when it is also a form of address elsewhere: 'o rapaz ali' is a person", () => {
    expect(voiceOf("O rapaz ali já falou.", NAMES).topics).toContain("rapaz");
  });

  it("finds the tag question that ends a line", () => {
    expect(voiceOf("A caneta fica comigo, não fica?", NAMES).tag).toBe(true);
    expect(voiceOf("A gente resolve isso no particular, né?", NAMES).tag).toBe(true);
    expect(voiceOf("Quer repetir isso amanhã, no cartório, com a boca limpa?", NAMES).tag).toBe(false);
    expect(voiceOf("Não pode.", NAMES).tag).toBe(false);
  });

  it("a line that is only address has nothing in it", () => {
    expect(voiceOf("Rapaz.", NAMES).keys).toEqual([]);
    expect(voiceOf("Otávio, querido,", NAMES).keys).toEqual([]);
  });
});

describe("the lines of run 62 that got through, as candidates", () => {
  const H22 = at("Heloísa", 22);
  const H27 = at("Heloísa", 27);

  it("Heloísa 22 s then 27 s: the same 'Otávio, meu bem, sente-se.' opens an 11-word and a 7-word line", () => {
    // The sequence rules (a 6-word shared opening, run or trigram share) and the set rule (0.7) of before all miss it.
    expect(findOwnEcho(H27, [H22], 8, NAMES, false)).toBeUndefined();
    expect(isNearRepeat(H27, [H22])).toBe(false);
    expect(findOwnEcho(H27, [H22], 8, NAMES)).toMatchObject({ kind: "lead", prior: H22 });
    // The names are the room's: without them the same pair is caught by its 3 opening words and the topic words they share.
    expect(findOwnEcho(H27, [H22])).toMatchObject({ kind: "open" });
  });

  it("Otávio 'Bêbado, sim. Mas viu o que você escondeu' then 'Bêbado, sim. Mas o que ele viu, minha cara': the same 3 opening words and 2 of 3 topic words", () => {
    const first = at("Otávio", 177);
    const second = at("Otávio", 189);
    expect(findOwnEcho(second, [first], 8, NAMES, false)).toBeUndefined();
    expect(findOwnEcho(second, [first], 8, NAMES)).toMatchObject({ kind: "open", prior: first });
  });

  it("Otávio 'Vinho não' three times: no pair of them is an echo, the third is a shared opening frame", () => {
    const [v0, v1, v2] = [at("Otávio", 215), at("Otávio", 233), at("Otávio", 255)];
    expect(findOwnEcho(v1, [v0], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho(v2, [v1], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho(v2, [v0, v1], 8, NAMES)).toMatchObject({ kind: "frame" });
    // "Mas vinho não" opens like "Vinho não": a leading connector is skipped.
    expect(findOwnEcho("Vinho não, minha cara. Já falei.", [v0, "Fale com ela agora, antes da meia-noite.", v1, "Papel é papel, rapaz."], 8, NAMES)).toMatchObject({ kind: "frame" });
  });

  it("Renato 'Cofre nunca fechou pra mim', 'Pudim não, mano. Quero o cofre aberto', 'Cofre aberto, é? Então abre, pô': the third says what the second said", () => {
    const a = "Cofre nunca fechou pra mim, é? Então abre agora, na frente do Otávio.";
    const b = "Pudim não, mano. Quero o cofre aberto agora, na minha frente.";
    const c = "Cofre aberto, é? Então abre, pô. Hoje. Sem pudim na frente.";
    expect(findOwnEcho(c, [a, b], 8, NAMES, false)).toBeUndefined();
    expect(findOwnEcho(c, [a, b], 8, NAMES)).toMatchObject({ kind: "set", prior: b });
    // The first two share one word that names something besides the object: that is a scene about a safe, not an echo.
    expect(findOwnEcho(b, [a], 8, NAMES)).toBeUndefined();
  });

  it("a line with the same words in another order is an echo", () => {
    const a = "O recibo dobrado sumiu do bolso do Caco depois do jantar no bar.";
    const b = "Depois do jantar no bar, o Caco perdeu o recibo dobrado do bolso.";
    expect(findOwnEcho(b, [a], 8, NAMES, false)).toBeUndefined();
    expect(findOwnEcho(b, [a], 8, NAMES)).toMatchObject({ kind: "set", prior: a });
  });

  it("the address is not the point: 'Vinho não, minha cara.' says what 'Vinho não.' says", () => {
    expect(findOwnEcho("Vinho não, minha cara.", ["Vinho não."], 8, NAMES)).toMatchObject({ kind: "exact" });
  });

  it("a line of fewer than 3 topic words is never an echo of anything but an exact copy", () => {
    expect(findOwnEcho("Sim, claro, com certeza.", ["Sim, claro."], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho("Verdade, cara.", ["Verdade, cara."], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho("Não pode, minha cara.", ["Não pode, minha cara. A sobremesa sou eu que sirvo."], 8, NAMES)).toBeUndefined();
  });

  it("two ordinary replies to the same person are not an echo of each other", () => {
    expect(findOwnEcho("Renato, querido, o cofre abre amanhã às nove.", ["Renato, querido, onde você estava ontem à noite?"], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho("Calma, Beatriz. Sente-se.", ["Calma, Beatriz. Eu explico o que posso."], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho("Eu acho que você tem razão, mas só em parte do que disse ontem.", ["Eu acho que você tem medo de perder tudo isso."], 8, NAMES)).toBeUndefined();
    expect(findOwnEcho("Otávio, meu bem, a carta pode esperar a sobremesa.", [H22], 8, NAMES)).toBeUndefined();
  });

  it("the old thresholds are untouched for a long line", () => {
    const long = "Eu te digo uma coisa que ninguém nesta casa quer ouvir, e é que o testamento não foi escrito por quem a senhora pensa que escreveu.";
    expect(findOwnEcho(long, [long], 8, NAMES, false)).toMatchObject({ kind: "exact" });
    expect(findOwnEcho(`${long} Pergunte ao notário.`, [long], 8, NAMES, false)).toMatchObject({ kind: "prefix" });
  });
});

