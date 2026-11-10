import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SCRIPT_NORMS, buildScriptNorms, computeScriptStats, inventedCorpus, isFillerText, isReaction } from "@perfectman/shared";
import {
  NOT_SCRIPT_LIKE_BELOW,
  SCRIPT_LIKE_AT,
  SUMMARY_FIXTURES,
  TURN_FIXTURES,
  guardRatesOnCorpus,
  loadTurns,
  scoreFixtures,
  scoreTranscript,
  validateOnCorpus,
  verdictOf,
} from "../script-likeness/index.js";

describe("the production-style fixtures", () => {
  it("each have a source and say what is partial, and hold no invented line", () => {
    for (const f of [...TURN_FIXTURES, ...SUMMARY_FIXTURES]) {
      expect(f.source.length).toBeGreaterThan(20);
      expect(f.notes.length).toBeGreaterThan(20);
    }
    expect(TURN_FIXTURES.map((f) => f.id)).toEqual(["run56", "run57", "run58", "run60-transcript"]);
    expect(SUMMARY_FIXTURES.map((f) => f.id)).toEqual(["run58-summary", "run60-summary"]);
  });

  it("score under 60 against the committed norms", () => {
    const rows = scoreFixtures();
    expect(rows.map((r) => r.id)).toEqual(["run56", "run57", "run58", "run60-transcript", "run58-summary", "run60-summary"]);
    for (const r of rows) {
      expect(r.score, r.id).toBeLessThan(NOT_SCRIPT_LIKE_BELOW);
      expect(r.verdict).toBe("not script-like");
    }
  });

  it("are read through the weakest part: run 57's question loop and run 56's repeats fail their own sub-scores", () => {
    const rows = Object.fromEntries(scoreFixtures().map((r) => [r.id, r]));
    expect(rows["run57"]!.sub["motif"]).toBeLessThan(10);
    expect(rows["run56"]!.sub["novelty"]).toBeLessThan(60);
    expect(rows["run58-summary"]!.sub["length"]).toBeLessThan(15);
  });

  it("run 60 fails on what the human saw: its fillers, its loops and its length, not on a quirk of one metric", () => {
    const f = TURN_FIXTURES.find((x) => x.id === "run60-transcript")!;
    const say = f.turns.filter((t) => t.kind !== "act");
    expect(say.every((t) => ["Heloísa", "Otávio", "Renato"].includes(t.speaker))).toBe(true);
    const flagged = say.filter((t) => t.filler === true);
    expect(flagged).toHaveLength(9);
    expect(flagged.every((t) => isFillerText(t.text))).toBe(true);
    expect(say.filter((t) => isReaction({ ...t, filler: false }))).toHaveLength(9);
    const r = scoreTranscript("run60", { turns: f.turns, names: [], source: "fixture" }, { language: "pt" });
    expect(r.score.whole.scale).toBe("scene");
    expect(r.score.stats.reactions).toBe(9);
    expect(r.score.sub["reactions"]).toBe(0);
    expect(r.score.sub["repeats"]).toBeLessThan(30);
    expect(r.score.sub["length"]).toBeLessThan(40);
    expect(r.score.stats.demandLoops.some((h) => h.speaker === "renato")).toBe(true);
    expect(r.score.stats.tics.some((h) => h.speaker === "otávio" && h.word === "rapaz")).toBe(true);
    expect(r.score.score).toBeLessThan(40);
    const withoutFlags = scoreTranscript("run60", { turns: f.turns.map(({ filler: _f, ...t }) => t), names: [], source: "fixture" }, { language: "pt" });
    expect(withoutFlags.score.score).toBe(r.score.score);
    expect(computeScriptStats(f.turns, { language: "pt" }).reactions).toBe(9);
  });

  it("run 60's summary scores low from its own numbers (median 19, 26% over 25 words, novelty 0.67, 10 reactions in 41)", () => {
    const row = scoreFixtures().find((x) => x.id === "run60-summary")!;
    expect(row.score).toBeLessThan(40);
    expect(row.sub["length"]).toBeLessThan(60);
    expect(row.sub["reactions"]).toBe(0);
  });
});

describe("verdicts", () => {
  it("name the three bands", () => {
    expect(verdictOf(SCRIPT_LIKE_AT)).toBe("script-like");
    expect(verdictOf(70)).toBe("borderline");
    expect(verdictOf(59.9)).toBe("not script-like");
  });
});

