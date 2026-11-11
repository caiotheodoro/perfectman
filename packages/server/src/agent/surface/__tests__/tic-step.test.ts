import { describe, expect, it } from "vitest";
import { HOTEL, QUIET, input, profileOf, run } from "./script-step-harness.js";

/**
 * The tic guard in the actor loop: a form of address the actor keeps using is taken off the line with no model call (and rides the retry note when there is one anyway);
 * an opening word or a tag question it keeps using earns one retry.
 */

const as = (name: string) => profileOf({ displayName: name });

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

