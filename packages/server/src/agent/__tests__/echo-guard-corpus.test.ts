import { describe, expect, it } from "vitest";
import { BRUNO_PACK, CAIO_PACK, GOULART_PACK, LEO_PACK, MARIANA_PACK } from "@perfectman/shared";
import { findGarble, findOwnEcho, findPhraseLoop, findRoomEcho } from "../echo-guard.js";
import { CAIO_JOKE, HELOISA, IAN_FIRST, NORMAL, PISTOLINHA } from "./fixtures/ptbr-lines.js";

describe("false positives on normal Portuguese", () => {
  it("no ordinary line is garbled", () => {
    const hits = NORMAL.map((line) => ({ line, hit: findGarble(line) })).filter((r) => r.hit);
    expect(hits).toEqual([]);
  });

  it("accents, KKKK, slang and shouting are fine on their own", () => {
    for (const line of [
      "ÇÃO ÕES É Ê À Á Â Ü Ñ ção não pão mãe põe você",
      "KKKKKKKKKKKKKKKKKKKK",
      "kkkk rsrs hahahaha",
      "QUE ISSO, MEU CHEFE?! TÁ DOIDO?!",
      "Vish, mano, tá ligado? Pô, bora lá, tipo assim, né?",
      "O João pegou o avião às 5h30 e voltou às 22:45 com R$ 1.250,00",
      "Nãããão, para, sério, siiiiim, claro!",
      "Quanta saudade da minha vovó, ela fazia o melhor pão de queijo",
      "primeira linha\nsegunda linha\r\n\tterceira linha 😂🔥👍🏽 ❤️",
    ]) {
      expect(findGarble(line), line).toBeUndefined();
    }
  });

  it("no two distinct ordinary lines echo each other, as an own line or as a room line", () => {
    const flagged: string[] = [];
    for (let i = 0; i < NORMAL.length; i++) {
      for (let j = 0; j < NORMAL.length; j++) {
        if (i === j) continue;
        if (findOwnEcho(NORMAL[i]!, [NORMAL[j]!]) || findRoomEcho(NORMAL[i]!, [NORMAL[j]!])) flagged.push(`${NORMAL[i]} <-> ${NORMAL[j]}`);
      }
    }
    expect(flagged).toEqual([]);
  });

  it("no ordinary line echoes, or loops with, the production lines", () => {
    const production = [IAN_FIRST, CAIO_JOKE, PISTOLINHA[0]!, HELOISA[0]!];
    for (const line of NORMAL) {
      expect(findOwnEcho(line, production), line).toBeUndefined();
      expect(findRoomEcho(line, production), line).toBeUndefined();
    }
  });

  it("no window of 5 ordinary lines is a phrase loop, in the order they are written or any rotation of it", () => {
    const hits: string[] = [];
    for (let shift = 0; shift < NORMAL.length; shift += 9) {
      const lines = [...NORMAL.slice(shift), ...NORMAL.slice(0, shift)];
      for (let i = 4; i < lines.length; i++) {
        const hit = findPhraseLoop(lines[i]!, lines.slice(i - 4, i));
        if (hit) hits.push(`${lines[i]} -> ${hit.phrase}`);
      }
    }
    expect(hits).toEqual([]);
  });

  // Lines written by hand for the five pt-BR personas (lowercase chat, "kk", slang, emoji): not written for this guard.
  const AUTHORED = [BRUNO_PACK, CAIO_PACK, GOULART_PACK, LEO_PACK, MARIANA_PACK].flatMap((pack) => pack.styleExamples);

  it("none of the personas' hand-written chat lines is garbled, echoes another, or loops", () => {
    expect(AUTHORED.length).toBeGreaterThan(40);
    const flagged: string[] = [];
    for (const [i, line] of AUTHORED.entries()) {
      if (findGarble(line)) flagged.push(`garble: ${line}`);
      for (const [j, other] of AUTHORED.entries()) if (i !== j && (findOwnEcho(line, [other]) || findRoomEcho(line, [other]))) flagged.push(`echo: ${line} <-> ${other}`);
      if (i >= 4 && findPhraseLoop(line, AUTHORED.slice(i - 4, i))) flagged.push(`loop: ${line}`);
    }
    expect(flagged).toEqual([]);
  });
});
