import { describe, expect, it } from "vitest";
import { roomNames } from "@perfectman/shared";
import { findTics, stripTics, strikeEcho } from "../echo-guard.js";
import { RUN62, RUN62_NAMES } from "./fixtures/run62-lines.js";

/**
 * Short lines. A median hotel turn is 13 words under a cap of 22, and the echo checks were made for lines of 40: a 6-word shared opening, a 6-word run over 60% of the
 * shorter line, 60% of the trigrams, nothing under 5 words. These tests are the tics (a form of address, a tag question or an opening word the actor keeps using), taking one off a line, and repairing a repeat by striking what repeats.
 */

const NAMES = roomNames(RUN62_NAMES);
const at = (name: string, t: number): string => RUN62.find((l) => l.name === name && l.t === t)!.text;

describe("tics: a form of address or an opening word in 4 of the actor's last 6 turns", () => {
  const rapaz = (i: number): string => `Rapaz, a coisa número ${["um", "dois", "três", "quatro", "cinco"][i]} é essa aqui.`;

  it("Otávio's 'Rapaz' is a tic from its fourth use in six turns, and not before", () => {
    const priors = [rapaz(0), "Não.", rapaz(1), "Ela mentiu para todos nós.", rapaz(2)];
    expect(findTics("Rapaz, sua parte sai do bolso dela e eu sei qual é.", priors.slice(0, 3), NAMES)).toEqual([]);
    expect(findTics("Rapaz, sua parte sai do bolso dela e eu sei qual é.", priors, NAMES)).toEqual([{ kind: "address", term: "rapaz", count: 4 }]);
    // A line that already dropped it is clean.
    expect(findTics("Sua parte sai do bolso dela e eu sei qual é.", priors, NAMES)).toEqual([]);
  });

  it("counts the form of address at either end, and the pair 'minha cara' as one", () => {
    const priors = ["Vinho não, minha cara.", "Assinatura eu não dou, minha cara.", "Segunda às oito é tarde demais, minha cara.", "Fecha com ele agora mesmo."];
    expect(findTics("Fecha comigo antes da meia-noite, minha cara.", priors, NAMES)).toEqual([{ kind: "address", term: "minha cara", count: 4 }]);
  });

  it("a vocative set off in the middle of the line counts too (Renato's 'mana')", () => {
    const priors = ["Fala logo, mana, quanto vale isso?", "Você aí, mana, abre o cofre.", "Eu sei de tudo, mana, não me teste.", "Sem conversa fiada."];
    expect(findTics("E você, mana, abre esse cofre agora.", priors, NAMES)).toEqual([{ kind: "address", term: "mana", count: 4 }]);
    expect(stripTics("E você, mana, abre esse cofre agora.", [{ kind: "address", term: "mana", count: 4 }], NAMES)).toBe("E você, abre esse cofre agora.");
  });

  it("a name is address, not a tic", () => {
    const priors = Array.from({ length: 5 }, (_, i) => `Otávio, ${["a carta", "o vinho", "a firma", "o cofre", "a pasta"][i]} está aqui na mesa.`);
    expect(findTics("Otávio, a chave está no vaso da sala.", priors, NAMES)).toEqual([]);
  });

  it("an opening word that names something, 4 of 6 times, is a tic that cannot be stripped", () => {
    const priors = ["Bêbado não erra assinatura. Erra quem forjou.", "Bêbado vê o que sóbrio não quer ver.", "Rapaz, repete o que você disse.", "Bêbado, sim. Mas viu o que escondeu."];
    expect(findTics("Bêbado, sim. Mas o que ele viu, minha cara, você não desmente.", priors, NAMES)).toEqual([{ kind: "opener", term: "bebado", count: 4 }]);
  });

  it("a tag question ending 4 of 6 turns is a tic", () => {
    const priors = ["Querido, o café esfria, não esfria?", "A carta pode esperar, não pode?", "Você bebeu desde o almoço.", "Eu falei com ele ontem, não falei?"];
    expect(findTics("Eu guardei a chave, não guardei?", priors, NAMES)).toEqual([{ kind: "tag", term: "tag", count: 4 }]);
  });

  it("nothing is flagged on a line of fewer than 3 words", () => {
    expect(findTics("Rapaz.", [rapaz(0), rapaz(1), rapaz(2), rapaz(3), rapaz(4)], NAMES)).toEqual([]);
  });
});

