import { describe, expect, it } from "vitest";
import { RUN62 } from "../../__tests__/fixtures/run62-lines.js";
import { HOTEL, input, line, profileOf, run } from "./script-step-harness.js";

/**
 * The short-line echo rules in the actor loop, on the lines of production run 62 (Heloísa, Otávio and Renato): a candidate that repeats the actor's own is retried, and a
 * repeat the retry did not fix, or a line stale after it, keeps what is new when 4 words of it are, instead of becoming silence.
 */

const as = (name: string) => profileOf({ displayName: name });
/** What the room has heard in run 62 before `t`, with the line of `me` marked as the actor's own, and the actor's own history (say and whisper). */
const room62 = (t: number, me: string) => ({
  visible: RUN62.filter((l) => l.t < t && l.kind === "say").map((l) => line(l.name === me ? "bento" : l.name.toLowerCase(), l.name, l.text)),
  own: RUN62.filter((l) => l.t < t && l.name === me).map((l) => l.text),
});
const at = (name: string, t: number): string => RUN62.find((l) => l.name === name && l.t === t)!.text;

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

