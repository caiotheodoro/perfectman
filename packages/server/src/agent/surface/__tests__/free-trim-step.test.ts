import { afterEach, describe, expect, it } from "vitest";
import { lengthOf } from "@perfectman/shared";
import { llmBudget } from "../../../llm/llm-budget.js";
import { lengthFeedbackFor, lengthTargetOf } from "../../script-guard.js";
import { EXAMPLE_PROMPT_PROFILE } from "../../persona-prompt-profile.js";
import { PromptBuilder } from "../../prompt-builder.js";
import { hotelInput } from "../../__tests__/hotel-test-helpers.js";
import { RUN_LINES } from "../../__tests__/fixtures/run-lines.js";
import { QUIET, input, run } from "./script-step-harness.js";

/**
 * The length path of the actor loop: a candidate a little over the cap is cut with no model call, what the retry bill is for a set of candidates of which 35% are over the
 * cap (run 62: 130 length retries in 374 turns), and the word count of the actor's last line in the next prompt.
 */

afterEach(() => {
  delete process.env["PERFECTMAN_FREE_TRIM"];
});

describe("a candidate a little over the cap", () => {
  const words = (n: number, seed: string): string => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");
  /** Two sentences of `n` words in all, the first of 12. */
  const candidate = (n: number, seed: string): string => `${words(12, `${seed}a`)}. ${words(n - 12, `${seed}b`)}.`;
  const cap = lengthTargetOf("short", "pt-BR").cap;

  it("is cut at its last sentence with no model call when it is over by a quarter or less", async () => {
    const text = candidate(27, "x");
    expect(lengthOf(text)).toBe(27);
    const r = await run([text], input(QUIET));
    expect(r.calls).toBe(1);
    expect(r.said).toBe(`${words(12, "xa")}.`);
    expect(r.seen).toEqual(["len_trim_free"]);
    expect(r.infos[0]).toMatchObject({ kind: "len_trim_free", before: text, after: r.said });
    expect(lengthOf(r.said)).toBeLessThanOrEqual(cap);
  });

  it("is retried when it is over by more than a quarter", async () => {
    const text = candidate(28, "x");
    const r = await run([text, "Vi o cofre aberto ontem à noite."], input(QUIET));
    expect(r.calls).toBe(2);
    expect(r.seen).toEqual(["len_retry"]);
    expect(r.said).toBe("Vi o cofre aberto ontem à noite.");
  });

  it("is retried when the cut would keep fewer than 5 words: the point would be gone", async () => {
    const text = `Vem. Agora. ${words(23, "y")}.`;
    expect(lengthOf(text)).toBe(25);
    const r = await run([text, "Vi o cofre aberto ontem à noite."], input(QUIET));
    expect(r.calls).toBe(2);
    expect(r.seen).toEqual(["len_retry"]);
  });

  it("a single long sentence is cut at its last clause that fits, and a question that opens with a question word stays one", async () => {
    const long = `O que você fez com o cofre ontem à noite, ${words(14, "z")} depois?`;
    expect(lengthOf(long)).toBe(25);
    const r = await run([long], input(QUIET));
    expect(r.calls).toBe(1);
    expect(r.said).toBe("O que você fez com o cofre ontem à noite?");
    expect(r.seen).toEqual(["len_trim_free"]);
  });

  it("PERFECTMAN_FREE_TRIM=0 sends it to a retry again", async () => {
    process.env["PERFECTMAN_FREE_TRIM"] = "0";
    const r = await run([candidate(27, "x"), "Vi o cofre aberto ontem à noite."], input(QUIET));
    expect(r.calls).toBe(2);
    expect(r.seen).toEqual(["len_retry"]);
  });

  it("a retry that is a little over is cut, not retried a second time", async () => {
    const r = await run([candidate(40, "x"), candidate(26, "y")], input(QUIET));
    expect(r.calls).toBe(2);
    expect(r.seen).toEqual(["len_retry", "len_trim_free"]);
    expect(lengthOf(r.said)).toBeLessThanOrEqual(cap);
  });
});

