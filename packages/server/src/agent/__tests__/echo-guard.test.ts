import { describe, expect, it } from "vitest";
import { findGarble, findOwnEcho, findPhraseLoop, findRoomEcho, foldLine, tokenize } from "../echo-guard.js";
import { isNearRepeat } from "../repetition-guard.js";
import { CAIO_JOKE, DUZENTAS, GARBLED, HELOISA, IAN_FIRST, IAN_SECOND, NORMAL, PISTOLINHA } from "./fixtures/ptbr-lines.js";

describe("folding", () => {
  it("ignores case, accents, punctuation, laughter runs, stage directions and elongation", () => {
    expect(foldLine("Mamão, ISSO tá frio!!")).toBe("mamao isso ta frio");
    expect(foldLine("*sorri* Se ele desse uma força KKKKK (rindo)")).toBe("se ele desse uma forca");
    expect(foldLine("hahaha siiiiim, nãããão")).toBe("sim nao");
    expect(foldLine("😂😂")).toBe("");
  });

  it("keeps the written form of each word for naming a phrase", () => {
    expect(tokenize("Você já viu, né?").map((t) => t.raw)).toEqual(["Você", "já", "viu", "né"]);
  });
});

describe("what the older guard missed, from the 2026-11-10 runs", () => {
  it("run 56: Ian's sentence with a changed tail is under the Jaccard threshold and is now an own echo", () => {
    expect(isNearRepeat(IAN_SECOND, [IAN_FIRST])).toBe(false);
    expect(findOwnEcho(IAN_SECOND, [IAN_FIRST])).toMatchObject({ kind: "prefix" });
  });

  it("run 56: the same sentence with a shorter or a longer tail is an echo too, and a bare repeat is exact", () => {
    for (const tail of [" Bora?", " Quem topa?", " Vem, Caio, senta aqui do meu lado.", " Pistolinha, traz o envelope e abre aqui agora, vai."]) {
      expect(findOwnEcho(IAN_FIRST + tail, [IAN_FIRST]), tail).toMatchObject({ kind: "prefix" });
    }
    expect(findOwnEcho(IAN_FIRST, [IAN_FIRST])).toMatchObject({ kind: "exact" });
  });

  it("run 56: Caio's joke said again, with the laughter changed, is an exact echo of the first", () => {
    const between = ["Quem é que vai pagar a conta hoje?", "Ninguém falou em pagar nada."];
    expect(findOwnEcho("Se ele desse uma força, talvez dispensasse o cooper, KKKKKKKKK", [CAIO_JOKE, ...between])).toMatchObject({ kind: "exact" });
  });

  it("run 56: a line another actor just said is a room echo, with the laughter and a few words changed", () => {
    expect(findRoomEcho(CAIO_JOKE, ["Chega de papo.", CAIO_JOKE])).toMatchObject({ kind: "exact" });
    expect(findRoomEcho("Se ele desse uma força talvez dispensasse o Cooper, hein, KKKK", [CAIO_JOKE])).toMatchObject({ kind: "run" });
  });

  it("run 57: the pato question is a loop once 2 of the last 4 lines already carried it", () => {
    const hit = findPhraseLoop("Olha, Caio, não adianta mudar de assunto e fugir da pergunta de novo: você já viu um pato de perto?", PISTOLINHA.slice(0, 3));
    expect(hit).toMatchObject({ kind: "ngram" });
    expect(hit?.phrase.toLowerCase()).toContain("viu um pato de perto");
  });

  it("a scene about one object may name it again: a shared noun phrase is not a tic", () => {
    const priors = ["Cadê o envelope do Otávio?", "Abre o envelope do Otávio agora, por favor.", "Quem pegou?"];
    expect(findPhraseLoop("Eu quero ver o envelope do Otávio na minha mão agora.", priors)).toBeUndefined();
  });

  it("run 57: one earlier use is not a loop yet", () => {
    expect(findPhraseLoop("Olha, Caio, não adianta mudar de assunto e fugir da pergunta de novo: você já viu um pato de perto?", [PISTOLINHA[0]!, "Cadê o envelope que ele trouxe?", "Abre isso agora."])).toBeUndefined();
  });

  it("run 57: the question frame is caught even when the words around it change", () => {
    const priors = ["Pato de perto, você já viu algum assim?", "Mas alguma vez você viu pato de perto mesmo?", "Cadê o envelope?"];
    expect(findPhraseLoop("Então você já viu pato assim de perto, ou não?", priors)).toMatchObject({ kind: "frame" });
  });

  it("run 53: the closing tic is a loop whatever the rest of the line says", () => {
    const hit = findPhraseLoop("Ninguém precisa saber do que o Otávio assinou, meu bem... não é, querido?", HELOISA.slice(0, 3));
    expect(hit).toMatchObject({ kind: "edge" });
    expect(hit?.phrase).toBe("não é querido");
  });

  it("run 56: garbled tokens are caught, and a count that contradicts the line before is out of scope", () => {
    expect(findGarble(GARBLED[0]!)).toMatchObject({ kind: "letter", token: "Éduğunu," });
    expect(findGarble(GARBLED[1]!)).toMatchObject({ kind: "glued", token: "umapreciação" });
    expect(findGarble(DUZENTAS[0]!)).toBeUndefined();
    expect(findGarble(DUZENTAS[1]!)).toBeUndefined();
  });
});

