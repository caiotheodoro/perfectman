import { describe, expect, it } from "vitest";
import {
  ANSWER_WINDOW,
  analyze,
  computeScriptStats,
  contentKeys,
  detectLang,
  lengthStats,
  parseBeatText,
  progressAndDebt,
  stemOf,
  turnsFromBodyFrames,
  turnsFromEvents,
  windowsOf,
  wordCount,
  wordsOf,
  fold,
  findMotifs,
} from "../index.js";
import type { ScriptTurn } from "../index.js";

const say = (speaker: string, text: string, atMs?: number): ScriptTurn => ({ speaker, text, kind: "say", ...(atMs !== undefined ? { atMs } : {}) });

describe("text folding", () => {
  it("drops stage directions and laughter and folds accents, case and elongation", () => {
    expect(wordsOf("*sorri* Éééé, KKKKK você (rindo) viu [exits] o Pato?").map((w) => w.key)).toEqual(["e", "voce", "viu", "o", "pato"]);
    expect(fold("Nãããão")).toBe("nao");
    expect(wordCount("Sim, claro. KKKK [sai]")).toBe(2);
  });

  it("marks the first word of each sentence", () => {
    const w = wordsOf("Fala logo. Foi o Otávio?");
    expect(w.map((x) => x.start)).toEqual([true, false, true, false, false]);
  });

  it("stems inflections of one word together", () => {
    expect(stemOf("apostar")).toBe(stemOf("aposta"));
    expect(stemOf("apostei")).toBe(stemOf("aposto"));
    expect(stemOf("casa")).toBe("casa");
  });

  it("tells Portuguese from English", () => {
    expect(detectLang(["Você não vai embora, né?"])).toBe("pt");
    expect(detectLang(["You are not leaving with that."])).toBe("en");
  });

  it("counts words of 4 letters or more as the unit of novelty", () => {
    expect(contentKeys(wordsOf("Eu vi o pato de perto, mano"))).toEqual(["pato", "perto", "mano"]);
  });
});

describe("parseBeatText", () => {
  it("reads speeches, joins continuation lines and turns body directions into act turns", () => {
    const turns = parseBeatText("MARGO: You counted the coins.\nWREN: Put the lamp down.\n[WREN sits.]\n[aside, to the room]\nMARGO: Say it\nwas you.\n[a door slams]");
    expect(turns.map((t) => [t.kind, t.speaker, t.text])).toEqual([
      ["say", "MARGO", "You counted the coins."],
      ["say", "WREN", "Put the lamp down."],
      ["act", "", ""],
      ["say", "MARGO", "Say it was you."],
    ]);
  });
});

describe("length", () => {
  it("measures the shares the brief quotes", () => {
    const l = lengthStats([2, 3, 4, 30, 50, 7]);
    expect(l).toMatchObject({ n: 6, median: 7, over25: 2 / 6, over40: 1 / 6, short: 3 / 6 });
  });
});

describe("novelty", () => {
  it("is the share of a turn's long words that the previous turns did not have", () => {
    const stats = computeScriptStats(
      [say("a", "Quero saber onde esconderam aquele envelope"), say("b", "Esconderam aquele envelope debaixo da escada"), say("a", "Ninguém procurou lá embaixo")],
      { language: "pt" },
    );
    // Turn 2 repeats esconderam, aquele, envelope of 5 long words: 2 new (debaixo, escada); turn 3 has 3 long words, all new.
    expect(stats.novelty.values[0]).toBeCloseTo(2 / 5, 5);
    expect(stats.novelty.values[1]).toBe(1);
  });
});

describe("motifs", () => {
  const loop = [
    say("ana", "Você já viu um pato de perto?"),
    say("bia", "Lasanha fechada não se abre assim."),
    say("cai", "Pato de perto eu nunca vi, juro."),
    say("ana", "Todo mundo viu um pato de perto, menos você."),
  ];

  it("finds a phrase three turns share, whoever says it", () => {
    const hits = findMotifs(loop.map(analyze), new Set(["ana", "bia", "cai"]));
    const phrase = hits.find((h) => h.family === "phrase");
    expect(phrase?.key).toBe("p:pato de perto");
    expect(phrase?.cross).toBe(true);
    expect(phrase?.turns).toEqual([0, 2, 3]);
  });

  it("needs three turns and a window", () => {
    expect(findMotifs(loop.slice(0, 3).map(analyze), new Set()).filter((h) => h.family === "phrase")).toEqual([]);
    const spread = loop.map((t, i) => ({ ...t, atMs: i * 100_000 }));
    expect(findMotifs(spread.map(analyze), new Set()).filter((h) => h.family === "phrase")).toEqual([]);
    const close = loop.map((t, i) => ({ ...t, atMs: i * 20_000 }));
    expect(findMotifs(close.map(analyze), new Set()).some((h) => h.family === "phrase")).toBe(true);
  });

  it("counts a simile frame, and a filler 'tipo' does not count", () => {
    const frame = [say("a", "Ele ficou branco que nem papel."), say("b", "Parado que nem estátua, hein."), say("c", "Frio que nem pedra de rio.")];
    expect(findMotifs(frame.map(analyze), new Set()).map((h) => h.key)).toContain("f:que nem");
    const filler = [say("a", "Tipo assim, nada a ver."), say("b", "Tipo assim, né."), say("c", "Tipo assim, sei lá.")];
    expect(findMotifs(filler.map(analyze), new Set()).map((h) => h.key)).not.toContain("f:tipo");
  });
});

