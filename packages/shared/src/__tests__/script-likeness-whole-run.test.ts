import { describe, expect, it } from "vitest";
import {
  MAJOR_KINDS,
  SCRIPT_NORMS,
  analyze,
  computeScriptStats,
  findDemandLoops,
  findTics,
  inventedCorpus,
  isFillerText,
  isReaction,
  joinScenes,
  parseBeatText,
  progressAndDebt,
  scoreTurns,
} from "../index.js";
import type { ScriptTurn } from "../index.js";

const say = (speaker: string, text: string, atMs?: number, extra: Partial<ScriptTurn> = {}): ScriptTurn => ({ speaker, text, kind: "say", ...(atMs !== undefined ? { atMs } : {}), ...extra });
const names = new Set<string>();

// Invented lines only. Varied on purpose (no shared 4-letter words from turn to turn), and free of promises, accusations and reveals.
const SUBJECTS = ["o carteiro", "a vizinha", "meu primo", "o dono da padaria", "a moça do segundo andar", "um senhor de chapéu", "a criança do prédio", "o motorista"];
const VERBS = ["trouxe", "esqueceu", "procurou", "deixou", "levou", "perdeu", "guardou", "achou"];
const THINGS = ["uma caixa azul", "dois guarda-chuvas", "o relógio quebrado", "um pacote de biscoitos", "a lanterna velha", "três cadernos", "o mapa rasgado", "uma panela de barro"];
const PLACES = ["na garagem", "perto da escada", "ontem à tarde", "depois do almoço", "atrás do sofá", "junto da janela", "no porão", "antes da chuva"];
const chat = (n: number): ScriptTurn[] =>
  Array.from({ length: n }, (_, i) => say(["ana", "bia", "caio"][i % 3]!, `${SUBJECTS[(i * 3) % 8]} ${VERBS[(i * 5 + 1) % 8]} ${THINGS[(i * 7 + 2) % 8]} ${PLACES[(i * 11 + 3) % 8]}.`, i * 8_000));

describe("fillers", () => {
  it("reads a line made only of interjections as one, and nothing longer or with a content word", () => {
    for (const t of ["Ué.", "Hm.", "Tá, tá.", "Ah.", "Sei.", "KKKK", "Ok", "Huh.", "Okay.", "É.", "Hmm... né?"]) expect(isFillerText(t), t).toBe(true);
    for (const t of ["Tá bom.", "Ué, e agora?", "Sei lá o que fazer", "Ah, tá, certo, entendi", "", "[sai]", "*sorri*", "..."]) expect(isFillerText(t), t).toBe(false);
  });

  it("takes the explicit flag too, for a guard reaction that is not an interjection", () => {
    expect(isReaction(say("a", "Tudo bem, vamos embora agora mesmo.", 0, { filler: true }))).toBe(true);
    expect(isReaction(say("a", "Tudo bem, vamos embora agora mesmo."))).toBe(false);
    expect(isReaction({ speaker: "a", text: "Ué.", kind: "act" })).toBe(false);
  });

  it("leaves reactions out of length and counts their share", () => {
    const long = "Eu estava pensando muito seriamente no que você me disse ontem à noite na varanda sobre a viagem de barco.";
    const turns = [...Array.from({ length: 6 }, (_, i) => say(i % 2 ? "bia" : "ana", `${long} ${i}`)), ...Array.from({ length: 6 }, (_, i) => say(i % 2 ? "bia" : "ana", "Ué."))];
    const s = computeScriptStats(turns, { language: "pt" });
    expect(s.sayTurns).toBe(12);
    expect(s.contentTurns).toBe(6);
    expect(s.reactions).toBe(6);
    expect(s.reactionShare).toBe(0.5);
    expect(s.length.n).toBe(6);
    expect(s.length.median).toBeGreaterThan(15);
    expect(s.length.short).toBe(0);
  });

  it("does not let a reaction use up a slot of the novelty look-back", () => {
    const a = "A lanterna vermelha pendurada acima da escada velha balançava devagar durante toda a madrugada fria.";
    const turns = [say("ana", a), ...Array.from({ length: 7 }, (_, i) => say(i % 2 ? "ana" : "bia", "Hm.")), say("bia", "A lanterna vermelha pendurada acima da escada velha balançava devagar durante toda a madrugada fria demais.")];
    expect(computeScriptStats(turns, { language: "pt" }).novelty.mean).toBeLessThan(0.3);
  });

  it("never closes a question debt", () => {
    const base = [say("ana", "Cadê a chave, Bento?"), say("caio", "Não sei de nada."), say("caio", "Sei lá."), say("ana", "Fala.")];
    const closed = progressAndDebt([...base.slice(0, 1), say("bento", "Está comigo, Ana."), ...base.slice(1)], ["ana", "bento", "caio"]);
    expect(closed.debt.unanswered).toBe(0);
    const reacted = progressAndDebt([...base.slice(0, 1), say("bento", "Ué."), say("bento", "Hm."), say("bento", "Tá."), say("ana", "Fala.")], ["ana", "bento", "caio"]);
    expect(reacted.debt.questions).toBe(1);
    expect(reacted.debt.unanswered).toBe(1);
  });
});

