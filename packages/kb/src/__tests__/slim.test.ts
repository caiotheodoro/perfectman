import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SLIM_ACTIONS, SLIM_EMOTIONS, SLIM_EXCERPT_MAX_CHARS, SLIM_FORMAT, SLIM_LANGUAGES, SLIM_LICENSES, SLIM_MEDIUMS, SLIM_QUIP_MAX_CHARS, SLIM_STATUSES, parseSlimKb, selectSlimBeats } from "@perfectman/shared";
import { ACTION_TYPES, EMOTIONS, MEDIUMS, STATUS_DELTAS, TACTIC_GROUP_OF } from "../taxonomy.js";
import { buildSlim } from "../slim/build.js";
import { SLIM_NOTICE } from "../slim/notice.js";
import { anonymise, parseBeatLines, pickWindow } from "../slim/window.js";
import type { Beat, TaggedBeat } from "../types.js";

// Every line below is invented for these tests. No third-party text is committed.
function beat(id: string, text: string, speakers: string[], over: Partial<TaggedBeat> = {}, tag: Partial<TaggedBeat["tag"]> = {}): TaggedBeat {
  const base: Beat = { id, sourceId: "s", title: "The Tin Crown", author: "A. Nobody", language: "en", medium: "THEATRE", act: "1", scene: "1", index: 1, speakers, castSize: 3, text, directions: [], actionHint: "DIALOGUE_ONLY", license_class: "public-domain-us" };
  return { ...base, ...over, tag: { id, tactic_verb: "to threaten", status_delta: "HIGH_TO_LOW", action_type: "DIALOGUE_ONLY", emotion: "anger", driver: speakers[0] ?? "", target: null, confidence: 0.8, boundary_ok: true, tagged_by: "t", ...tag } };
}

const TALK = "MARGO: You counted the coins twice and still came up short.\nWREN: Put the lamp down.\n[MARGO lifts the lamp.]\nMARGO: Say it was you.";

describe("the label lists the reader checks against are the taxonomy", () => {
  it("is the same list, in the same order, in shared and here", () => {
    expect([...SLIM_ACTIONS]).toEqual([...ACTION_TYPES]);
    expect([...SLIM_STATUSES]).toEqual([...STATUS_DELTAS]);
    expect([...SLIM_EMOTIONS]).toEqual([...EMOTIONS]);
    expect([...SLIM_MEDIUMS]).toEqual([...MEDIUMS]);
  });
});

describe("parseBeatLines and anonymise", () => {
  it("reads speeches, directions and continuation lines, and drops the stray dot after a cue", () => {
    const lines = parseBeatLines("MARGO: . Hello there.\n[a door opens]\nA second sentence of the same speech.\nWREN: Hm.", ["MARGO", "WREN"]);
    expect(lines).toEqual([
      { kind: "speech", cue: "MARGO", text: "Hello there." },
      { kind: "direction", text: "[a door opens] A second sentence of the same speech." },
      { kind: "speech", cue: "WREN", text: "Hm." },
    ]);
  });

  it("does not take a colon inside a sentence for a cue", () => {
    const lines = parseBeatLines("MARGO: He said it plainly: leave.\nWREN: No.", ["MARGO", "WREN"]);
    expect(lines.map((l) => l.kind)).toEqual(["speech", "speech"]);
    expect(lines[0]).toMatchObject({ text: "He said it plainly: leave." });
  });

  it("names speakers A, B, C by first speech, in the directions too, longest name first", () => {
    const lines = anonymise(parseBeatLines("MRS LINDE: Sit.\n[LINDE sits. Mrs Linde looks at HELMER.]\nHELMER: Well.", ["MRS LINDE", "HELMER"]));
    expect(lines.map((l) => (l.kind === "speech" ? `${l.letter}: ${l.text}` : l.text))).toEqual(["A: Sit.", "[A sits. A looks at B.]", "B: Well."]);
  });
});

describe("pickWindow", () => {
  const lines = anonymise(parseBeatLines(TALK, ["MARGO", "WREN"]));

  it("returns whole lines only and never passes the cap, whatever the cap is", () => {
    const rendered = ["A: You counted the coins twice and still came up short.", "B: Put the lamp down.", "[A lifts the lamp.]", "A: Say it was you."];
    for (let cap = 20; cap <= 200; cap += 7) {
      const out = pickWindow(lines, cap, { wantDirection: true, speechOnly: false });
      if (out === undefined) continue;
      expect(out.length).toBeLessThanOrEqual(cap);
      const picked = out.split("\n");
      const at = rendered.indexOf(picked[0]!);
      expect(at).toBeGreaterThanOrEqual(0);
      expect(picked).toEqual(rendered.slice(at, at + picked.length));
    }
  });

  it("prefers two voices, and the stage direction of a physical action when asked", () => {
    const withDirection = pickWindow(lines, 130, { wantDirection: true, speechOnly: false })!;
    expect(withDirection).toContain("[A lifts the lamp.]");
    expect(withDirection).toContain("B: Put the lamp down.");
    const speech = pickWindow(lines, 130, { wantDirection: false, speechOnly: true })!;
    expect(speech).not.toContain("[");
    expect(new Set(speech.split("\n").map((l) => l[0])).size).toBe(2);
  });

  it("is undefined when no run of whole lines holds a speech line within the cap, or the best is under the minimum", () => {
    expect(pickWindow(lines, 10, { wantDirection: false, speechOnly: false })).toBeUndefined();
    expect(pickWindow(lines, 200, { wantDirection: false, speechOnly: true, minChars: 500 })).toBeUndefined();
    expect(pickWindow([], 200, { wantDirection: false, speechOnly: false })).toBeUndefined();
  });
});

