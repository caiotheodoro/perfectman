import { describe, expect, it } from "vitest";
import { FREE_TRIM_MIN_WORDS, freeTrimLimit, lengthOf, trimFree } from "../script-likeness/index.js";

const words = (n: number, seed: string): string => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");

describe("freeTrimLimit", () => {
  it("is a quarter over the cap, rounded down", () => {
    expect([12, 22, 28, 40, 60].map(freeTrimLimit)).toEqual([15, 27, 35, 50, 75]);
  });
});

describe("trimFree: a cut for a candidate a little over the cap, with no model call", () => {
  it("keeps the sentences that fit and drops the last", () => {
    const text = `${words(10, "a")}. ${words(9, "b")}. ${words(7, "c")}.`;
    expect(lengthOf(text)).toBe(26);
    expect(trimFree(text, 22, 2)).toBe(`${words(10, "a")}. ${words(9, "b")}.`);
  });

  it("keeps no more sentences than the target allows, and drops a second question after a first one", () => {
    expect(trimFree(`${words(5, "a")}. ${words(5, "b")}. ${words(14, "c")}.`, 22, 2)).toBe(`${words(5, "a")}. ${words(5, "b")}.`);
    expect(trimFree(`${words(8, "a")}? ${words(8, "b")}? ${words(8, "c")}.`, 22, 3)).toBe(`${words(8, "a")}?`);
  });

  it("says nothing when the cut would keep fewer than 5 words", () => {
    expect(FREE_TRIM_MIN_WORDS).toBe(5);
    expect(trimFree(`Vem. Agora. ${words(23, "y")}.`, 22, 2)).toBeUndefined();
    expect(trimFree(`${words(4, "a")}. ${words(21, "b")}.`, 22, 2)).toBeUndefined();
    expect(trimFree(`${words(5, "a")}. ${words(21, "b")}.`, 22, 2)).toBe(`${words(5, "a")}.`);
  });

  it("cuts a single long sentence at the last clause that fits", () => {
    const text = `${words(8, "a")}, ${words(8, "b")}, ${words(8, "c")}.`;
    expect(trimFree(text, 22, 2)).toBe(`${words(8, "a")}, ${words(8, "b")}.`);
  });

  it("ends a cut question with a question mark only when it opens with a question word", () => {
    expect(trimFree(`O que você fez com o cofre ontem à noite, ${words(14, "z")} depois?`, 22, 2)).toBe("O que você fez com o cofre ontem à noite?");
    expect(trimFree(`Você ficou com o cofre ontem à noite, ${words(14, "z")} depois?`, 22, 2)).toBe("Você ficou com o cofre ontem à noite.");
  });

  it("says nothing for a single sentence with no clause break that fits, and for an empty line", () => {
    expect(trimFree(`${words(25, "a")}.`, 22, 2)).toBeUndefined();
    expect(trimFree("   ", 22, 2)).toBeUndefined();
  });
});
