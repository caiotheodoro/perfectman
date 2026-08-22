import { describe, it, expect } from "vitest";
import { isNearRepeat, similarity } from "../repetition-guard.js";

describe("isNearRepeat", () => {
  it("flags an exact repeat", () => {
    expect(isNearRepeat("kkkkk não acredito nesse take", ["kkkkk não acredito nesse take"])).toBe(true);
  });

  it("flags a near-variation (punctuation/emoji-only diff)", () => {
    expect(
      isNearRepeat(
        "e aí, bora falar sobre isso? :D",
        ["e aí, bora falar sobre isso? :)"],
      ),
    ).toBe(true);
  });

  it("does not flag genuinely different content", () => {
    expect(
      isNearRepeat(
        "acho que devíamos falar sobre outra coisa agora",
        ["kkkkk não acredito nesse take"],
      ),
    ).toBe(false);
  });

  it("does not flag when there is no prior history", () => {
    expect(isNearRepeat("qualquer coisa", [])).toBe(false);
  });

  it("does not flag empty candidate content", () => {
    expect(isNearRepeat("", ["algo"])).toBe(false);
  });

  it("respects a custom threshold", () => {
    // Partial overlap: shares some words but not enough at a strict threshold.
    const candidate = "vi o episódio novo e achei incrível";
    const prior = "vi o episódio antigo ontem à noite";
    expect(isNearRepeat(candidate, [prior], 0.9)).toBe(false);
  });

  it("does not flag emoji/stopword-only candidates against emoji/stopword-only priors", () => {
    // normalizeWords strips emoji and stopwords, so both sides normalize to
    // EMPTY word sets — similarity([] , []) is 0, not 1, or a react-only
    // message stream would block itself as an endless "repeat".
    expect(similarity("😂😂", "🔥🔥")).toBe(0);
    expect(isNearRepeat("😂😂", ["🔥🔥"])).toBe(false);
    expect(isNearRepeat("de e o a", ["da"])).toBe(false); // stopword-only
  });

  it("still flags emoji-decorated content when the words match", () => {
    // The guard must not over-correct: punctuation/emoji-only DIFFS stay
    // near-repeats once real words are present.
    expect(similarity("vou embora 🙄", "vou embora 😤")).toBe(1);
    expect(isNearRepeat("vou embora 🙄", ["vou embora 😤"])).toBe(true);
  });
});