describe("progress and question debt", () => {
  it("counts new facts, promises, accusations, reveals, acts and a reversal of who asks", () => {
    const turns: ScriptTurn[] = [
      say("ana", "Cadê o envelope, Bento?"),
      say("bento", "Eu não sei de nenhum envelope."),
      say("bento", "Mas você sabe onde ele estava, Ana?"),
      say("ana", "Você mentiu pra mim. Foi você que pegou."),
      say("bento", "Na verdade, eu escondi na casa da Dona Neide por 300 reais."),
      { speaker: "ana", text: "", kind: "act", actKind: "verb" },
      say("ana", "Eu prometo que vou contar tudo pra ela."),
    ];
    const { progress } = progressAndDebt(turns, ["ana", "bento"]);
    const kinds = new Set(progress.events.map((e) => e.kind));
    for (const k of ["accusation", "reveal", "commitment", "act", "number", "entity", "reversal"] as const) expect(kinds.has(k), k).toBe(true);
    expect(progress.reversals).toBe(1);
  });

  it("leaves a question owing when its addressee deflects with another question", () => {
    const turns: ScriptTurn[] = [say("ana", "Cadê o envelope, Bento?"), say("bento", "E você, onde estava ontem?"), say("ana", "Em casa, dormindo."), say("bento", "E o envelope, você pegou?"), say("ana", "Fala logo.")];
    const { debt } = progressAndDebt(turns, ["ana", "bento"]);
    // Bento's own question to Ana is answered; Ana's question to Bento is not.
    expect(debt.questions).toBe(2);
    expect(debt.unanswered).toBe(1);
  });

  it("calls a question answered by a statement from its addressee", () => {
    const turns: ScriptTurn[] = [say("ana", "Cadê o envelope, Bento?"), say("bento", "Na gaveta."), say("ana", "Obrigada."), say("bento", "De nada."), say("ana", "Tchau.")];
    const { debt } = progressAndDebt(turns, ["ana", "bento"]);
    expect(debt.unanswered).toBe(0);
  });

  it("does not judge a question the scene ended on", () => {
    const turns: ScriptTurn[] = [say("a", "Oi."), say("b", "Oi."), say("a", "Cadê o Bento?")];
    expect(progressAndDebt(turns, ["a", "b"]).debt.questions).toBe(0);
    expect(ANSWER_WINDOW).toBe(3);
  });
});

describe("adapters", () => {
  it("reads speech and body events of a hotel run, leaving the host's notes out", () => {
    const turns = turnsFromEvents([
      { type: "message_sent", actorId: "ian", createdAt: 10, payload: { content: "Oi, gente.", senderName: "Ian" } },
      { type: "message_sent", actorId: "host", createdAt: 11, payload: { content: "steer" } },
      { type: "body_arrived", actorId: "caio", createdAt: 12 },
      { type: "no_op_recorded", actorId: "caio", createdAt: 13 },
    ]);
    expect(turns).toEqual([
      { speaker: "Ian", text: "Oi, gente.", kind: "say", atMs: 10 },
      { speaker: "caio", text: "", kind: "act", actKind: "move", atMs: 12 },
    ]);
  });

  it("turns posture changes and walks of a frame log into acts, a walk counted once", () => {
    const frames = [
      { atMs: 0, kind: "avatar_state", data: { agentId: "a", state: "stand" } },
      { atMs: 1000, kind: "moves", data: { agentId: "a" } },
      { atMs: 1500, kind: "moves", data: { agentId: "a" } },
      { atMs: 9000, kind: "avatar_state", data: { agentId: "a", state: "sit" } },
    ];
    expect(turnsFromBodyFrames(frames).map((t) => t.atMs)).toEqual([1000, 9000]);
  });

  it("cuts a long run into windows of 13 speech turns and folds a short remainder into the last window", () => {
    const turns = Array.from({ length: 23 }, (_, i) => say("a", `linha ${i}`));
    expect(windowsOf(turns).map((w) => w.length)).toEqual([13, 10]);
    expect(windowsOf(Array.from({ length: 30 }, (_, i) => say("a", `linha ${i}`))).map((w) => w.length)).toEqual([13, 13, 4]);
    expect(windowsOf(Array.from({ length: 15 }, (_, i) => say("a", `linha ${i}`))).map((w) => w.length)).toEqual([15]);
  });
});

