import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildScriptNorms, inventedCorpus } from "@perfectman/shared";
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
    expect(TURN_FIXTURES.map((f) => f.id)).toEqual(["run56", "run57", "run58"]);
  });

  it("score under 60 against the committed norms", () => {
    const rows = scoreFixtures();
    expect(rows.map((r) => r.id)).toEqual(["run56", "run57", "run58", "run58-summary"]);
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
  });

  it("counts what the novelty floor and the motif check would flag over speech turns", () => {
    const r = guardRatesOnCorpus(beats, "en", { norms, count: 20 });
    expect(r.beats).toBe(20);
    expect(r.turns).toBeGreaterThan(80);
    expect(r.either).toBeLessThanOrEqual(r.novelty + r.motif);
    expect(r.beatsFlagged).toBeLessThanOrEqual(r.beats);
  });
});
