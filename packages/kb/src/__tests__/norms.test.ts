import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SPINE_TACTICS, inventedCorpus } from "@perfectman/shared";
import type { ScriptNorms } from "@perfectman/shared";
import { exportNorms } from "../norms.js";
import { isTacticVerb } from "../taxonomy.js";

// The corpus is invented (shared's `inventedCorpus`): no third-party text is committed.
function setup(): { dir: string; beats: string; tags: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "pm-norms-"));
  const { beats, tags } = inventedCorpus(60);
  const beatsFile = path.join(dir, "beats.jsonl");
  const tagsFile = path.join(dir, "tags.jsonl");
  writeFileSync(beatsFile, `${beats.map((b) => JSON.stringify(b)).join("\n")}\n`);
  writeFileSync(tagsFile, `${tags.map((t) => JSON.stringify(t)).join("\n")}\n`);
  return { dir, beats: beatsFile, tags: tagsFile };
}

describe("export-norms", () => {
  it("writes the JSON and the typed module, numbers only, the same bytes on a second run", () => {
    const s = setup();
    const out = path.join(s.dir, "out");
    const a = exportNorms({ beatsFile: s.beats, tagsFile: s.tags, outDir: out, built: "2026-11-10", holdoutPerLanguage: 5 });
    const jsonA = readFileSync(a.files[0]!, "utf8");
    const tsA = readFileSync(a.files[1]!, "utf8");
    const b = exportNorms({ beatsFile: s.beats, tagsFile: s.tags, outDir: out, built: "2026-11-10", holdoutPerLanguage: 5 });
    expect(readFileSync(b.files[0]!, "utf8")).toBe(jsonA);
    expect(readFileSync(b.files[1]!, "utf8")).toBe(tsA);
    const norms = JSON.parse(jsonA) as ScriptNorms;
    expect(norms.built).toBe("2026-11-10");
    expect(norms.source).toMatchObject({ beats: 120, heldOut: 10 });
    expect(Object.keys(norms.languages).sort()).toEqual(["en", "pt"]);
    // Numbers, labels and the controlled tactic verbs; none of the invented lines.
    for (const word of ["ferryman", "lantern", "barqueiro", "lanterna", "MARGO"]) expect(jsonA).not.toContain(word);
    expect(tsA).toContain("export const SCRIPT_NORMS: ScriptNorms =");
  });

  it("stamps no date unless asked, and leaves the tactic block out without tags", () => {
    const s = setup();
    const r = exportNorms({ beatsFile: s.beats, outDir: path.join(s.dir, "out2"), holdoutPerLanguage: 5 });
    const norms = JSON.parse(r.json) as ScriptNorms;
    expect(norms.built).toBeUndefined();
    expect(norms.languages.en?.THEATRE?.tactic).toBeUndefined();
  });
});

describe("the scene spine's tactics", () => {
  it("are all verbs of the KB's controlled list", () => {
    for (const verbs of Object.values(SPINE_TACTICS)) for (const verb of verbs) expect(isTacticVerb(verb), verb).toBe(true);
  });
});
