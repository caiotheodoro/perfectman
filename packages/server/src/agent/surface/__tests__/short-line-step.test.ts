import { afterEach, describe, expect, it } from "vitest";
import { lengthOf } from "@perfectman/shared";
import { llmBudget } from "../../../llm/llm-budget.js";
import { lengthFeedbackFor, lengthTargetOf } from "../../script-guard.js";
import { EXAMPLE_PROMPT_PROFILE } from "../../persona-prompt-profile.js";
import { PromptBuilder } from "../../prompt-builder.js";
import { hotelInput } from "../../__tests__/hotel-test-helpers.js";
import { RUN_LINES } from "../../__tests__/fixtures/run-lines.js";
import { RUN62 } from "../../__tests__/fixtures/run62-lines.js";
import { HOTEL, QUIET, input, line, profileOf, run } from "./script-step-harness.js";

/**
 * The short-line guards in the actor loop: what happens to a candidate that is a tic, an echo of the actor's own lines, or a little over the cap, and what the
 * retry bill is for a set of candidates of which 35% are over the cap (run 62: 130 length retries in 374 turns).
 */

const as = (name: string) => profileOf({ displayName: name });
/** What the room has heard in run 62 before `t`, with the line of `me` marked as the actor's own, and the actor's own history (say and whisper). */
const room62 = (t: number, me: string) => ({
  visible: RUN62.filter((l) => l.t < t && l.kind === "say").map((l) => line(l.name === me ? "bento" : l.name.toLowerCase(), l.name, l.text)),
  own: RUN62.filter((l) => l.t < t && l.name === me).map((l) => l.text),
});
const at = (name: string, t: number): string => RUN62.find((l) => l.name === name && l.t === t)!.text;

afterEach(() => {
  delete process.env["PERFECTMAN_FREE_TRIM"];
});

describe("a form of address the actor keeps using", () => {
  // "Rapaz" opens 3 of the actor's last 5 lines already, so it would be the 4th of the last 6 turns.
  const ownRapaz = ["Rapaz, o número é o que você viu. Fala baixo, e a firma é sua.", "A assinatura saiu torta, e o dedo tremeu.", "Rapaz. Toco o número, mas só à meia-noite.", "Contrato assinado, não lembrança.", "Rapaz, a conta que eu tenho é maior que a dela."];

  it("is taken off the line with no model call", async () => {
    const said = "Rapaz, ela escondeu o caixa e você vai levar a culpa junto.";
    const r = await run([said], input(QUIET, ownRapaz), HOTEL, as("Otávio"));
    expect(r.calls).toBe(1);
    expect(r.said).toBe("Ela escondeu o caixa e você vai levar a culpa junto.");
    expect(r.seen).toEqual(["tic", "tic_stripped"]);
    expect(r.infos[0]).toMatchObject({ kind: "tic", actor: "Otávio", before: said, after: "address:rapaz" });
    expect(r.infos[1]).toMatchObject({ kind: "tic_stripped", actor: "Otávio", before: said, after: r.said });
    expect(r.value.fallbackApplied).toBe(false);
  });

  it("is left alone when it is not a tic yet", async () => {
    const r = await run(["Rapaz, ela escondeu o caixa e você vai levar a culpa junto."], input(QUIET, ownRapaz.slice(2)), HOTEL, as("Otávio"));
    expect(r.said).toBe("Rapaz, ela escondeu o caixa e você vai levar a culpa junto.");
    expect(r.seen).toEqual([]);
  });

  it("keeps a name: the room's names are address, not a tic", async () => {
    const ownNames = Array.from({ length: 5 }, (_, i) => `Ana, ${["a janela", "o vento", "a porta", "o corredor", "a chave"][i]} está do lado de fora da sala.`);
    const r = await run(["Ana, o relógio do primo parou ontem à noite no corredor."], input(QUIET, ownNames), HOTEL, as("Bento"));
    expect(r.seen).toEqual([]);
  });

  it("rides the retry when there is one anyway: the note says what not to start with, and what the retry still has is taken off", async () => {
    const long = `Rapaz, ${Array.from({ length: 34 }, (_, i) => `palavra${i}`).join(" ")}.`;
    const again = "Rapaz, ela escondeu o caixa e você vai levar a culpa junto.";
    const r = await run([long, again], input(QUIET, ownRapaz), HOTEL, as("Otávio"));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain('Não comece com "rapaz"');
    expect(r.system(1)).toContain("o limite é 22");
    expect(r.said).toBe("Ela escondeu o caixa e você vai levar a culpa junto.");
    expect(r.seen).toEqual(["tic", "len_retry", "tic", "tic_stripped"]);
  });

  it("a retry that dropped it is taken as it is", async () => {
    const long = `Rapaz, ${Array.from({ length: 34 }, (_, i) => `palavra${i}`).join(" ")}.`;
    const r = await run([long, "Ela escondeu o caixa e você vai levar a culpa junto."], input(QUIET, ownRapaz), HOTEL, as("Otávio"));
    expect(r.calls).toBe(2);
    expect(r.seen).toEqual(["tic", "len_retry"]);
    expect(r.said).toBe("Ela escondeu o caixa e você vai levar a culpa junto.");
  });

  it("is off with the script checks off", async () => {
    const said = "Rapaz, ela escondeu o caixa e você vai levar a culpa junto.";
    const r = await run([said], input(QUIET, ownRapaz), { maxRetries: 2, roomThreshold: 0.7, strict: true }, as("Otávio"));
    expect(r.said).toBe(said);
    expect(r.seen).toEqual([]);
  });
});

