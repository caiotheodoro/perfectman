import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANSWER_WINDOW,
  BEAT_METRICS,
  BUCKETS,
  LADDER_PCTS,
  MIN_SAY_TURNS,
  SCRIPT_NORMS,
  analyze,
  answersFirst,
  bucketOf,
  buildScriptNorms,
  computeScriptStats,
  contentKeys,
  detectLang,
  formatNormsJson,
  formatNormsTs,
  heldOutIds,
  inventedCorpus,
  ladderOf,
  ladderValue,
  lengthStats,
  lengthTargetFor,
  lowNovelty,
  metricScore,
  motifRepeat,
  nameKeysOf,
  noveltyFloor,
  normsFor,
  owedQuestion,
  parseBeatText,
  percentileIn,
  progressAndDebt,
  scoreTurns,
  stemOf,
  trimExample,
  trimToCap,
  turnsFromBodyFrames,
  turnsFromEvents,
  windowsOf,
  withoutQuestions,
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
      { speaker: "ana", text: "", kind: "act" },
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
      { speaker: "caio", text: "", kind: "act", atMs: 12 },
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

  it("cuts a long run into windows of 10 speech turns and folds a short remainder into the last window", () => {
    const turns = Array.from({ length: 23 }, (_, i) => say("a", `linha ${i}`));
    expect(windowsOf(turns).map((w) => w.length)).toEqual([10, 13]);
    expect(windowsOf(Array.from({ length: 24 }, (_, i) => say("a", `linha ${i}`))).map((w) => w.length)).toEqual([10, 10, 4]);
  });
});

describe("ladders", () => {
  it("reads back values and percentiles", () => {
    const ladder = ladderOf(Array.from({ length: 1000 }, (_, i) => i));
    expect(ladder).toHaveLength(LADDER_PCTS.length);
    expect(ladderValue(ladder, 50)).toBe(500);
    expect(percentileIn(ladder, 500)).toBeCloseTo(50, 0);
    expect(percentileIn(ladder, -1)).toBe(0);
    expect(percentileIn(ladder, 5000)).toBe(100);
  });

  it("scores 100 inside the real range, 0 past its far end and a line between", () => {
    const ladder = ladderOf(Array.from({ length: 1000 }, (_, i) => i));
    expect(metricScore(100, ladder, "high", 90, 100).score).toBe(100);
    expect(metricScore(999, ladder, "high", 90, 100).score).toBeLessThan(2);
    expect(metricScore(950, ladder, "high", 90, 100).score).toBeGreaterThan(40);
    expect(metricScore(900, ladder, "low", 90, 100).score).toBe(100);
    expect(metricScore(0, ladder, "low", 90, 100).score).toBe(0);
  });
});

describe("norms builder on an invented corpus", () => {
  const { beats, tags } = inventedCorpus(60);
  const norms = buildScriptNorms(beats, tags, { built: "2026-01-01", holdoutPerLanguage: 5 });

  it("is deterministic and never reads the clock", () => {
    expect(formatNormsJson(buildScriptNorms(beats, tags, { built: "2026-01-01", holdoutPerLanguage: 5 }))).toBe(formatNormsJson(norms));
    expect(buildScriptNorms(beats, tags, { holdoutPerLanguage: 5 }).built).toBeUndefined();
  });

  it("keeps the held-out beats out and says how many", () => {
    const held = heldOutIds(beats, 5);
    expect(held.size).toBe(10);
    expect(norms.source.heldOut).toBe(10);
    expect(norms.source.eligible - norms.source.heldOut).toBe(Object.values(norms.source.byLanguage).reduce((a, b) => a + b, 0));
  });

  it("has a ladder for every metric in every bucket, for both languages, theatre only", () => {
    for (const lang of ["pt", "en"] as const) {
      const block = normsFor(norms, lang)!;
      expect(block.medium).toBe("THEATRE");
      expect(block.fallback).toBe(false);
      for (const bucket of BUCKETS) for (const m of BEAT_METRICS) expect(block.block.buckets[bucket].metrics[m]).toHaveLength(LADDER_PCTS.length);
      expect(block.block.tactic?.tagged).toBeGreaterThan(0);
    }
    expect(normsFor(norms, "pt", "CINEMA")?.fallback).toBe(true);
  });

  it("holds numbers only: no word of any beat is in the file", () => {
    const text = formatNormsJson(norms);
    for (const word of ["ferryman", "lantern", "barqueiro", "lanterna", "MARGO", "Amália"]) expect(text).not.toContain(word);
  });

  it("scores a beat of the corpus it was built from high, and a wall of long turns low", () => {
    const beat = beats.find((b) => b.language === "en" && parseBeatText(b.text).filter((t) => t.kind === "say").length >= MIN_SAY_TURNS)!;
    const real = scoreTurns(parseBeatText(beat.text), { norms, language: "en", names: beat.speakers ?? [] });
    expect(real.score).toBeGreaterThanOrEqual(70);
    const long = "Eu estava pensando muito seriamente no que você me disse ontem à noite na varanda e não consigo parar de repetir cada palavra na minha cabeça porque nada daquilo fez sentido para mim até agora.";
    const wall = Array.from({ length: 8 }, (_, i) => say(i % 2 ? "bia" : "ana", `${long} ${i}`));
    expect(scoreTurns(wall, { norms, language: "pt" }).score).toBeLessThan(40);
  });
});

