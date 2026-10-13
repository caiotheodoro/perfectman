import { describe, expect, it } from "vitest";
import { PACES, GAZE_SECONDS, timing, tokens } from "../timing.js";

describe("timing", () => {
  it("counts words, and characters for scripts written without spaces", () => {
    expect(tokens("Good evening, neighbors")).toHaveLength(3);
    expect(tokens("明日の夜７時")).toHaveLength(6);
  });

  it("reveals a single balloon faster than it is read, so the eye is never ahead of the words", () => {
    const t = timing("one two three four five six seven eight nine ten", PACES.normal);

    expect(t.wordCount).toBe(10);
    expect(t.read).toBeCloseTo(GAZE_SECONDS + 10 / PACES.normal, 5);
    expect(t.reveal).toBeLessThan(t.read);
  });

  it("lands words in order, spread across the reveal, longer words later", () => {
    const t = timing("a bb ccc dddd", PACES.normal);

    expect(t.offsets).toHaveLength(4);
    expect(t.offsets[0]).toBe(0);
    for (let i = 1; i < t.offsets.length; i++) expect(t.offsets[i]!).toBeGreaterThan(t.offsets[i - 1]!);
    expect(t.offsets[3]!).toBeLessThan(t.reveal);
  });

  it("paces a paged balloon by the reading: each page lasts as long as its words take to read", () => {
    const words = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    const t = timing(words, PACES.normal, [30, 10]);

    // Page two starts after page one's 30 words have been read (plus the gaze beat).
    expect(t.offsets[30]!).toBeCloseTo(0.5 + 30 / PACES.normal, 4);
    expect(t.pages).toBe(2);
    expect(t.read).toBeGreaterThan(40 / PACES.normal);
  });

  it("a slower reader gets longer, a faster one shorter", () => {
    const text = Array.from({ length: 30 }, () => "word").join(" ");

    expect(timing(text, PACES.relaxed).read).toBeGreaterThan(timing(text, PACES.normal).read);
    expect(timing(text, PACES.fast).read).toBeLessThan(timing(text, PACES.normal).read);
  });
});