describe("an opening word or a tag question the actor keeps using", () => {
  const ownBebado = ["Bêbado não erra assinatura. Erra quem forjou.", "Bêbado vê o que sóbrio não quer ver.", "Rapaz, repete o que você disse.", "Bêbado, sim. Mas viu o que escondeu, minha cara."];

  it("is asked about once, because no cut fixes it, and the retry is taken as it is", async () => {
    const again = "Bêbado confessa o que sóbrio esconde, e a mesa sabe disso.";
    const r = await run([again, "Pelo menos o bêbado confessa, e a mesa sabe disso."], input(QUIET, ownBebado), HOTEL, as("Otávio"));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain('Não comece com "bebado"');
    expect(r.said).toBe("Pelo menos o bêbado confessa, e a mesa sabe disso.");
    expect(r.seen).toEqual(["tic"]);
    expect(r.infos[0]).toMatchObject({ kind: "tic", after: "opener:bebado" });
  });

  it("a retry that still opens with it is said: there is no cut that fixes it", async () => {
    const again = "Bêbado confessa o que sóbrio esconde, e a mesa sabe disso.";
    const r = await run([again, "Bêbado confessa o que sóbrio esconde, e a mesa sabe disso, não é?"], input(QUIET, ownBebado), HOTEL, as("Otávio"));
    expect(r.calls).toBe(2);
    expect(r.said.startsWith("Bêbado")).toBe(true);
    expect(r.value.fallbackApplied).toBe(false);
  });
});

