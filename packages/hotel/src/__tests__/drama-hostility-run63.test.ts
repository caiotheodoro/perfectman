/**
 * Run 63 (2026-11-11, Sobremesa in the Terraço, Heloísa, Otávio and Renato) replayed offline. The scene opens with a forgery accusation and goes on for seven minutes
 * of accusations, a price on silence and a dare, and the drama log had a grievance above 0 in 2 of 29 rows: the word list read one line of 54 ("senão eu conto tudo").
 * The 54 spoken lines are `fixtures/run63/lines.json`, each labelled by hand: `hostile` is a line that charges, demands or dares and must read as such, `soft` a line
 * that does it more softly (listed, not required), the rest is ordinary talk and must read as none. `ordinary` below is a corpus of ordinary dialogue built around the
 * words the new phrases use (safe, envelope, signature, pen, coffee, money, "prova", "vi tudo"): none of it may read as hostile.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyHostility, readHostility } from "../director/drama/hostility.js";
import { ProvocationLedger } from "../director/drama/provocation.js";
import { DEFAULT_DRAMA_TUNING } from "../director/drama/tuning.js";

const HERE = dirname(fileURLToPath(import.meta.url));
type Line = { i: number; t_s: number; speaker: string; text: string; hostile?: string; soft?: string };
const LINES = JSON.parse(readFileSync(join(HERE, "../../fixtures/run63/lines.json"), "utf8")) as Line[];
const STRONG = new Set(["insult", "threat", "blackmail", "accusation", "challenge"]);

describe("run 63's spoken lines through the hostility word list", () => {
  it("has the 54 lines of the run, 10 labelled hostile", () => {
    expect(LINES).toHaveLength(54);
    expect(LINES.filter((l) => l.hostile)).toHaveLength(10);
  });

  it("reads every hostile line (recall 10 of 10; the word list read 1 of 10 before)", () => {
    const missed = LINES.filter((l) => l.hostile && !classifyHostility(l.text)).map((l) => l.text);
    expect(missed).toEqual([]);
    for (const l of LINES.filter((x) => x.hostile)) expect(STRONG.has(classifyHostility(l.text)!), l.text).toBe(true);
  });

  it("reads no line that was labelled ordinary (0 false positives on the other 34)", () => {
    const wrong = LINES.filter((l) => !l.hostile && !l.soft && readHostility(l.text).own).map((l) => `${l.i}: ${l.text}`);
    expect(wrong).toEqual([]);
  });

  it("reads the lines the scene opens with: the forgery accusation, the dare, the price on silence", () => {
    expect(classifyHostility("Minha cara, essa assinatura aí não é do Henrique.")).toBe("accusation");
    expect(classifyHostility("Heloísa, tá na cara que a assinatura é falsa. Abre o cofre, pô.")).toBe("accusation");
    expect(classifyHostility("Heloísa, chega de café. Me dá um envelope e eu esqueço o que vi.")).toBe("blackmail");
    expect(classifyHostility("Café não, Heloísa. Quero o cofre aberto e um envelope, hoje.")).toBe("blackmail");
    expect(classifyHostility("Eu?! Tá me queimando, Heloísa? Então abre o cofre e prova.")).toBe("challenge");
    expect(classifyHostility("Eu vi a tua mão na caneta, Heloísa.")).toBe("accusation");
  });

  it("reads the same charges in English", () => {
    expect(classifyHostility("That signature isn't his and you know it.")).toBe("accusation");
    expect(classifyHostility("It's a forged signature, and everyone here knows what you did.")).toBe("accusation");
    expect(classifyHostility("You faked it.")).toBe("accusation");
    expect(classifyHostility("Hush money, then. Or I tell the whole table.")).toBe("blackmail");
  });
});

describe("what the ledger makes of run 63's first minute", () => {
  const REF: Record<string, string> = { Heloísa: "person-1", Otávio: "person-2", Renato: "person-3" };
  const nameAt = (text: string): string | undefined => Object.keys(REF).find((n) => text.startsWith(`${n},`) || text.includes(`, ${n}`) || text.includes(` ${n}.`) || text.includes(` ${n}?`));

  it("gives Heloísa a grievance against Otávio within seconds of the opening accusation, where the log had provocation 0", () => {
    let now = 0;
    const ledger = new ProvocationLedger(() => DEFAULT_DRAMA_TUNING.provocation, () => now, (a, b) => a !== b);
    const opening = LINES[0]!;
    now = opening.t_s * 1000;
    ledger.note(
      { speaker: REF[opening.speaker]!, content: opening.text, addressees: ["person-1"], mentioned: [] },
      [{ ref: "person-1", heard: true }, { ref: "person-3", heard: true }],
    );
    expect(ledger.levelOf("person-1", "person-2")).toBeGreaterThanOrEqual(0.4);
  });

  it("counts the cast's hostile lines over the run, enough to keep a grievance alive for most of it", () => {
    let now = 0;
    const ledger = new ProvocationLedger(() => DEFAULT_DRAMA_TUNING.provocation, () => now, (a, b) => a !== b);
    let live = 0;
    let rows = 0;
    for (const l of LINES) {
      now = l.t_s * 1000;
      const speaker = REF[l.speaker]!;
      const to = nameAt(l.text);
      const addressee = to !== undefined ? REF[to]! : speaker === "person-2" ? "person-1" : "person-2";
      ledger.note({ speaker, content: l.text, addressees: [addressee], mentioned: to ? [REF[to]!] : [] }, Object.values(REF).filter((r) => r !== speaker).map((ref) => ({ ref, heard: true })));
      rows++;
      if (["person-1", "person-2", "person-3"].some((o) => ["person-1", "person-2", "person-3"].some((s) => o !== s && ledger.levelOf(o, s) > 0))) live++;
    }
    expect(ledger.total).toBeGreaterThanOrEqual(8);
    expect(live / rows).toBeGreaterThanOrEqual(0.7);
  });
});

/** Ordinary talk that shares words with the new phrases. */
const ORDINARY = [
  "O cofre fica no escritório, atrás do quadro.",
  "Abre o cofre do hotel só com a chave do gerente.",
  "Pode assinar aqui, por favor, e aqui também.",
  "A assinatura do contrato está no verso da última página.",
  "Essa assinatura não é a do cartório, é a do banco.",
  "O envelope está em cima da mesa, perto do café.",
  "Preciso de um envelope para mandar a carta amanhã.",
  "Quero um envelope grande, desses de papel pardo.",
  "Me dá um envelope, por favor, que eu vou postar isso.",
  "Quero um café sem açúcar e um pedaço de bolo.",
  "Quero metade do bolo, o resto é seu.",
  "Quero minha vez no jogo, estou esperando há meia hora.",
  "Fui ao museu e vi tudo o que tinha para ver.",
  "Eu vi a sua apresentação ontem, ficou ótima.",
  "Eu vi a tua mão levantada, pode falar.",
  "Estou tremendo de frio, alguém tem um casaco?",
  "Ela está tremendo de frio na porta.",
  "Todo mundo aqui sabe que você cozinha bem.",
  "Todo mundo sabe que o time joga amanhã.",
  "Pode falar sem medo, estou aqui para ouvir.",
  "Fala agora, que depois a comida esfria.",
  "A prova que ele fez ontem foi difícil.",
  "Prova esse molho, acho que ficou bom.",
  "Então abre a porta, que eu estou na chuva.",
  "Então mostra o caminho, eu não conheço a casa.",
  "O sol está me queimando, preciso de sombra.",
  "A caneta que escreveu esta carta está sem tinta.",
  "A letra dele é bonita, parece de professor.",
  "Esqueço o guarda-chuva toda vez que sai de casa.",
  "Eu esqueço o que eu ia dizer quando fico nervoso.",
  "Meu silêncio não significa que eu esteja bravo, só cansado.",
  "Fico calado quando estou pensando, não se preocupe.",
  "Fico quieto se você preferir assim.",
  "O dobro de açúcar estraga a receita.",
  "Quero o dobro de queijo na pizza, por favor.",
  "A conta dá o dobro do que a gente imaginava.",
  "Ele é um ótimo golpista de sinuca, ninguém ganha dele.",
  "Você é um fraude no truco, nunca blefa de verdade, rapaz.",
  "Não sei de tudo, mas sei o suficiente para ajudar.",
  "Vai contar para a mesa o que aconteceu na viagem?",
  "Senão eu perco o ônibus, anda logo.",
  "Cofre, mesa, café e uma boa conversa: a noite é nossa.",
  "Obrigado pelo café, Heloísa, estava ótimo.",
  "O Otávio chega às oito, mas ele sempre se atrasa.",
  "Renato, passa o sal, por favor.",
  "A herança do tio foi dividida em partes iguais entre os três.",
  "O cartório abre às nove e fecha às cinco.",
  "Você assinou o recibo? Preciso arquivar.",
  "A firma fechou o ano com lucro, tudo certo.",
  "Prove o vinho antes de servir a mesa toda.",
  "I saw your talk yesterday, it was great.",
  "The signature page is at the back of the contract.",
  "Open the safe in the office with the manager's key.",
  "Can you give me an envelope? I need to mail this.",
  "Keep quiet for the baby, please, she just fell asleep.",
  "Everyone here knows the way to the station.",
  "That signature is on the left, next to the date.",
  "I have a fake plant in the hallway, it looks real.",
  "She is a forger of fine old paintings in the museum exhibit, a fiction writer's dream.",
  "Go on, then, tell me about your trip.",
  "I can prove the theorem in three lines.",
  "Say it now or we'll miss the toast.",
  "Hush, the baby is sleeping.",
  "You are a great cook, honestly.",
];

describe("ordinary dialogue around the same words", () => {
  it(`reads none of ${ORDINARY.length} ordinary lines as the speaker's own hostility`, () => {
    const hits = ORDINARY.flatMap((line) => {
      const r = readHostility(line);
      return r.own || r.reported ? [{ line, ...r }] : [];
    });
    expect(hits, JSON.stringify(hits)).toEqual([]);
  });
});
