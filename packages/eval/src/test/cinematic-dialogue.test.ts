import { describe, expect, it } from "vitest";
import {
  fallbackNorms,
  isCutOff,
  loadRunBundle,
  replyAdherence,
  scoreDialogue,
  subtext,
} from "../cinematic/index.js";
import { CAST, flatScene, goodScene, writeRun, type FxSpec } from "./cinematic-fixtures.js";

const norms = fallbackNorms();
const load = (spec: FxSpec) => loadRunBundle(writeRun(spec));
const reading = (g: { readings: Array<{ metric: string; value: number | null; score: number | null }> }, m: string) => g.readings.find((r) => r.metric === m)!;

describe("dialogue", () => {
  it("recognises a cut-off line", () => {
    expect(isCutOff("Enough. Enough—")).toBe(true);
    expect(isCutOff("Enough -- ")).toBe(true);
    expect(isCutOff("Enough.")).toBe(false);
  });

  it("measures interruption from cut-off lines and from staged overlaps", () => {
    const lines = [
      { tS: 1, ref: "p1", text: "I only wanted to say that—" },
      { tS: 5, ref: "p2", text: "No. You will not say it here." },
      { tS: 9, ref: "p1", text: "Fine, then, fine." },
      { tS: 13, ref: "p2", text: "Good." },
    ];
    const calm = scoreDialogue(load({ durationS: 20, lines: lines.map((l) => ({ ...l, text: l.text.replace("—", ".") })) }), norms);
    const cut = scoreDialogue(load({ durationS: 20, lines }), norms);
    expect(reading(calm, "interruptionShare").value).toBe(0);
    expect(reading(cut, "interruptionShare").value).toBe(0.25);
    // staged: line 2 starts while line 1 (1000 ms to 5000 ms) is still going
    const overlap = scoreDialogue(load({ durationS: 20, lines, trackLines: [{ tMs: 1000, ms: 4000, ref: "p1" }, { tMs: 3000, ms: 3000, ref: "p2" }] }), norms);
    expect(reading(overlap, "interruptionShare").value).toBe(0.5);
  });

  it("calls a gap over 10 s dead air and a 2-10 s gap with business in it a pause beat", () => {
    const text = (i: number) => `Line number ${i} about the old house and the garden.`;
    const mk = (gapTs: number[], business: boolean): FxSpec => ({
      durationS: 120,
      lines: gapTs.map((tS, i) => ({ tS, ref: i % 2 ? "p2" : "p1", text: text(i) })),
      trackLines: gapTs.map((tS, i) => ({ tMs: tS * 1000, ms: 2000, ref: i % 2 ? "p2" : "p1" })),
      acts: business ? [{ tS: 8, verb: "glare", actor: "p1", target: "p2" }] : [],
    });
    // lines of 2 s at 0, 6, 12 -> gaps of 4 s; with a glare at 8 s inside one gap
    const quiet = scoreDialogue(load(mk([0, 6, 12], true)), norms);
    expect(reading(quiet, "deadAirShare").value).toBe(0);
    expect(reading(quiet, "pauseBeatsPerMin").value).toBeGreaterThan(0);
    const bare = scoreDialogue(load(mk([0, 6, 12], false)), norms);
    expect(reading(bare, "pauseBeatsPerMin").value).toBe(0);
    // 0, 40: a gap of 38 s -> 28 s beyond the limit of 120 s
    const dead = scoreDialogue(load(mk([0, 40], false)), norms);
    expect(reading(dead, "deadAirShare").value).toBeCloseTo(28 / 120, 3);
  });

  it("reply adherence: an answer shares a word with, or answers, the line before it; a non sequitur does not", () => {
    const on = [
      { speaker: "Ana", text: "Where did you hide the letter from the notary?" },
      { speaker: "Bruno", text: "The letter is in the desk drawer, under the ledger." },
      { speaker: "Ana", text: "The ledger is empty, Bruno, I looked this morning." },
    ].map((l, i) => ({ tS: i, ref: l.speaker, eventId: `e${i}`, ...l }));
    const off = [
      { speaker: "Ana", text: "Where did you hide the letter from the notary?" },
      { speaker: "Bruno", text: "Purple elephants dance beautifully above mountains." },
      { speaker: "Ana", text: "Sandwiches require toasted bread, obviously." },
    ].map((l, i) => ({ tS: i, ref: l.speaker, eventId: `e${i}`, ...l }));
    expect(replyAdherence(on).adherence).toBe(1);
    // the first off-topic answer still follows a question (counts), the second follows a statement and shares nothing
    expect(replyAdherence(off).adherence).toBe(0.5);
  });

  it("flags a reply that answers a line more than 3 lines back as stale", () => {
    const lines = Array.from({ length: 6 }, (_, i) => ({ tS: i, ref: i % 2 ? "p2" : "p1", speaker: i % 2 ? "Bruno" : "Ana", text: "A reasonable line about nothing in particular here.", eventId: `e${i}` }));
    const r = replyAdherence([...lines.slice(0, 5), { ...lines[5]!, replyToEventId: "e0" }]);
    expect(r.replyTargets).toBe(1);
    expect(r.staleCount).toBe(1);
  });

  it("subtext: a question met with a question, figures of speech and trailing off count; plain answers do not", () => {
    const plain = ["Where is the ledger?", "The ledger is on the table."].map((text, i) => ({ tS: i, ref: i ? "b" : "a", speaker: i ? "B" : "A", text }));
    const evasive = ["Where is the ledger?", "Why do you want to know, exactly..."].map((text, i) => ({ tS: i, ref: i ? "b" : "a", speaker: i ? "B" : "A", text }));
    expect(subtext(plain).parts["deflection"]).toBe(0);
    expect(subtext(evasive).parts["deflection"]).toBe(1);
    expect(subtext(evasive).parts["figurative"]).toBe(0.5);
    expect(subtext([]).value).toBeNull();
  });

  it("the good scene scores far above small talk, and script-likeness is one reading of the group", () => {
    const good = scoreDialogue(load(goodScene()), norms);
    const flat = scoreDialogue(load(flatScene()), norms);
    expect(good.score!).toBeGreaterThan(flat.score! + 25);
    expect(reading(good, "scriptLikeness").score!).toBeGreaterThan(reading(flat, "scriptLikeness").score!);
    expect(good.detail["scriptLikeness"]).toMatchObject({ lowN: false });
  });

  it("scores nothing spoken as a failure, not as missing", () => {
    const g = scoreDialogue(load({ durationS: 60, acts: [{ tS: 5, verb: "glare", actor: "p1", target: "p2" }] }), norms);
    expect(reading(g, "scriptLikeness")).toMatchObject({ value: null, score: 0 });
  });
});