describe("loading a transcript", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "pm-script-"));

  it("reads a hotel run's events.jsonl, a run directory and a turns file the same way", () => {
    const events = [
      { type: "message_sent", actorId: "ian", createdAt: 1000, payload: { content: "Oi, gente, cheguei.", senderName: "Ian" } },
      { type: "reply_sent", actorId: "caio", createdAt: 5000, payload: { content: "Chegou tarde, como sempre.", senderName: "Caio" } },
      { type: "body_arrived", actorId: "duda", createdAt: 6000, payload: {} },
    ];
    const jsonl = path.join(dir, "events.jsonl");
    writeFileSync(jsonl, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
    const fromFile = loadTurns(jsonl);
    expect(fromFile.turns.map((t) => [t.speaker, t.kind])).toEqual([["Ian", "say"], ["Caio", "say"], ["duda", "act"]]);
    expect(loadTurns(dir).turns).toHaveLength(3);
    const turnsFile = path.join(dir, "turns.json");
    writeFileSync(turnsFile, JSON.stringify({ turns: [{ speaker: "a", text: "Oi.", atMs: 1 }, { speaker: "b", text: "", kind: "act" }, { nope: true }] }));
    expect(loadTurns(turnsFile).turns).toEqual([{ speaker: "a", text: "Oi.", atMs: 1 }, { speaker: "b", text: "", kind: "act" }]);
    expect(() => loadTurns(path.join(dir, "missing"))).toThrow(/no such file/);
  });

  it("reads a transcript export ({t, name, kind, text}), keeping only the actors asked for", () => {
    const rows = [
      { t: 1.5, name: "Ana", kind: "say", text: "Oi, gente, cheguei." },
      { t: 3, name: "Jogador", kind: "say", text: "Oi!" },
      { t: 4, name: "Bia", kind: "join", text: "" },
      { t: 6.25, name: "Bia", kind: "say", text: "Chegou tarde." },
    ];
    const file = path.join(dir, "transcript.jsonl");
    writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
    expect(loadTurns(file).turns.map((t) => t.speaker)).toEqual(["Ana", "Jogador", "Bia"]);
    const only = loadTurns(file, { actors: ["ana", "Bia"] });
    expect(only.turns).toEqual([
      { speaker: "Ana", text: "Oi, gente, cheguei.", kind: "say", atMs: 1500 },
      { speaker: "Bia", text: "Chegou tarde.", kind: "say", atMs: 6250 },
    ]);
    expect(only.source).toMatch(/^transcript /);
  });

  it("scores what it loaded, with the sub-scores and a percentile", () => {
    const loaded = loadTurns(path.join(dir, "turns.json"));
    const report = scoreTranscript("t", loaded, { language: "pt" });
    expect(report.score.lowN).toBe(true);
    expect(report.score.percentile).toBeGreaterThanOrEqual(0);
    expect(Object.keys(report.score.sub).length).toBeGreaterThan(0);
  });
});

describe("real beats (an invented corpus stands in: the real one is local)", () => {
  const { beats, tags } = inventedCorpus(60);
  const norms = buildScriptNorms(beats, tags, { built: "2026-01-01", holdoutPerLanguage: 5 });

  it("validates the held-out beats the norms were built without, deterministically", () => {
    const a = validateOnCorpus(beats, norms);
    const b = validateOnCorpus(beats, norms);
    expect(a).toEqual(b);
    expect(a.heldOut).toBe(10);
    expect(a.total.beats).toBe(10);
    expect(a.byLanguage["pt"]?.beats).toBe(5);
    expect(a.scenes.scenes).toBeGreaterThanOrEqual(0);
    expect(a.scenes.atLeast80).toBeLessThanOrEqual(a.scenes.scenes);
  });

  it("builds scene norms from joined beats, leaving out the scenes that hold a held-out beat", () => {
    const sceneBlock = norms.languages["en"]?.THEATRE?.scene;
    expect(sceneBlock).toBeDefined();
    expect(sceneBlock!.scenes).toBeGreaterThan(0);
    expect(sceneBlock!.turnsPerBeat).toBeGreaterThan(3);
    expect(sceneBlock!.beatsPerScene).toBeGreaterThan(1);
    expect(sceneBlock!.score).toHaveLength(15);
    // 12 beats of a scene join into 6; the invented scenes hold 6 beats each, so scenes with a held-out beat are left out.
    const none = buildScriptNorms(beats, tags, { built: "2026-01-01", holdoutPerLanguage: 0 }).languages["en"]!.THEATRE!.scene!;
    expect(none.scenes).toBeGreaterThanOrEqual(sceneBlock!.scenes);
  });

  it("the committed norms have a scene block for each language, from scenes of 13 turns or more", () => {
    for (const lang of ["pt", "en"] as const) {
      const sc = SCRIPT_NORMS.languages[lang]!.THEATRE!.scene!;
      expect(sc.scenes).toBeGreaterThan(100);
      expect(sc.buckets["30+"].beats).toBeGreaterThan(50);
      expect(sc.buckets["13-29"].beats + sc.buckets["30+"].beats).toBe(sc.scenes);
    }
  });

  it("counts what the novelty floor and the motif check would flag over speech turns", () => {
    const r = guardRatesOnCorpus(beats, "en", { norms, count: 20 });
    expect(r.beats).toBe(20);
    expect(r.turns).toBeGreaterThan(80);
    expect(r.either).toBeLessThanOrEqual(r.novelty + r.motif);
    expect(r.beatsFlagged).toBeLessThanOrEqual(r.beats);
  });
});
