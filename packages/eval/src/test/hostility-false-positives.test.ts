/**
 * False positives of the hostility word list on ordinary talk (errata P8): the 128 ordinary pt-BR lines of the repetition guards' corpus (`NORMAL` in
 * `server/src/agent/__tests__/fixtures/ptbr-lines.ts`) and every line under `## Style Examples` of the persona packs shipped in `examples/presets/casts`. None of them is
 * hostile, so a line the list reads as an insult, a threat, blackmail or an accusation is a false positive. A bet ("aposto") and a laugh ("KKKK") are the older, weaker kinds;
 * they are read as what they are and listed, so a change to the list shows up here. The new kinds (blackmail, accusation) and reported speech must read none of it.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readHostility } from "@perfectman/hotel/drama";
import type { HostilityKind } from "@perfectman/hotel/drama";
import { describe, expect, it } from "vitest";
import { PRESETS_ROOT } from "../embodiment/drama-sim-preset.js";

const here = dirname(fileURLToPath(import.meta.url));

/** The `NORMAL` array of the guards' fixture, read as text so the eval package needs no import across the package boundary. */
function normalLines(): string[] {
  const src = readFileSync(join(here, "../../../server/src/agent/__tests__/fixtures/ptbr-lines.ts"), "utf8");
  const start = src.indexOf("export const NORMAL");
  const body = src.slice(start, src.indexOf("\n];", start));
  return body.split("\n").flatMap((l) => {
    const m = /^\s*("(?:[^"\\]|\\.)*"),?\s*$/.exec(l);
    return m ? [JSON.parse(m[1]!) as string] : [];
  });
}

/** Every bullet under `## Style Examples` of every persona pack of the presets' casts. */
function styleExamples(): Array<{ pack: string; line: string }> {
  const out: Array<{ pack: string; line: string }> = [];
  const casts = join(PRESETS_ROOT, "casts");
  for (const cast of readdirSync(casts)) {
    for (const file of readdirSync(join(casts, cast)).filter((f) => f.endsWith(".persona.md"))) {
      const text = readFileSync(join(casts, cast, file), "utf8");
      const at = text.indexOf("## Style Examples");
      if (at < 0) continue;
      const rest = text.slice(at + "## Style Examples".length);
      const end = rest.search(/\n## /);
      for (const l of (end < 0 ? rest : rest.slice(0, end)).split("\n")) {
        const m = /^\s*-\s+(.*\S)\s*$/.exec(l);
        if (m) out.push({ pack: `${cast}/${file.replace(".persona.md", "")}`, line: m[1]!.replace(/^["“](.*)["”]$/, "$1") });
      }
    }
  }
  return out;
}

const NEW_KINDS: ReadonlySet<HostilityKind> = new Set<HostilityKind>(["blackmail", "accusation"]);

describe("the hostility word list on ordinary talk", () => {
  it("reads the corpus it is meant to: 128 ordinary lines and the persona packs' style examples", () => {
    expect(normalLines()).toHaveLength(128);
    const packs = new Set(styleExamples().map((e) => e.pack));
    expect(packs.size).toBeGreaterThanOrEqual(5);
    expect(styleExamples().length).toBeGreaterThan(50);
  });

  it("128 ordinary pt-BR lines: no insult, threat, blackmail or accusation, and nothing reported; only the bets and laughs the older list always read", () => {
    const flagged = normalLines().flatMap((line) => {
      const r = readHostility(line);
      return r.own || r.reported ? [{ line, ...r }] : [];
    });
    const strong = flagged.filter((f) => f.own !== "challenge" && f.own !== "mockery");
    expect(strong, JSON.stringify(strong)).toEqual([]);
    expect(flagged.filter((f) => f.own !== undefined && NEW_KINDS.has(f.own))).toEqual([]);
    expect(flagged.filter((f) => f.reported !== undefined)).toEqual([]);
    // The remainder, pinned: the older kinds' own hits on this corpus (a laugh, a bet), 5 of 128 lines.
    expect(flagged.map((f) => [f.own, f.line.slice(0, 16)])).toEqual([
      ["mockery", "KKKKKKK não acre"],
      ["mockery", "HAHAHA você é te"],
      ["mockery", "KKKKKK essa foi "],
      ["challenge", "Aposto que você "],
      ["challenge", "Aposto vinte rea"],
    ]);
  });

  it("the persona packs' style examples: no threat, blackmail, accusation or reported speech; the older list reads two laughs and two affectionate English swears", () => {
    const flagged = styleExamples().flatMap(({ pack, line }) => {
      const r = readHostility(line);
      return r.own || r.reported ? [{ pack, line, ...r }] : [];
    });
    expect(flagged.filter((f) => f.own === "threat" || (f.own !== undefined && NEW_KINDS.has(f.own)) || f.reported !== undefined)).toEqual([]);
    // Pinned: "shut up" and "bastard" in the English friends' pack (the older insult list), two short laughs.
    expect(flagged.map((f) => [f.own, f.pack])).toEqual([
      ["mockery", "residencial-aurora/tavo"],
      ["mockery", "studio-partners/iris"],
      ["insult", "the-group/caio"],
      ["insult", "the-group/goulart"],
    ]);
  });

  it("false-positive rate on ordinary lines for the kinds P8 added (blackmail, accusation, reported speech): 0", () => {
    const lines = [...normalLines(), ...styleExamples().map((e) => e.line)];
    const hits = lines.filter((line) => {
      const r = readHostility(line);
      return (r.own !== undefined && NEW_KINDS.has(r.own)) || r.reported !== undefined;
    });
    expect({ lines: lines.length, hits }).toEqual({ lines: lines.length, hits: [] });
  });
});
