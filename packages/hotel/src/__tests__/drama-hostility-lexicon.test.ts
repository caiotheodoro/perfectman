/**
 * Blackmail, ultimatum and accusation count as hostility, and words a line only reports do not count against the person who reports them (errata P8).
 * Production run 60 (2026-11-10, Heloísa, Otávio and Renato): Renato blackmailed and accused for six minutes ("cofre hoje, senão eu conto pra mesa", "a mão que apertou era
 * sua") and the word list read none of it as hostile; Otávio's "ela te chamou de irmão e de burro" read as Otávio's own insult at Renato, the grievance of the messenger's
 * addressee against the messenger. Only bot actors' lines are used here.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyHostility, readHostility } from "../director/drama/hostility.js";
import { ProvocationLedger } from "../director/drama/provocation.js";
import type { Listener, SpokenLine } from "../director/drama/provocation.js";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";

/** Run 60, the lines that carried the fight and were read as nothing. */
const RUN_60 = {
  blackmail1: "Heloísa, cofre hoje, senão eu conto pra mesa quem segurou a caneta.",
  blackmail2: "Heloísa, cofre ou eu abro a boca — e não é amanhã, é agora.",
  accusation: "A caneta era do Henrique, mas a mão que apertou era sua, irmã.",
  reported: "Ela te chamou de irmão e de burro na mesma frase.",
  ultimatum: "Heloísa, ouve: cofre hoje, dinheiro na minha mão, e eu pego o primeiro avião. Escândalo não interessa a ninguém aqui, né?",
};

describe("blackmail and ultimatum", () => {
  it.each([
    [RUN_60.blackmail1],
    [RUN_60.blackmail2],
    [RUN_60.ultimatum],
    ["Ou você paga hoje ou eu abro a boca."],
    ["Se não quer escândalo, me dá o dinheiro."],
    ["Vou contar pra todo mundo o que você fez."],
    ["Conto pra todos, Renato, não duvida."],
    ["Pague ou eu exponho essa história."],
    ["Pay up or I tell the whole table."],
    ["Do it now, or else."],
    ["Give me the money or I'll tell everyone."],
  ])("%s is blackmail", (text) => {
    expect(classifyHostility(text)).toBe("blackmail");
  });

  it("is not triggered by the words alone: ou eu, ou você, escândalo, vou contar, cofre", () => {
    for (const text of [
      "Quer café ou você prefere chá?",
      "Vai ele ou eu, tanto faz.",
      "Que escândalo o preço do café!",
      "Beleza, mas sem escândalo, a gente conversa no almoço.",
      "Vou contar uma história que ouvi ontem.",
      "O cofre fica no escritório.",
      "Senão eu perco o ônibus, anda logo.",
      "Anda logo ou eu me atraso.",
    ]) {
      expect(classifyHostility(text), text).toBeUndefined();
    }
  });

  it("a threat of violence still outranks blackmail, and blackmail an insult", () => {
    expect(classifyHostility("Senão eu conto, e vou te matar.")).toBe("threat");
    expect(classifyHostility("Cofre hoje, seu idiota.")).toBe("blackmail");
  });
});

describe("accusation", () => {
  it.each([
    [RUN_60.accusation],
    ["Você mentiu pra todo mundo."],
    ["Foi você que forjou a assinatura."],
    ["A assinatura falsa é sua, eu sei."],
    ["Você falsificou o contrato."],
    ["Ele me enganou, Heloísa."],
    ["Sei o que você fez no escritório ontem."],
    ["Foi você quem roubou o dinheiro da caixa."],
    ["Eu vi você escondendo a carta."],
    ["You forged it. You lied to all of us."],
    ["I know what you did."],
    ["It was you who stole it."],
  ])("%s is an accusation", (text) => {
    expect(classifyHostility(text)).toBe("accusation");
  });

  it("is not triggered by ordinary uses of the same words", () => {
    for (const text of [
      "Eu vi você ontem no mercado.",
      "Foi você que pediu a pizza?",
      "Minha mente está cansada hoje.",
      "A mão que me ajudou foi a da minha avó.",
      "Ele roubou a cena na peça de ontem.",
      "O GPS me enganou e eu errei a saída.",
      "Eu sei que você consegue.",
    ]) {
      expect(classifyHostility(text), text).toBeUndefined();
    }
  });

  it("an insult outranks an accusation, an accusation a bet", () => {
    expect(classifyHostility("Você mentiu, seu idiota.")).toBe("insult");
    expect(classifyHostility("Aposto que você mentiu.")).toBe("accusation");
  });
});

describe("reported speech is not the speaker's own", () => {
  it("run 60: 'ela te chamou de irmão e de burro' is reported, not an insult by the one who says it", () => {
    expect(readHostility(RUN_60.reported)).toEqual({ reported: "insult" });
    expect(classifyHostility(RUN_60.reported)).toBeUndefined();
  });

  it.each([
    ["Ela disse que você é um idiota."],
    ["Heloísa te chamou de burro na frente de todo mundo."],
    ["Disseram que você é um covarde."],
    ["Ele me chamou de imbecil, dá pra acreditar?"],
    ["Segundo ela, você é um mentiroso."],
    ["Ela falou: você é um trouxa."],
    ["Dizem que você mentiu pra todo mundo."],
    ["She called you a liar."],
    ["He said you are a coward."],
    ["He told me you stole it."],
  ])("%s is reported", (text) => {
    const r = readHostility(text);
    expect(r.own, text).toBeUndefined();
    expect(r.reported, text).toBeDefined();
  });

  it("your own words stay your own, even next to a report", () => {
    expect(classifyHostility("Eu disse que você é um idiota, e repito.")).toBe("insult");
    expect(classifyHostility("Eu já falei que você é um covarde.")).toBe("insult");
    expect(classifyHostility("Ela disse que sim, mas você é um idiota.")).toBe("insult");
    expect(classifyHostility("Ela te chamou de burro? Repete na minha cara.")).toBe("threat");
    expect(readHostility("Ela disse que você é um idiota. Você é um idiota.")).toEqual({ own: "insult", reported: "insult" });
  });

  it("a report with nothing hostile in it is nothing", () => {
    expect(readHostility("Ela disse que viria, mas até agora nada.")).toEqual({});
    expect(readHostility("Heloísa te chamou pra jantar.")).toEqual({});
  });
});