describe("the committed norms", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const file = path.join(dir, "..", "script-likeness", "script-norms.json");

  it("are the same numbers in the JSON and in the generated module", () => {
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(SCRIPT_NORMS);
    expect(readFileSync(file, "utf8")).toBe(formatNormsJson(SCRIPT_NORMS));
    expect(readFileSync(path.join(dir, "..", "script-likeness", "script-norms.generated.ts"), "utf8")).toBe(formatNormsTs(SCRIPT_NORMS));
  });

  it("carry the plays' turn-length numbers the brief quotes, and no text", () => {
    const pt = normsFor(SCRIPT_NORMS, "pt")!.block;
    const en = normsFor(SCRIPT_NORMS, "en")!.block;
    expect(ladderValue(pt.words.ladder, 50)).toBe(7);
    expect(ladderValue(pt.words.ladder, 90)).toBe(30);
    expect(pt.words.over25).toBeCloseTo(0.126, 2);
    expect(pt.novelty.mean).toBeCloseTo(0.88, 2);
    expect(pt.turnsPerBeat).toBeCloseTo(8.8, 1);
    expect(ladderValue(en.words.ladder, 50)).toBe(10);
    expect(en.novelty.mean).toBeCloseTo(0.79, 2);
    expect(JSON.stringify(SCRIPT_NORMS)).not.toMatch(/[a-z]{4,} [a-z]{4,} [a-z]{4,}/);
  });

  it("put the short-turn caps between the plays' own percentiles", () => {
    for (const lang of ["pt", "en"] as const) {
      const ladder = normsFor(SCRIPT_NORMS, lang)!.block.words.ladder;
      const cap = lengthTargetFor("short", lang).cap;
      expect(cap).toBeGreaterThan(ladderValue(ladder, 75));
      expect(cap).toBeLessThan(ladderValue(ladder, 92));
    }
  });
});

describe("length target and trimming", () => {
  it("maps the persona's message length, short by default", () => {
    expect(lengthTargetFor(undefined, "pt")).toEqual({ aim: [6, 12], cap: 25, sentences: 2 });
    expect(lengthTargetFor("rapid_fire", "pt").cap).toBeLessThan(lengthTargetFor("short", "pt").cap);
    expect(lengthTargetFor("long", "pt").cap).toBeGreaterThan(lengthTargetFor("medium", "pt").cap);
  });

  it("keeps whole sentences under the cap, never more than two, and drops a trailing second question", () => {
    expect(trimToCap("Foi ele. Eu vi tudo. Ninguém acredita em mim.", 25, 2)).toBe("Foi ele. Eu vi tudo.");
    expect(trimToCap("Cadê o envelope? Você já viu um pato de perto?", 25, 2)).toBe("Cadê o envelope?");
    const long = "Você tá parado aí que nem lasanha de véspera. Pshiu. Você já viu um pato de perto, de perto mesmo? É isso. É sobre isso, respondi a pergunta que ninguém fez ainda e por isso mesmo.";
    const cut = trimToCap(long, 12, 2);
    expect(wordCount(cut)).toBeLessThanOrEqual(12);
    expect(cut).toMatch(/[.!?…]$/);
    expect(cut.startsWith("Você tá parado")).toBe(true);
  });

  it("cuts a single sentence over the cap at a clause break, or trails off with an ellipsis", () => {
    const run = "Ian, você tá parado aí que nem lasanha de véspera, parece firme mas por baixo tá tudo deslizando e ninguém percebe nada disso até cair no chão";
    expect(trimToCap(run, 12, 2)).toBe("Ian, você tá parado aí que nem lasanha de véspera.");
    const noBreak = "um dois três quatro cinco seis sete oito nove dez onze doze treze quatorze";
    expect(trimToCap(noBreak, 5, 2)).toBe("um dois três quatro cinco…");
  });

  it("returns a line already inside the cap unchanged", () => {
    expect(trimToCap("Tá. Vou lá.", 25, 2)).toBe("Tá. Vou lá.");
  });

  it("trims a model line to the target's upper aim", () => {
    const target = lengthTargetFor("short", "pt");
    const line = "Eu só quero o melhor pra você, meu bem. A família sempre vem em primeiro lugar, não é, querido?";
    expect(wordCount(trimExample(line, target))).toBeLessThanOrEqual(12);
    expect(trimExample("Tá bom.", target)).toBe("Tá bom.");
  });
});

