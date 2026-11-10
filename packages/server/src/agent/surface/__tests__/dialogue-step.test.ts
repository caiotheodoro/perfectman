import { describe, expect, it } from "vitest";
import type { CommittedEvent } from "@perfectman/shared";
import { isEngineAuthoredMotive, lengthOf } from "@perfectman/shared";
import { RUN60 } from "../../__tests__/fixtures/run-lines.js";
import { HOTEL, input, line, profileOf, run } from "./script-step-harness.js";

// ---- the dialogue guards, on the lines of production run 60 (Heloísa, Otávio and Renato; bot actors only) ----------------------------------------

const roomBefore = (t: number, me: string): CommittedEvent[] => RUN60.filter((l) => l.t < t).map((l) => line(l.name === me ? "bento" : l.name.toLowerCase(), l.name, l.text));
const said60 = (t: number): string => RUN60.find((l) => l.t === t)!.text;
const as = (name: string) => profileOf({ displayName: name });

describe("narration in speech", () => {
  const RENATO_52 = said60(52);
  const OTAVIO_77 = said60(77);

  it("takes the narrated sentence out of Renato's real line before anything reads it", async () => {
    expect(RENATO_52).toContain("Olho pra ela, sorriso atravessado.");
    const short = "Irmão não depõe, né? O cofre tá ali, mano, é só abrir. Olho pra ela, sorriso atravessado.";
    const r = await run([short], input(roomBefore(52, "Renato")), HOTEL, as("Renato"));
    expect(r.calls).toBe(1);
    expect(r.said).toBe("Irmão não depõe, né? O cofre tá ali, mano, é só abrir.");
    expect(r.seen).toEqual(["narration_stripped"]);
    expect(r.infos[0]).toMatchObject({ kind: "narration_stripped", actor: "Renato", before: short, after: "Irmão não depõe, né? O cofre tá ali, mano, é só abrir." });
  });

  it("strips Otávio's real narrated tail and holds the rest to the cap", async () => {
    expect(OTAVIO_77).toContain("Boto um copo na mão dele e olho fixo.");
    const r = await run([OTAVIO_77, "Rapaz, baixa esse sorriso. Fala o que você viu na assinatura. Boto um copo na mão dele e olho fixo."], input(roomBefore(77, "Otávio")), HOTEL, as("Otávio"));
    expect(r.said).not.toMatch(/Boto|olho fixo/);
    expect(lengthOf(r.said)).toBeLessThanOrEqual(22);
    expect(r.seen.filter((k) => k === "narration_stripped")).toHaveLength(2);
    expect(r.calls).toBe(2);
  });

  it("retries a line that was only stage business, asking for the body channel, and says the real line", async () => {
    const r = await run(["Olho pra ela, sorriso atravessado.", "Irmão não depõe, né?"], input(roomBefore(52, "Renato")), HOTEL, as("Renato"));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain("body.gesture");
    expect(r.said).toBe("Irmão não depõe, né?");
    expect(r.seen).toEqual(["narration_stripped"]);
  });

  it("is silent when the retry is only stage business too, and keeps the model's face", async () => {
    const face = { body: { expression: "smile", order: "move_then_speak" } };
    const r = await run([["Olho pra ela, sorriso atravessado.", face], ["Sorrio de lado e cruzo os braços.", face]], input(roomBefore(52, "Renato"), [], null, true), HOTEL, as("Renato"));
    expect(r.calls).toBe(2);
    expect(r.value.intent.intentType).toBe("no_op");
    expect(r.value.intent.privateMotiveSummary).toMatch(/^Output guard: no fresh line \(only narration/);
    expect(r.value.intent.body?.expression).toBe("smile");
    expect(r.seen).toEqual(["narration_stripped", "narration_stripped", "guard_silenced"]);
  });

  it("is off with the script checks off", async () => {
    const r = await run([RENATO_52], input(roomBefore(52, "Renato")), { maxRetries: 2, roomThreshold: 0.7, strict: true }, as("Renato"));
    expect(r.said).toBe(RENATO_52);
  });
});

describe("quotes nobody made", () => {
  const OTAVIO_230 = said60(230);

  it("flags Otávio's real line (Heloísa never called Renato 'burro') in the one retry note, and strikes the sentence when it comes back", async () => {
    expect(OTAVIO_230).toContain("burro");
    const r = await run([OTAVIO_230, OTAVIO_230], input(roomBefore(230, "Otávio")), HOTEL, as("Otávio"));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain("burro");
    expect(r.system(1)).toContain("atribui a alguém algo que não foi dito");
    expect(r.said).toBe("Rapaz, chega aqui. Eu te ofereço o copo e um lugar na mesa.");
    // The line is also 24 words: both are in the one note (the real line is over the cap by 2).
    expect(r.system(1)).toContain("o limite é 22");
    expect(r.seen).toEqual(["len_retry", "quote_retry", "quote_struck"]);
    expect(r.infos.at(-1)).toMatchObject({ kind: "quote_struck", before: OTAVIO_230, after: r.said });
  });

  it("lets a true claim through: Heloísa did say 'irmão'", async () => {
    const r = await run(["Rapaz, chega aqui. Ela te chamou de irmão, só isso. Eu te ofereço o copo e um lugar na mesa."], input(roomBefore(230, "Otávio")), HOTEL, as("Otávio"));
    expect(r.calls).toBe(1);
    expect(r.seen).toEqual([]);
  });

  it("takes the retry that stops quoting", async () => {
    const r = await run([OTAVIO_230, "Rapaz, chega aqui. Eu te ofereço o copo e um lugar na mesa."], input(roomBefore(230, "Otávio")), HOTEL, as("Otávio"));
    expect(r.seen).toEqual(["len_retry", "quote_retry"]);
    expect(r.said).toBe("Rapaz, chega aqui. Eu te ofereço o copo e um lugar na mesa.");
  });
});

describe("one retry per turn", () => {
  const PATO = [
    line("ana", "Ana", "Você já viu um pato de perto, Bento?"),
    line("caco", "Caco", "Pato de perto eu nunca vi, juro."),
    line("ana", "Ana", "Quanto custou aquele relógio do primo?"),
  ];
  const BIG = "Um pato de perto não muda nada e eu ainda quero falar muito mais sobre isso porque essa história de pato de perto me incomoda demais desde ontem quando todo mundo ficou calado na sala.";

  it("puts every rule the first attempt broke in one note, makes one retry, and repairs what is left", async () => {
    expect(lengthOf(BIG)).toBeGreaterThan(22);
    const r = await run([BIG, BIG, BIG], input(PATO));
    expect(r.calls).toBe(2);
    expect(r.system(1)).toContain("tem mais de um problema");
    expect(r.system(1)).toMatch(/1\. .*\n2\. /s);
    expect(r.system(1)).toContain("o limite é 22");
    expect(r.system(1)).toContain('"pato de perto"');
    expect(r.seen).toContain("len_retry");
    expect(r.seen).toContain("motif_retry");
  });

  it("does not offer a short reaction in the note any more", async () => {
    const r = await run(["Um pato de perto não muda nada.", "O relógio do primo parou ontem."], input(PATO));
    expect(r.system(1)).not.toContain("reação curta");
  });
});

describe("a silenced turn", () => {
  const PATO = [
    line("ana", "Ana", "Você já viu um pato de perto, Bento?"),
    line("caco", "Caco", "Pato de perto eu nunca vi, juro."),
    line("ana", "Ana", "Quanto custou aquele relógio do primo?"),
  ];
  const AGAIN = "Pato de perto, pato de perto, eu sei.";

  it("keeps the face the model gave it", async () => {
    const gesture = { body: { gesture: { kind: "laugh" }, order: "move_then_speak" } };
    const r = await run([["Um pato de perto não muda nada.", gesture], [AGAIN, gesture]], input(PATO, [], null, true));
    expect(r.value.intent.intentType).toBe("no_op");
    expect(r.value.intent.body?.gesture?.kind).toBe("laugh");
  });

  it("gives it a face for the strongest feeling the model named when it gave none", async () => {
    const r = await run([["Um pato de perto não muda nada.", { emotionDrivers: ["raiva contida"] }], [AGAIN, { emotionDrivers: ["raiva contida", "vergonha"] }]], input(PATO, [], null, true));
    expect(r.value.intent.intentType).toBe("no_op");
    expect(r.value.intent.body?.expression).toBe("angry");
    expect(r.value.intent.visibleContent).toBeUndefined();
  });

  it("adds no face when the run has no bodies, or the model named no feeling", async () => {
    const noBodies = await run([["Um pato de perto não muda nada.", { emotionDrivers: ["raiva"] }], [AGAIN, { emotionDrivers: ["raiva"] }]], input(PATO));
    expect(noBodies.value.intent.body).toBeUndefined();
    const noFeeling = await run([["Um pato de perto não muda nada.", { emotionDrivers: ["curiosidade"] }], [AGAIN, { emotionDrivers: ["curiosidade"] }]], input(PATO, [], null, true));
    expect(noFeeling.value.intent.body).toBeUndefined();
  });

  it("logs the line it held back: what the model wrote and nothing after", async () => {
    const r = await run(["Um pato de perto não muda nada.", AGAIN], input(PATO));
    expect(r.infos).toEqual([
      { kind: "motif_retry", actor: "Bento", before: "Um pato de perto não muda nada." },
      { kind: "guard_silenced", actor: "Bento", before: AGAIN, after: "" },
    ]);
  });
});