describe("buildSlim", () => {
  const beats: TaggedBeat[] = [
    beat("tin:1.1.1", TALK, ["MARGO", "WREN"], {}, { action_type: "KILLING" }),
    beat("tin:1.1.2", "MARGO: Sit.\nWREN: No.", ["MARGO", "WREN"]),
    beat("farol:1.1.1", "ANA: Sai da minha casa.\nBETO: Você não ousaria.", ["ANA", "BETO"], { title: "O Velho Farol", author: "C. Ninguém", language: "pt", license_class: "cc-by-sa" }),
    beat("closed:1.1.1", "ZED: Not ours.\nKIT: Nor ours.", ["ZED", "KIT"], { title: "Closed", license_class: "all-rights-reserved" }),
    beat("long:1.1.1", `ZED: ${"word ".repeat(120)}\nKIT: ${"more ".repeat(120)}`, ["ZED", "KIT"], { title: "Long Lines" }),
    beat("fr:1.1.1", "ZED: Bonjour.\nKIT: Salut.", ["ZED", "KIT"], { title: "Le Test", language: "fr" }),
  ];

  const built = buildSlim(beats, { built: "2026-01-01" });

  it("exports open text only, counts what it left out and why", () => {
    expect(built.stats).toMatchObject({ beats_in: 6, beats_out: 3, works: 2, left_out: { closed_license: 1, unknown_language: 1, no_window: 1 }, by_action: { KILLING: 1, DIALOGUE_ONLY: 2 }, by_language: { en: 2, pt: 1 } });
    expect(built.json).not.toContain("Not ours");
    expect(built.json).not.toContain("Closed");
  });

  it("reads back through the reader production uses, whole, and ranks", () => {
    const parsed = parseSlimKb(JSON.parse(built.json));
    expect(parsed.ok && parsed.dropped).toBe(0);
    if (!parsed.ok) return;
    expect(parsed.kb.beats.map((b) => b.id)).toEqual(["farol:1.1.1", "tin:1.1.1", "tin:1.1.2"]);
    for (const b of parsed.kb.beats) {
      expect(b.excerpt.length).toBeLessThanOrEqual(SLIM_EXCERPT_MAX_CHARS);
      if (b.quip !== undefined) {
        expect(b.quip.length).toBeLessThanOrEqual(SLIM_QUIP_MAX_CHARS);
        expect(b.quip).not.toContain("[");
      }
    }
    const kill = parsed.kb.beats.find((b) => b.id === "tin:1.1.1")!;
    expect(kill.excerpt).toContain("[A lifts the lamp.]");
    expect(kill.excerpt).not.toContain("MARGO");
    expect(kill.excerpt).not.toContain("WREN");
    expect(selectSlimBeats(parsed.kb, { action: "KILLING", cast: 3 }).map((p) => p.beat.id)).toEqual(["tin:1.1.1"]);
    expect(selectSlimBeats(parsed.kb, { action: "NONE", cast: 2, language: "pt", limit: 1 })[0]!.work.title).toBe("O Velho Farol");
  });

  it("is deterministic: the same index gives the same bytes, in whatever order the beats arrive", () => {
    expect(buildSlim([...beats].reverse(), { built: "2026-01-01" }).json).toBe(built.json);
    expect(buildSlim(beats, { built: "2026-01-01" }).json).toBe(built.json);
  });

  it("writes the header: format, notice, licences, the tactic groups, a sorted works table, and `built` only when given", () => {
    const raw = JSON.parse(built.json) as Record<string, unknown>;
    expect(raw["format"]).toBe(SLIM_FORMAT);
    expect(raw["notice"]).toBe(SLIM_NOTICE);
    expect(Object.keys(raw["licenses"] as object).sort()).toEqual([...SLIM_LICENSES].sort());
    expect(raw["groups"]).toMatchObject({ "to threaten": TACTIC_GROUP_OF["to threaten"] });
    expect((raw["works"] as Array<{ title: string; language: string }>).map((w) => w.title)).toEqual(["The Tin Crown", "O Velho Farol"]);
    expect(raw["built"]).toBe("2026-01-01");
    expect(JSON.parse(buildSlim(beats).json)).not.toHaveProperty("built");
    for (const w of raw["works"] as Array<{ language: string }>) expect((SLIM_LANGUAGES as readonly string[]).includes(w.language)).toBe(true);
  });

  it("puts one beat on each line, so a diff of two builds reads", () => {
    const lines = built.json.trimEnd().split("\n");
    expect(lines.length).toBe(1 + 3 + 1);
    expect(lines.slice(1, 4).every((l) => l.startsWith("{") && l.includes('"id":'))).toBe(true);
  });
});

describe("the notice", () => {
  it("is the same text in NOTICE.md next to the exporter and in the file it writes", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    expect(readFileSync(path.join(here, "..", "slim", "NOTICE.md"), "utf8")).toBe(SLIM_NOTICE);
  });

  it("names both licence classes and the share-alike rule", () => {
    expect(SLIM_NOTICE).toMatch(/public-domain-us/);
    expect(SLIM_NOTICE).toMatch(/cc-by-sa/);
    expect(SLIM_NOTICE).toMatch(/share-alike/);
    expect(SLIM_NOTICE).toMatch(/420 characters/);
  });
});