describe("taking a tic off a line", () => {
  const address = (term: string) => [{ kind: "address" as const, term, count: 5 }];

  it("takes the form of address off the start and the end, and keeps names and everything else", () => {
    expect(stripTics("Rapaz, ela escondeu o caixa e você vai levar a culpa junto.", address("rapaz"), NAMES)).toBe("Ela escondeu o caixa e você vai levar a culpa junto.");
    expect(stripTics("Rapaz. Antes do cofre, senta aqui e me escuta.", address("rapaz"), NAMES)).toBe("Antes do cofre, senta aqui e me escuta.");
    expect(stripTics("Otávio, querido, a firma fecha às seis. Ninguém assina nada depois.", address("querido"), NAMES)).toBe("Otávio, a firma fecha às seis. Ninguém assina nada depois.");
    expect(stripTics("Ela trancou a chave. Senta, ela conta o caixa, ou eu conto do dedo, rapaz!", address("rapaz"), NAMES)).toBe("Ela trancou a chave. Senta, ela conta o caixa, ou eu conto do dedo!");
    expect(stripTics("Mana, ele tá de caneta na mão! Cinquenta e eu pego ela pra você, agora.", address("mana"), NAMES)).toBe("Ele tá de caneta na mão! Cinquenta e eu pego ela pra você, agora.");
  });

  it("takes only the tic: another form of address stays", () => {
    expect(stripTics("Rapaz, minha cara, a conta não fecha.", address("rapaz"), NAMES)).toBe("Minha cara, a conta não fecha.");
  });

  it("leaves a vocative in the middle of the line, which is a way to talk and not a way to open or close", () => {
    expect(stripTics("Mas o que ele viu, minha cara, você não desmente, rapaz.", address("rapaz"), NAMES)).toBe("Mas o que ele viu, minha cara, você não desmente.");
  });

  it("takes off a tag question and ends the line as a statement", () => {
    expect(stripTics("Mas a caneta fica comigo, não fica?", [{ kind: "tag", term: "tag", count: 4 }], NAMES)).toBe("Mas a caneta fica comigo.");
  });

  it("does nothing when fewer than 3 words would be left, when a quote or a bracket is in the line, or when the tic is not on it", () => {
    expect(stripTics("Rapaz, vem cá.", address("rapaz"), NAMES)).toBeUndefined();
    expect(stripTics('Rapaz, ela disse "vem cá, mano" ontem à noite.', address("rapaz"), NAMES)).toBeUndefined();
    expect(stripTics("Sua parte sai do bolso dela.", address("rapaz"), NAMES)).toBeUndefined();
  });
});

describe("repairing a repeat instead of dropping it", () => {
  const priors = [at("Otávio", 177), at("Otávio", 189)];

  it("keeps what is new in a line whose first clause repeats", () => {
    const text = "Bêbado, sim. Mas viu o que você escondeu, minha cara. Eu guardo o recibo da firma no cartório de segunda.";
    expect(strikeEcho(text, priors, NAMES)).toBe("Eu guardo o recibo da firma no cartório de segunda.");
  });

  it("takes the vocative that was left before a struck sentence with it", () => {
    const heloisa = [at("Heloísa", 22)];
    const text = "Otávio, meu bem, sente-se. Um café antes de qualquer palavra? A firma fecha às seis e ninguém assina nada depois.";
    expect(strikeEcho(text, heloisa, NAMES)).toBe("A firma fecha às seis e ninguém assina nada depois.");
  });

  it("says nothing was left when fewer than 4 words are new: Heloísa's 27 s line", () => {
    expect(strikeEcho(at("Heloísa", 27), [at("Heloísa", 22)], NAMES)).toBeUndefined();
  });

  it("says nothing was left when every clause repeats: Otávio's 189 s line", () => {
    expect(strikeEcho(at("Otávio", 189), [at("Otávio", 177), at("Otávio", 158), at("Otávio", 147)], NAMES)).toBeUndefined();
  });

  it("never counts the scene's own topic word as already said", () => {
    const cofre = ["O cofre está aberto, mas a chave sumiu da sala.", "Ninguém toca no cofre antes da meia-noite."];
    const text = "O cofre vale mais que a firma inteira, Heloísa, e o notário já sabe disso.";
    expect(strikeEcho(text, cofre, NAMES)).toBeUndefined();
    expect(strikeEcho("O cofre está aberto, mas a chave sumiu da sala. Eu vi o recibo dobrado no bolso do Caco.", cofre, NAMES, new Set(["cofre"]))).toBe("Eu vi o recibo dobrado no bolso do Caco.");
  });
});