describe("demand loops", () => {
  const demand = (t: number, extra: string) => say("renato", `Heloísa, cofre hoje ${extra}, senão eu conto tudo pra mesa.`, t);

  it("flags one actor making the same demand 3 times inside 90 s, in new words each time", () => {
    const turns = [
      say("heloisa", "O cofre abre amanhã, meu bem, ninguém põe preço em ninguém.", 0),
      say("renato", "Heloísa, cofre hoje, senão eu conto pra mesa quem segurou a caneta.", 10_000),
      say("otavio", "Rapaz, baixa o dedo e come alguma coisa.", 20_000),
      say("renato", "Ouve, Heloísa: cofre ou eu abro a boca, e não é amanhã, é agora.", 50_000),
      say("renato", "Último aviso, Heloísa, cofre hoje, dinheiro na minha mão, ou eu falo.", 85_000),
    ];
    const hits = findDemandLoops(turns.map(analyze), names);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.speaker).toBe("renato");
    expect(hits[0]!.turns).toEqual([1, 3, 4]);
    expect(computeScriptStats(turns, { language: "pt" }).demandTurns).toBeCloseTo(3 / 5);
  });

  it("does not flag the same demand spread over minutes, or made once by each of three actors", () => {
    const slow = [demand(0, "agora"), say("a", "Outra coisa completamente diferente aqui.", 30_000), demand(120_000, "mesmo"), say("a", "Falando de tempo e de chuva.", 150_000), demand(250_000, "já")];
    expect(findDemandLoops(slow.map(analyze), names)).toEqual([]);
    const three = [say("ana", "Cofre hoje, senão eu conto.", 0), say("bia", "Cofre hoje, senão eu conto.", 5_000), say("caio", "Cofre hoje, senão eu conto.", 10_000)];
    expect(findDemandLoops(three.map(analyze), names)).toEqual([]);
  });

  it("counts room turns when the turns have no times", () => {
    const turns = [demand(0, "agora"), say("a", "Falando de outra coisa."), demand(0, "já"), say("b", "Mais conversa solta."), demand(0, "mesmo")].map(({ atMs: _a, ...t }) => t as ScriptTurn);
    expect(findDemandLoops(turns.map(analyze), names)).toHaveLength(1);
  });
});