describe("short lines that repeat the actor's own", () => {
  const heloisa = (t: number) => room62(t, "Heloísa");
  const H22 = at("Heloísa", 22);
  const H27 = at("Heloísa", 27);

  it("Heloísa's 27 s line is an echo of her 22 s line: one retry, and a retry with something new is said", async () => {
    const { visible, own } = heloisa(27);
    const fresh = "Otávio, meu bem, a firma fecha às seis e ninguém assina nada depois.";
    const r = await run([H27, fresh], input(visible, own), HOTEL, as("Heloísa"));
    expect(r.calls).toBe(2);
    expect(r.seen[0]).toBe("repeat_own");
    expect(r.infos[0]).toMatchObject({ kind: "repeat_own", after: `lead: ${H22}` });
    expect(r.said).toBe(fresh);
  });

  it("when the retry says it again with nothing new left, the turn is held back and no filler is said", async () => {
    const { visible, own } = heloisa(27);
    const r = await run([H27, H27], input(visible, own), HOTEL, as("Heloísa"));
    expect(r.calls).toBe(2);
    expect(r.seen).toEqual(["repeat_own", "repeat_own", "repeat_blocked"]);
    expect(r.value.fallbackApplied).toBe(true);
    expect(r.value.intent.intentType).toBe("no_op");
  });

  it("when the retry says it again but a sentence of it is new, the new part is said and the turn is not silenced", async () => {
    const { visible, own } = heloisa(27);
    const half = "Otávio, meu bem, sente-se. Um café antes de qualquer palavra? A firma fecha às seis e ninguém assina nada depois.";
    const r = await run([half, half], input(visible, own), HOTEL, as("Heloísa"));
    expect(r.calls).toBe(2);
    expect(r.said).toBe("A firma fecha às seis e ninguém assina nada depois.");
    expect(r.value.fallbackApplied).toBe(false);
    expect(r.seen).toContain("echo_repaired");
    expect(r.seen).not.toContain("repeat_blocked");
    expect(r.infos.at(-1)).toMatchObject({ kind: "echo_repaired", before: half, after: r.said });
  });

  it("a person who asked the actor something still gets the answer as the model wrote it", async () => {
    const { visible, own } = heloisa(27);
    const guest = line("h:42", "Visitante", "Heloísa, você quer sentar?", { untrusted: true, addresseeIds: ["bento"], mentionedAgentIds: ["bento"] });
    const r = await run([H27, H27], input(visible, own, guest), HOTEL, as("Heloísa"));
    expect(r.said).toBe(H27);
  });

  it("the two lines that were silenced in run 62 are not repeats of the actor's own: they go out, without the 'querido' she had used 4 times in 6", async () => {
    const first = "Renato, querido, abro o cofre, sim. Busque a chave no vaso, vai.";
    const second = "Otávio, querido, a firma fecha às seis. Ninguém assina nada depois, entende?";
    for (const [t, text, stripped] of [
      [160, first, "Renato, abro o cofre, sim. Busque a chave no vaso, vai."],
      [285, second, "Otávio, a firma fecha às seis. Ninguém assina nada depois, entende?"],
    ] as const) {
      const { visible, own } = heloisa(t);
      const r = await run([text, text], input(visible, own), HOTEL, as("Heloísa"));
      expect(r.calls, text).toBe(1);
      expect(r.seen, text).toEqual(["tic", "tic_stripped"]);
      expect(r.said, text).toBe(stripped);
    }
  });

  it("is off with the script checks off: the short lines go out as they did", async () => {
    const { visible, own } = heloisa(27);
    const r = await run([H27], input(visible, own), { maxRetries: 2, roomThreshold: 0.7, strict: true }, as("Heloísa"));
    expect(r.calls).toBe(1);
    expect(r.said).toBe(H27);
  });
});

describe("a line stale against the actor's own lines, after its retry", () => {
  const room = [line("ana", "Ana", "A lasanha esfriou no balcão ontem."), line("caco", "Caco", "Quanto custou aquele relógio do primo?"), line("ana", "Ana", "A lasanha suja ficou esquecida no balcão, ninguém comeu aquela porcaria.")];
  // Every clause of it says what the room just said, and so does the retry.
  const stale = "Ninguém comeu aquela lasanha suja esquecida no balcão ontem, porcaria esfriou lá.";
  // Its first clause does, its second is new.
  const MORE = "Ninguém comeu aquela lasanha suja no balcão, mas o cheiro de vinagre e mofo continua ali agora.";

  it("is silenced when nothing in it is new", async () => {
    const r = await run([stale, stale], input(room));
    expect(r.seen).toEqual(["novelty_retry", "guard_silenced"]);
    expect(r.value.intent.intentType).toBe("no_op");
  });

  it("keeps the clauses that are new when 4 words of them remain: the second half of the line, not silence", async () => {
    const r = await run([MORE, MORE], input(room));
    expect(r.seen).toEqual(["novelty_retry", "echo_repaired"]);
    expect(r.said).toBe("Mas o cheiro de vinagre e mofo continua ali agora.");
    expect(r.value.fallbackApplied).toBe(false);
  });

  it("keeps the sentence that is new when 4 words of it remain", async () => {
    const mixed = "Ninguém comeu aquela lasanha suja esquecida no balcão ontem. O cofre emprestado sumiu da sala dos fundos esta madrugada.";
    const r = await run([mixed, mixed], input(room));
    expect(r.seen).toEqual(["novelty_retry", "echo_repaired"]);
    expect(r.said).toBe("O cofre emprestado sumiu da sala dos fundos esta madrugada.");
    expect(r.infos.at(-1)).toMatchObject({ kind: "echo_repaired", before: mixed, after: r.said });
  });
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

  it("the overshoots of real lines (runs 52 to 60, a model that did not know the cap): 25% retried, because 71% of them are more than a quarter over", async () => {
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