describe("candidate checks", () => {
  const room = [
    { speaker: "Ana", text: "Você já viu um pato de perto?" },
    { speaker: "Bia", text: "Lasanha fechada não se abre assim, Ana." },
    { speaker: "Cai", text: "Pato de perto eu nunca vi, juro." },
    { speaker: "Ana", text: "Quanto custou aquele relógio do primo?" },
  ];
  const names = nameKeysOf(["Ana", "Bia", "Cai"]);

  it("flags a phrase that two of the last six turns already carry, and names it", () => {
    const hit = motifRepeat("Um pato de perto, Cai, é outra coisa.", room, names);
    expect(hit?.said).toBe("pato de perto");
    expect(motifRepeat("O relógio do primo parou ontem.", room, names)).toBeUndefined();
  });

  it("does not take a topic word, a name or a stock opening for a motif", () => {
    const talk = [
      { speaker: "Ana", text: "O envelope estava na mochila." },
      { speaker: "Bia", text: "Esse envelope não é meu, juro." },
      { speaker: "Cai", text: "Então me explica o envelope." },
    ];
    expect(motifRepeat("Eu nunca toquei no envelope, Ana.", talk, names)).toBeUndefined();
  });

  it("flags a turn below the novelty floor and leaves a short or fresh one alone", () => {
    const floor = noveltyFloor(SCRIPT_NORMS, "pt");
    expect(floor).toBeGreaterThan(0.5);
    expect(floor).toBeLessThan(0.9);
    const stale = lowNovelty("Lasanha fechada não se abre assim, relógio quanto custou.", room, floor);
    expect(stale?.novelty).toBeLessThan(floor);
    expect(lowNovelty("Sim, claro.", room, floor)).toBeUndefined();
    expect(lowNovelty("Ninguém levou o cofre emprestado ontem à noite.", room, floor)).toBeUndefined();
    expect(lowNovelty("Lasanha fechada não se abre assim, relógio quanto custou.", room.slice(0, 2), floor)).toBeUndefined();
  });

  it("finds a direct question that has waited two turns, and clears it when the addressee spoke", () => {
    const lines = [
      { speaker: "Ana", text: "Bento, cadê a chave?" },
      { speaker: "Bia", text: "Eu vi uma chave na mesa." },
      { speaker: "Cai", text: "Ninguém mexeu em nada." },
    ];
    const owed = owedQuestion(lines, (l) => l.speaker === "Bento", nameKeysOf(["Bento"]), undefined, 2);
    expect(owed?.text).toBe("Bento, cadê a chave?");
    expect(owedQuestion(lines.slice(0, 2), (l) => l.speaker === "Bento", nameKeysOf(["Bento"]), undefined, 2)).toBeUndefined();
    expect(owedQuestion([...lines, { speaker: "Bento", text: "Na gaveta." }], (l) => l.speaker === "Bento", nameKeysOf(["Bento"]), undefined, 2)).toBeUndefined();
    const aimed = owedQuestion([{ speaker: "Ana", text: "Cadê a chave?", aimedAt: ["bento"] }, ...lines.slice(1)], (l) => l.speaker === "Bento", new Set(), "Bento", 2);
    expect(aimed).toBeDefined();
  });

  it("wants the answer before the question", () => {
    expect(answersFirst("Na gaveta. E você, viu?")).toBe(true);
    expect(answersFirst("E você, onde estava?")).toBe(false);
    expect(withoutQuestions("Na gaveta. E você, viu?")).toBe("Na gaveta.");
    expect(withoutQuestions("E você, onde estava? Hein?")).toBe("");
  });

  it("buckets by speech turns", () => {
    expect([3, 4, 7, 8, 12, 13].map(bucketOf)).toEqual(["4-7", "4-7", "4-7", "8-12", "8-12", "13+"]);
  });
});