describe("what the retry bill is when 35% of the candidates are over the cap", () => {
  const cap = lengthTargetOf("short", "pt-BR").cap;
  const words = (n: number, seed: string): string => Array.from({ length: n }, (_, i) => `${seed}${i}`).join(" ");
  const turn = (n: number, seed: string): string => (n <= 12 ? `${words(n, seed)}.` : `${words(12, `${seed}a`)}. ${words(n - 12, `${seed}b`)}.`);

  /** 100 turns: the first 35 candidates are over the cap by `over[i]` words, the rest are normal (median 13). Each retry, when one is made, is 14 words. */
  async function simulate(over: readonly number[]): Promise<{ retries: number; calls: number; longest: number; trims: number }> {
    let retries = 0;
    let calls = 0;
    let longest = 0;
    let trims = 0;
    for (let i = 0; i < 100; i++) {
      const n = i < over.length ? cap + over[i]! : 6 + (i % 14);
      // The call budget is per run, and these are 100 turns of a run: each is counted on its own.
      llmBudget.reset();
      const r = await run([turn(n, `t${i}`), turn(14, `r${i}`)], input(QUIET));
      calls += r.calls;
      retries += r.calls - 1;
      trims += r.seen.filter((k) => k === "len_trim_free").length;
      longest = Math.max(longest, lengthOf(r.said));
    }
    return { retries, calls, longest, trims };
  }

  // Assumption, not a measurement: a model that is told "never more than 22 words" and overshoots does so by a little more often than by a lot.
  const NEAR = [...Array.from({ length: 25 }, (_, i) => 1 + (i % 5)), ...Array.from({ length: 10 }, (_, i) => 6 + i)];
  // Measured: the words over 22 of the 86 bot lines over the cap in production runs 52 to 60 (cap 40 then, nothing in the prompt about a cap), 35 of them picked evenly.
  const OVER = Object.values(RUN_LINES)
    .flat()
    .map((l) => lengthOf(l.text) - cap)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const REAL = Array.from({ length: 35 }, (_, i) => OVER[Math.floor((i * OVER.length) / 35)]!);

  it("overshoots that are mostly small: 10% of the turns are retried (35% before), and every line ends within the cap", async () => {
    const after = await simulate(NEAR);
    expect(after.longest).toBeLessThanOrEqual(cap);
    expect(after.retries).toBe(10);
    expect(after.trims).toBe(25);
    process.env["PERFECTMAN_FREE_TRIM"] = "0";
    const before = await simulate(NEAR);
    expect(before.retries).toBe(35);
    expect(before.longest).toBeLessThanOrEqual(cap);
  });

  it("the overshoots of real lines (runs 52 to 60, a model that did not know the cap): 25% retried, because 25 of the 35 sampled are more than a quarter over", async () => {
    expect(OVER).toHaveLength(86);
    expect(REAL.filter((n) => n <= 5).length).toBe(10);
    const after = await simulate(REAL);
    expect(after.longest).toBeLessThanOrEqual(cap);
    expect(after.retries).toBe(25);
    expect(after.trims).toBe(10);
  });
});

describe("telling the actor how long its last line ran", () => {
  const target = lengthTargetOf("short", "pt-BR");
  const long = Array.from({ length: 20 }, (_, i) => `palavra${i}`).join(" ");

  it("says the count of the last line when it was above 75% of the cap", () => {
    expect(lengthFeedbackFor(["oi", long], target, "pt-BR")).toBe("Sua última fala teve 20 palavras (de 5 a 12, no máximo 22). Desta vez, mais curta.");
    expect(lengthFeedbackFor([long, "Vi o cofre aberto ontem à noite."], target, "pt-BR")).toBeUndefined();
    expect(lengthFeedbackFor([], target, "pt-BR")).toBeUndefined();
    expect(lengthFeedbackFor([long], target, "en")).toBe("Your last line had 20 words (5 to 12, at most 22). Shorter this time.");
  });

  it("is in the decision of the prompt, only with the script checks on, and only when the last line was long", async () => {
    const profile = { ...EXAMPLE_PROMPT_PROFILE, language: "pt-BR" as const, hotelMode: true, relationshipBiases: {}, messageLength: "short" as const };
    const on = { ...profile, scriptPrompt: { length: target } };
    const withOwn = (own: string[]) => {
      const base = hotelInput();
      return { ...base, perceptionPacket: { ...base.perceptionPacket, ownRecentUtterances: own } };
    };
    for (const style of [undefined, "compact" as const]) {
      const build = (own: string[], p: typeof on | typeof profile) => {
        const built = PromptBuilder.build(withOwn(own), p, "action_intent", undefined, style);
        return built.system + built.user;
      };
      expect(build([long], on)).toContain("Sua última fala teve 20 palavras (de 5 a 12, no máximo 22)");
      expect(build(["Vi o cofre aberto ontem à noite."], on)).not.toContain("Sua última fala");
      expect(build([long], profile)).not.toContain("Sua última fala");
    }
  });
});