describe("own echoes", () => {
  it("catches a word dropped or added in the middle through the share of trigrams", () => {
    expect(findOwnEcho("Se ele desse uma força, aí talvez dispensasse o cooper", [CAIO_JOKE])).toMatchObject({ kind: "shingle" });
  });

  it("looks at the actor's last 8 lines, not only the previous one", () => {
    const filler = Array.from({ length: 6 }, (_, i) => NORMAL[i * 7]!);
    expect(findOwnEcho(IAN_SECOND, [IAN_FIRST, ...filler])).toMatchObject({ kind: "prefix" });
    expect(findOwnEcho(IAN_SECOND, [IAN_FIRST, ...filler, ...NORMAL.slice(50, 53)])).toBeUndefined();
  });

  it("leaves short lines to the older guard", () => {
    expect(findOwnEcho("Verdade, cara.", ["Verdade, cara."])).toBeUndefined();
    expect(findOwnEcho("Boa noite, pessoal, tudo bem?", ["Boa noite, pessoal, tudo bem?"])).toMatchObject({ kind: "exact" });
  });

  it("does not take a shared stock opening for an echo", () => {
    expect(findOwnEcho("Eu acho que você tem razão, mas só em parte do que disse ontem.", ["Eu acho que você tem medo de perder tudo isso."])).toBeUndefined();
  });
});

describe("room echoes", () => {
  it("only a near-verbatim copy counts, not an answer in the other's words", () => {
    expect(findRoomEcho("Dispensar o Cooper? Tá maluco, mano?", [CAIO_JOKE])).toBeUndefined();
    expect(findRoomEcho("Você já viu um pato de perto, Caio?", ["Escuta, você já viu um pato de perto?"])).toMatchObject({ kind: "run" });
  });

  it("looks at the last 4 lines", () => {
    const lines = [IAN_FIRST, ...NORMAL.slice(0, 4)];
    expect(findRoomEcho(IAN_FIRST, lines)).toBeUndefined();
    expect(findRoomEcho(IAN_FIRST, lines.slice(0, 4))).toMatchObject({ kind: "exact" });
  });
});

describe("garble", () => {
  it("catches a replacement character, a control character and letters outside Portuguese", () => {
    expect(findGarble("o que é isso � aqui")).toMatchObject({ kind: "control" });
    expect(findGarble("tem algo \u0007 errado aqui")).toMatchObject({ kind: "control" });
    expect(findGarble("Привет, tudo bem?")).toMatchObject({ kind: "letter" });
    expect(findGarble("fala sério, 你好 mano")).toMatchObject({ kind: "letter" });
    expect(findGarble("ela é muito şerefsiz mesmo")).toMatchObject({ kind: "letter" });
  });

  it("catches glued words, a word of 28 letters or more and a word said seven times running", () => {
    expect(findGarble("Isso é umaconversa que poucos entendem")).toMatchObject({ kind: "glued" });
    expect(findGarble("vocêpode fazer isso comigo")).toMatchObject({ kind: "glued" });
    expect(findGarble("vocês podem fazer isso comigo, uma coisa de cada vez, umas e outras")).toBeUndefined();
    expect(findGarble("voceprecisa sair daqui agora")).toMatchObject({ kind: "glued" });
    expect(findGarble("tem uma abcdefghijklmnopqrstuvwxyzabcdefghij aqui")).toMatchObject({ kind: "long" });
    expect(findGarble("sim sim sim sim sim sim sim e depois nada")).toMatchObject({ kind: "stuck" });
    expect(findGarble("não, não, não, não, não! eu disse que não!")).toBeUndefined();
  });

  it("lets a letter or a name through when the room already wrote it", () => {
    expect(findGarble("Oi, Łukasz, tudo bem?")).toMatchObject({ kind: "letter" });
    expect(findGarble("Oi, Łukasz, tudo bem?", ["Łukasz entrou na sala"])).toBeUndefined();
  });
});
