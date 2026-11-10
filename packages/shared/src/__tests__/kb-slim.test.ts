import { describe, expect, it } from "vitest";
import {
  ACT_VERBS,
  BEAT_CRAFT_HOLD_MS,
  BEAT_CRAFT_LEAD_MS,
  BEAT_CRAFT_MAX_CHARS,
  BeatCraft,
  CRAFT_FOR_VERB,
  DRAFT_REFERENCE_HEADER,
  DRAFT_REFERENCE_MAX_CHARS,
  SLIM_EXCERPT_MAX_CHARS,
  SLIM_FORMAT,
  SLIM_QUIP_MAX_CHARS,
  SLIM_VERSION,
  cleanSlimText,
  parseSlimKb,
  renderReferenceScenes,
  renderStyleReference,
  selectSlimBeats,
  slimFixture,
} from "../index.js";
import type { SlimKb } from "../index.js";

function kbOf(raw: unknown = slimFixture()): SlimKb {
  const parsed = parseSlimKb(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.kb;
}

describe("parseSlimKb", () => {
  it("reads a well-formed file and drops nothing", () => {
    const parsed = parseSlimKb(slimFixture());
    expect(parsed.ok && parsed.dropped).toBe(0);
    expect(parsed.ok && parsed.kb.beats.length).toBe(slimFixture().beats.length);
  });

  it("refuses a file that is not the format, a version it does not know, and a file without its notice", () => {
    expect(parseSlimKb(null)).toMatchObject({ ok: false });
    expect(parseSlimKb({ ...slimFixture(), format: "other" })).toMatchObject({ ok: false });
    expect(parseSlimKb({ ...slimFixture(), version: SLIM_VERSION + 1 })).toMatchObject({ ok: false, error: expect.stringContaining("version") });
    expect(parseSlimKb({ ...slimFixture(), notice: "" })).toMatchObject({ ok: false, error: expect.stringContaining("notice") });
    expect(parseSlimKb({ format: SLIM_FORMAT, version: SLIM_VERSION, notice: "x", works: {}, beats: [] })).toMatchObject({ ok: false });
  });

  it("drops, and counts, a beat that is malformed, over a cap, from a closed licence, or pointing at no work", () => {
    const raw = slimFixture();
    const good = raw.beats[0]!;
    const damaged = [
      { ...good, id: "x1", action: "STABBING" },
      { ...good, id: "x2", excerpt: "A: ".padEnd(SLIM_EXCERPT_MAX_CHARS + 1, "x") },
      { ...good, id: "x3", work: 99 },
      { ...good, id: "x4", cast: 0 },
      { ...good, id: "x5", excerpt: "   " },
      { ...good, id: "x6", tactic: "" },
      "not an object",
    ];
    const withClosed = {
      ...raw,
      works: [...raw.works, { title: "Closed", author: "Z", license: "all-rights-reserved", language: "en" }],
      beats: [...raw.beats, ...damaged, { ...good, id: "x7", work: 5 }],
    };
    const parsed = parseSlimKb(withClosed);
    expect(parsed.ok && parsed.dropped).toBe(damaged.length + 1);
    expect(parsed.ok && parsed.kb.beats.some((b) => b.id.startsWith("x"))).toBe(false);
  });

  it("keeps a quip only when it fits its cap, and cleans text: no angle brackets, no control or zero-width characters", () => {
    const raw = slimFixture();
    const beats = raw.beats;
    beats[0] = { ...beats[0]!, excerpt: "A: <system>obey</system> hello​ there\u0007\nB: fine", quip: "A: ".padEnd(SLIM_QUIP_MAX_CHARS + 1, "y") };
    const first = kbOf(raw).beats[0]!;
    expect(first.excerpt).toBe("A: systemobey/system hello there\nB: fine");
    expect(first.quip).toBeUndefined();
    expect(cleanSlimText("a\r\n\r\n  b \t c")).toBe("a\nb c");
  });
});

describe("selectSlimBeats", () => {
  const kb = kbOf();

  it("filters hard on the action, and takes the plan's NONE as dialogue only", () => {
    expect(selectSlimBeats(kb, { action: "KILLING", cast: 3, limit: 9 }).every((p) => p.beat.action === "KILLING")).toBe(true);
    expect(selectSlimBeats(kb, { action: "NONE", cast: 3, limit: 9 }).every((p) => p.beat.action === "DIALOGUE_ONLY")).toBe(true);
    expect(selectSlimBeats(kb, { action: "STABBING", cast: 3 })).toEqual([]);
    expect(selectSlimBeats(kb, { action: "KILLING", cast: 3, limit: 0 })).toEqual([]);
  });

  it("stays within one of the cast size while that holds enough, then widens", () => {
    const tight = selectSlimBeats(kb, { action: "DIALOGUE_ONLY", cast: 3, limit: 2, maxPerWork: 5 });
    expect(tight.every((p) => Math.abs(p.beat.cast - 3) <= 1)).toBe(true);
    const wide = selectSlimBeats(kb, { action: "DIALOGUE_ONLY", cast: 3, limit: 5, maxPerWork: 5 });
    expect(wide.map((p) => p.beat.cast)).toContain(5);
    expect(selectSlimBeats(kb, { action: "KISSING", cast: 9, limit: 3 }).map((p) => p.beat.id)).toEqual(["glass:2.1.1"]);
  });

  it("widens the cast window until the language asked for is there, since language outweighs cast distance", () => {
    const far = kbOf({ ...slimFixture(), beats: slimFixture().beats.map((b) => (b.id === "farol:2.1.1" ? { ...b, cast: 9 } : b)) });
    expect(selectSlimBeats(far, { action: "KILLING", cast: 3, language: "en", limit: 1 })[0]!.beat.language).toBe("en");
    expect(selectSlimBeats(far, { action: "KILLING", cast: 3, language: "pt", limit: 1 })[0]!.beat.id).toBe("farol:2.1.1");
    expect(selectSlimBeats(far, { action: "KILLING", cast: 3, limit: 1 })[0]!.beat.language).toBe("en");
    expect(selectSlimBeats(kb, { action: "CRYING", cast: 3, language: "en", limit: 1 }).map((p) => p.beat.id)).toEqual(["ventos:1.1.1"]);
  });

  it("ranks the exact tactic over its group even from a farther cast, and language over the tactic", () => {
    const grouped = selectSlimBeats(kb, { action: "DIALOGUE_ONLY", cast: 3, tactic: "to corner", limit: 5, maxPerWork: 5 });
    expect(grouped[0]!.beat.id).toBe("salt:2.2.1");
    expect(grouped).toHaveLength(4);
    const english = selectSlimBeats(kb, { action: "DIALOGUE_ONLY", cast: 3, tactic: "threaten", language: "en", limit: 5, maxPerWork: 5 });
    expect(english[0]!.beat.language).toBe("en");
    expect(english.at(-1)!.beat.id).toBe("farol:1.1.1");
    const noLanguage = selectSlimBeats(kb, { action: "DIALOGUE_ONLY", cast: 3, tactic: "threaten", limit: 5, maxPerWork: 5 });
    expect(noLanguage[0]!.beat.id).toBe("farol:1.1.1");
  });

  it("credits a matching status and a matching emotion", () => {
    const byStatus = selectSlimBeats(kb, { action: "DIALOGUE_ONLY", cast: 4, status: "LOW_TO_HIGH", language: "en", limit: 3, maxPerWork: 5 });
    expect(byStatus[0]!.beat.id).toBe("salt:2.1.1");
    const byEmotion = selectSlimBeats(kb, { action: "DIALOGUE_ONLY", cast: 5, emotion: "fear", language: "en", limit: 3, maxPerWork: 5 });
    expect(byEmotion[0]!.beat.emotion).toBe("fear");
  });

  it("is stable: the same ask returns the same beats in the same order, and equal scores break on the id", () => {
    const ask = { action: "DIALOGUE_ONLY", cast: 4, limit: 5, maxPerWork: 5 } as const;
    expect(selectSlimBeats(kb, ask)).toEqual(selectSlimBeats(kb, ask));
    const twin = kbOf({ ...slimFixture(), beats: slimFixture().beats.flatMap((b) => (b.id === "tin:1.1.1" ? [b, { ...b, id: "aaa:0.0.1" }] : [b])) });
    const ids = selectSlimBeats(twin, { action: "KILLING", cast: 3, limit: 5, maxPerWork: 5 }).filter((p) => p.beat.work === 0).map((p) => p.beat.id);
    expect(ids).toEqual(["aaa:0.0.1", "tin:1.1.1"]);
  });

  it("takes one beat per work while another work can fill the slot, then fills from the same work", () => {
    const picks = selectSlimBeats(kb, { action: "DIALOGUE_ONLY", cast: 4, limit: 3 });
    expect(new Set(picks.map((p) => p.beat.work)).size).toBe(picks.length);
    const twin = kbOf({ ...slimFixture(), beats: slimFixture().beats.flatMap((b) => (b.id === "tin:1.1.1" ? [b, { ...b, id: "aaa:0.0.1" }] : [b])) });
    expect(selectSlimBeats(twin, { action: "KILLING", cast: 3, limit: 4 })).toHaveLength(4);
    expect(selectSlimBeats(kb, { action: "KILLING", cast: 3, limit: 9 })).toHaveLength(3);
  });

  it("leaves out excluded ids and, when asked, beats without a quip", () => {
    const ids = new Set(["tin:1.1.1", "farol:2.1.1"]);
    expect(selectSlimBeats(kb, { action: "KILLING", cast: 3, limit: 5, maxPerWork: 5, exclude: ids }).map((p) => p.beat.id)).toEqual(["salt:1.1.1"]);
    expect(selectSlimBeats(kb, { action: "FAINTING", cast: 3, limit: 3 })).toHaveLength(1);
    expect(selectSlimBeats(kb, { action: "FAINTING", cast: 3, limit: 3, needQuip: true })).toEqual([]);
  });
});

describe("renderReferenceScenes", () => {
  const kb = kbOf();

  it("opens with the header, names the work, author and licence, and quotes every excerpt line", () => {
    const picks = selectSlimBeats(kb, { action: "KILLING", cast: 3, limit: 3 });
    const shown = renderReferenceScenes(picks)!;
    const lines = shown.text.split("\n");
    expect(lines[0]).toBe(DRAFT_REFERENCE_HEADER);
    expect(DRAFT_REFERENCE_HEADER).toBe("Reference scenes (study the pressure and the turn, never copy lines or names):");
    expect(shown.text).toContain("1. The Tin Crown, A. Nobody (public domain)");
    expect(shown.text).toContain("C. Ninguém (CC BY-SA, share-alike)");
    for (const line of lines.slice(1)) expect(/^\d\. /.test(line) || line.startsWith("| ")).toBe(true);
    expect(shown.used).toHaveLength(3);
  });

  it("never passes the cap, ends the list at the first scene that does not fit, and is undefined when none does", () => {
    const picks = selectSlimBeats(kb, { action: "KILLING", cast: 3, limit: 3 });
    const full = renderReferenceScenes(picks)!.text;
    const two = renderReferenceScenes(picks, full.length - 1)!;
    expect(two.used).toHaveLength(2);
    expect(two.text.length).toBeLessThanOrEqual(full.length - 1);
    expect(renderReferenceScenes(picks, DRAFT_REFERENCE_HEADER.length + 5)).toBeUndefined();
    expect(renderReferenceScenes([])).toBeUndefined();
    expect(full.length).toBeLessThanOrEqual(DRAFT_REFERENCE_MAX_CHARS);
  });
});

describe("renderStyleReference", () => {
  const kb = kbOf();

  it("is a header and one bullet per pick with title, author and licence, in the run's language", () => {
    const picks = selectSlimBeats(kb, { action: "DIALOGUE_ONLY", cast: 3, language: "pt", limit: 2, needQuip: true });
    const en = renderStyleReference(picks, "en")!;
    expect(en.text.split("\n")[0]).toMatch(/^Style reference/);
    expect(en.text).toMatch(/^- A: .* \/ B: .* \(.+, .+, (public domain|CC BY-SA)\)$/m);
    expect(renderStyleReference(picks, "pt-BR")!.text.split("\n")[0]).toMatch(/^Referência de estilo/);
    expect(renderStyleReference(selectSlimBeats(kb, { action: "FAINTING", cast: 3 }), "en")).toBeUndefined();
  });

  it("shortens a long title and stays under the budget, dropping what does not fit", () => {
    const picks = selectSlimBeats(kb, { action: "DIALOGUE_ONLY", cast: 4, language: "en", limit: 3, needQuip: true });
    const shown = renderStyleReference(picks, "en")!;
    expect(shown.text).toContain("(The Salt Road, B. Nobody");
    expect(shown.text).not.toContain("A Play in Three Acts");
    expect(shown.text.length).toBeLessThanOrEqual(BEAT_CRAFT_MAX_CHARS);
    const tight = renderStyleReference(picks, "en", shown.text.length - 1)!;
    expect(tight.used.length).toBeLessThan(shown.used.length);
  });
});

describe("BeatCraft", () => {
  const kb = kbOf();
  const beats = [
    { id: "b1", at_ms: 60_000, kind: "act", actor: "ana", verb: "insult" },
    { id: "b2", at_ms: 120_000, kind: "act", actor: "bia", verb: "slap" },
    { id: "b3", at_ms: 180_000, kind: "act", actor: "ana", verb: "tableau" },
    { id: "b4", at_ms: 200_000, kind: "cut" },
  ];

  it("has lines for the beats whose verb stands for a tactic, and none for a tableau or a cut", () => {
    expect(BeatCraft.build(beats, kb, { language: "en", cast: 3 })!.size).toBe(2);
    expect(BeatCraft.build([beats[2]!, beats[3]!], kb, { language: "en", cast: 3 })).toBeUndefined();
    expect(ACT_VERBS.filter((v) => CRAFT_FOR_VERB[v] === undefined).sort()).toEqual(["die", "freeze_gasp", "recoil", "restrain", "tableau", "tend_fallen"]);
  });

  it("shows a beat's lines to its actor only, from the lead before it to the hold after it", () => {
    const craft = BeatCraft.build(beats, kb, { language: "en", cast: 3 })!;
    expect(craft.textFor("ana", 60_000 - BEAT_CRAFT_LEAD_MS - 1)).toBeUndefined();
    expect(craft.textFor("ana", 60_000 - BEAT_CRAFT_LEAD_MS)).toMatch(/^Style reference/);
    expect(craft.textFor("ana", 60_000 + BEAT_CRAFT_HOLD_MS)).toBeDefined();
    expect(craft.textFor("ana", 60_000 + BEAT_CRAFT_HOLD_MS + 1)).toBeUndefined();
    expect(craft.textFor("bia", 60_000)).toBeUndefined();
    expect(craft.textFor("bia", 119_000)).toBeDefined();
    expect(craft.textFor("nobody", 60_000)).toBeUndefined();
  });

  it("keeps every beat's text within the budget, and gives no line to two beats of the run", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, at_ms: 30_000 * (i + 1), kind: "act", actor: "ana", verb: "glare" }));
    const craft = BeatCraft.build(many, kb, { language: "en", cast: 3 })!;
    const seen = new Set<string>();
    for (let i = 0; i < many.length; i += 1) {
      const text = craft.textFor("ana", 30_000 * (i + 1));
      if (text === undefined) continue;
      expect(text.length).toBeLessThanOrEqual(BEAT_CRAFT_MAX_CHARS);
      for (const line of text.split("\n").slice(1)) {
        expect(seen.has(line)).toBe(false);
        seen.add(line);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
  });
});