describe("the word list uses no regex lookbehind (shared builds run on older engines)", () => {
  it("hostility.ts has no `(?<` in a pattern", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "../director/drama/hostility.ts"), "utf8").split("\n").filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"));
    expect(source.join("\n")).not.toMatch(/\(\?<[=!]/);
  });
});

/** A ledger on a clock the test moves, with the pair rule open for every ordered pair of the three. */
function ledger() {
  let t = 1_000_000;
  const l = new ProvocationLedger(() => DEFAULT_DRAMA_TUNING.provocation, () => t, () => true);
  return { l, advance: (ms: number) => void (t += ms) };
}
const line = (speaker: string, content: string, over: Partial<SpokenLine> = {}): SpokenLine => ({ speaker, content, addressees: [], mentioned: [], ...over });
const heard = (...refs: string[]): Listener[] => refs.map((ref) => ({ ref, heard: true }));

describe("ProvocationLedger with the new kinds", () => {
  const T = DEFAULT_DRAMA_TUNING.provocation;

  it("blackmail counts as a threat (0.5) and an accusation a little less (0.4), against the speaker", () => {
    const a = ledger();
    // person-3 is Renato, person-1 Heloísa: his blackmail names her.
    expect(a.l.note(line("person-3", RUN_60.blackmail1, { mentioned: ["person-1"], addressees: ["person-1"] }), heard("person-1", "person-2"))).toBe("blackmail");
    expect(a.l.levelOf("person-1", "person-3")).toBe(T.gain.blackmail);
    expect(T.gain.blackmail).toBe(T.gain.threat);
    const b = ledger();
    expect(b.l.note(line("person-3", RUN_60.accusation, { mentioned: ["person-1"] }), heard("person-1"))).toBe("accusation");
    expect(b.l.levelOf("person-1", "person-3")).toBe(0.4);
    expect(b.l.raised.accusation).toBe(1);
    expect(b.l.total).toBe(1);
  });

  it("run 60: Otávio's 'ela te chamou de burro' raises no grievance against Otávio and none against anyone: the alleged speaker is not named", () => {
    const { l } = ledger();
    // person-2 Otávio speaks to person-3 Renato about "ela" (Heloísa, not named): the old reading gave Renato a grievance against Otávio.
    expect(l.note(line("person-2", RUN_60.reported, { addressees: ["person-3"] }), heard("person-3", "person-1"))).toBeUndefined();
    expect(l.levelOf("person-3", "person-2")).toBe(0);
    expect(l.levelOf("person-3", "person-1")).toBe(0);
    expect(l.total).toBe(0);
    expect(l.reportedIgnored).toBe(1);
  });

  it("a named alleged speaker gets a small grievance (0.15) from the person told, never the messenger", () => {
    const { l } = ledger();
    l.note(line("person-2", "Heloísa te chamou de burro, Renato.", { addressees: ["person-3"], mentioned: ["person-1", "person-3"] }), heard("person-3", "person-1"));
    expect(l.levelOf("person-3", "person-1")).toBe(T.reportedGain);
    expect(T.reportedGain).toBe(0.15);
    expect(l.levelOf("person-3", "person-2")).toBe(0);
    expect(l.levelOf("person-1", "person-2")).toBe(0);
    expect(l.total).toBe(0);
    expect(l.reportedRaised).toBe(1);
    // It is not a hostile line of anyone's: no evidence for the spine.
    expect(l.events).toEqual([]);
  });

  it("the reported grievance only where the scenario lets the pair, and it stays under what opens a glare", () => {
    const { l } = (() => {
      let t = 1_000_000;
      return { l: new ProvocationLedger(() => T, () => t, (o, s) => o === "person-3" && s === "person-2") };
    })();
    l.note(line("person-2", "Heloísa te chamou de burro, Renato.", { addressees: ["person-3"], mentioned: ["person-1", "person-3"] }), heard("person-3", "person-1"));
    expect(l.levelOf("person-3", "person-1")).toBe(0);
    expect(T.reportedGain).toBeLessThan(DEFAULT_DRAMA_TUNING.theta[1]);
    expect(T.reportedGain).toBeLessThan(T.grievanceAt);
  });

  it("counted hostile lines are logged as evidence: who they were about, who said them, what kind", () => {
    const { l, advance } = ledger();
    l.note(line("person-3", RUN_60.blackmail1, { mentioned: ["person-1"] }), heard("person-1"));
    advance(10_000);
    l.note(line("person-1", "Renato, você mentiu.", { addressees: ["person-3"] }), heard("person-3"));
    expect(l.events.map((e) => [e.observer, e.offender, e.kind])).toEqual([["person-1", "person-3", "blackmail"], ["person-3", "person-1", "accusation"]]);
    const ev = l.evidence("person-1", "person-3", 90_000);
    expect(ev).toMatchObject({ between: 2, against: 1, strong: 1 });
  });
});
