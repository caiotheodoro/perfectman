import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BEAT_METRICS,
  BUCKETS,
  LADDER_PCTS,
  MIN_SAY_TURNS,
  SCRIPT_NORMS,
  answersFirst,
  bucketOf,
  buildScriptNorms,
  formatNormsJson,
  formatNormsTs,
  heldOutIds,
  inventedCorpus,
  ladderOf,
  ladderValue,
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
  scoreTurns,
  trimExample,
  trimToCap,
  withoutQuestions,
  wordCount,
} from "../index.js";
import type { ScriptTurn } from "../index.js";

const say = (speaker: string, text: string, atMs?: number): ScriptTurn => ({ speaker, text, kind: "say", ...(atMs !== undefined ? { atMs } : {}) });

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
    expect(lengthTargetFor(undefined, "pt")).toEqual({ aim: [5, 12], cap: 22, sentences: 2 });
    expect(lengthTargetFor("short", "en")).toEqual({ aim: [6, 14], cap: 28, sentences: 2 });
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
    expect(aimed?.asker).toBe("Ana");
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