describe("tics", () => {
  const lines = (word: string, n: number): ScriptTurn[] =>
    Array.from({ length: n }, (_, i) => [say("otavio", `${SUBJECTS[i % 8]} ${VERBS[(i + 3) % 8]} ${THINGS[(i + 5) % 8]}, ${word}.`), say("bia", `${PLACES[i % 8]} ninguém soube de nada mesmo.`)]).flat();

  it("flags a word that one speaker puts in 5 of their turns within a scene window", () => {
    const hits = findTics(lines("rapaz", 6).map(analyze), names);
    expect(hits.map((h) => [h.speaker, h.word, h.turns.length])).toContainEqual(["otavio", "rapaz", 6]);
  });

  it("does not flag a word used by one speaker 4 times, a form of address, or a name", () => {
    expect(findTics(lines("rapaz", 4).map(analyze), names)).toEqual([]);
    expect(findTics(lines("senhor", 8).map(analyze), names).filter((h) => h.word === "senhor")).toEqual([]);
    expect(findTics(lines("Elvsted", 8).map(analyze), names).filter((h) => h.word === "elvsted")).toEqual([]);
    expect(findTics(lines("rapaz", 8).map(analyze), new Set(["rapaz"])).filter((h) => h.word === "rapaz")).toEqual([]);
  });

  it("is a share of the content turns in the run's stats", () => {
    const s = computeScriptStats(lines("rapaz", 6), { language: "pt" });
    expect(s.ticTurns).toBeGreaterThan(0.3);
    expect(computeScriptStats(chat(12), { language: "pt" }).ticTurns).toBe(0);
  });
});

describe("honest progress", () => {
  it("does not count a bare move as a major event, and counts a real act", () => {
    const run = (actKind?: "move" | "verb"): ScriptTurn[] => [say("ana", "Eu vi o barco na doca."), { speaker: "bia", text: "", kind: "act", ...(actKind ? { actKind } : {}), atMs: 5 }, say("bia", "O barco já saiu faz tempo.")];
    for (const kind of [undefined, "move"] as const) {
      const { progress } = progressAndDebt(run(kind), ["ana", "bia"]);
      expect(progress.events.map((e) => e.kind)).toContain("move");
      expect(progress.events.some((e) => e.kind === "act")).toBe(false);
      expect(progress.events.filter((e) => MAJOR_KINDS.has(e.kind)).every((e) => e.kind !== "move")).toBe(true);
      expect(progress.moves).toBe(1);
    }
    const verb = progressAndDebt(run("verb"), ["ana", "bia"]);
    expect(verb.progress.events.map((e) => e.kind)).toContain("act");
    expect(verb.progress.majorEvents).toBeGreaterThanOrEqual(1);
  });

  it("reads a stage direction with an act verb from a play as a real act, and a gesture of a hotel body as a move", () => {
    const beat = parseBeatText("ANA: Fica aqui.\n[Bento sai.]\nANA: Foi embora.");
    expect(beat.find((t) => t.kind === "act")?.actKind).toBe("verb");
    expect(progressAndDebt(beat, ["ana"]).progress.majorEvents).toBeGreaterThanOrEqual(1);
  });

  it("fails a 40-turn scene with no move of its own, even when the bodies keep moving, and passes one with an arc", () => {
    const flat = chat(40);
    const walking = flat.flatMap((t, i) => (i % 2 === 0 ? [t, { speaker: t.speaker, text: "", kind: "act" as const, atMs: t.atMs! + 1 }] : [t]));
    const sub = (turns: ScriptTurn[]): number => scoreTurns(turns, { norms: SCRIPT_NORMS, language: "pt" }).whole.sub.progress!.score;
    expect(sub(flat)).toBeLessThan(40);
    expect(sub(walking)).toBeLessThan(40);

    const arc = chat(40);
    arc[6] = say("ana", "Você mentiu pra mim, Bia, na frente de todo mundo.", 6 * 8_000);
    arc[15] = say("bia", "Na verdade, fui eu que escondi a chave naquela gaveta.", 15 * 8_000);
    arc[27] = say("caio", "Eu prometo que devolvo tudo amanhã de manhã.", 27 * 8_000);
    arc[30] = say("ana", "Cadê a chave, Bia?", 30 * 8_000);
    arc[31] = say("bia", "Está guardada no armário.", 31 * 8_000);
    arc[32] = say("bia", "E você, Ana, onde estava naquela noite?", 32 * 8_000);
    expect(sub(arc)).toBeGreaterThan(70);
  });
});

describe("whole-run scoring", () => {
  const wordy = (n: number): ScriptTurn[] =>
    Array.from({ length: n }, (_, i) =>
      say(["ana", "bia", "caio"][i % 3]!, `${SUBJECTS[(i * 3) % 8]} resolveu contar para todos na reunião de ontem que ${VERBS[(i * 5 + 1) % 8]} ${THINGS[(i * 7 + 2) % 8]} ${PLACES[(i * 11 + 3) % 8]} e que ninguém tinha percebido nada disso até agora, ${i}.`, i * 8_000),
    );

  it("scores a long run whole, next to scenes, and keeps the windows for diagnosis only", () => {
    const r = scoreTurns(wordy(41), { norms: SCRIPT_NORMS, language: "pt" });
    expect(r.whole.scale).toBe("scene");
    expect(r.score).toBe(r.whole.score);
    expect(r.windows.length).toBeGreaterThanOrEqual(3);
    expect(r.worst).toBe(Math.min(...r.windows.map((w) => w.score)));
    expect(r.score).toBeLessThan(60);
    expect(r.whole.sub.length!.score).toBeLessThan(40);
  });

  it("reads a run under 13 speech turns next to beats", () => {
    expect(scoreTurns(chat(12), { norms: SCRIPT_NORMS, language: "pt" }).whole.scale).toBe("beat");
    expect(scoreTurns(chat(13), { norms: SCRIPT_NORMS, language: "pt" }).whole.scale).toBe("scene");
  });

  it("reads turn length against the plays' turn-level figures, smoothly: up to 1.5 times the median, nothing from 3 times", () => {
    const withWords = (n: number): ScriptTurn[] => Array.from({ length: 20 }, (_, i) => say(i % 2 ? "bia" : "ana", `${Array.from({ length: n }, (_, k) => `pal${String.fromCharCode(97 + ((i + k) % 26))}${String.fromCharCode(97 + ((i * 7 + k * 3) % 26))}vra`).join(" ")}.`));
    const len = (n: number): number => scoreTurns(withWords(n), { norms: SCRIPT_NORMS, language: "pt" }).whole.sub.length!.score;
    // Uniform turns have no short replies at all (the plays have 4 in 10), which costs the same at 7 and at 10 words; the median and the tail are full marks.
    expect(len(10)).toBe(len(7));
    expect(len(7)).toBeGreaterThan(75);
    expect(len(14)).toBeLessThan(len(10));
    expect(len(14)).toBeGreaterThan(len(18));
    expect(len(25)).toBeLessThan(35);
  });

  it("fails a run of reactions whatever the rest says, and a run with half of its turns as reactions", () => {
    const real = chat(30);
    const withFillers = real.flatMap((t, i) => (i % 2 === 0 ? [t, say("bia", ["Ué.", "Hm.", "Tá.", "Ah."][i % 4]!, t.atMs! + 1)] : [t]));
    const r = scoreTurns(withFillers, { norms: SCRIPT_NORMS, language: "pt" });
    expect(r.stats.reactionShare).toBeGreaterThan(0.3);
    expect(r.whole.sub.reactions!.score).toBe(0);
    expect(r.score).toBeLessThan(40);
  });
});

describe("scenes of the corpus", () => {
  it("are consecutive beats of one scene, joined in index order", () => {
    const { beats } = inventedCorpus(12, 3);
    const scenes = joinScenes(beats);
    expect(scenes.length).toBe(4);
    for (const sc of scenes) {
      expect(sc.beats.map((b) => b.index)).toEqual([...sc.beats.map((b) => b.index!)].sort((a, b) => a - b));
      expect(sc.turns.length).toBe(sc.beats.reduce((a, b) => a + parseBeatText(b.text).length, 0));
    }
  });
});
