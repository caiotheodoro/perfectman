import { describe, expect, it } from "vitest";
import { parsePlayText, romanToInt, stripGutenberg } from "../ingest/play-text.js";

const speakers = (s: ReturnType<typeof parsePlayText>) => [...new Set(s.flatMap((x) => x.items.flatMap((i) => (i.kind === "speech" ? [i.speaker] : []))))];

describe("parsePlayText", () => {
  it("reads a name on its own line, with a table of contents that repeats the act headings", () => {
    const text = [
      "CONTENTS", "ACT I.", "ACT II.", "", "",
      "ACT I", "", "ANNA.", "Where were you last night?", "", "BORIS.", "[Turning away.] Out.", "", "ANNA.", "Out where?", "", "BORIS.", "Nowhere.",
      "", "ACT II", "", "ANNA.", "I know.", "", "BORIS.", "Know what?", "", "ANNA.", "All of it.",
    ].join("\n");
    const scenes = parsePlayText(text, "t");
    expect(scenes.map((s) => [s.act, s.scene])).toEqual([["1", "1"], ["2", "1"]]);
    expect(speakers(scenes)).toEqual(["ANNA", "BORIS"]);
    const dirs = scenes[0]!.items.filter((i) => i.kind === "direction");
    expect(dirs).toEqual([{ kind: "direction", text: "Turning away." }]);
  });

  it("reads speaker and speech on the same line, scenes with roman numerals, and Enter/Exeunt lines", () => {
    const text = [
      "ACT I", "SCENE I. A street.", "",
      "Enter ROMA and LUCIO.", "ROMA. You dare?", "LUCIO. I dare.", "ROMA. Then draw.", "LUCIO. Gladly.", "Exeunt.",
      "SCENE II. A hall.", "Enter ROMA.", "ROMA. Alone.", "LUCIO. Not quite.", "ROMA. Who?", "LUCIO. Me.",
    ].join("\n");
    const scenes = parsePlayText(text, "t");
    expect(scenes.map((s) => [s.act, s.scene])).toEqual([["1", "1"], ["1", "2"]]);
    expect(scenes[0]!.items[0]).toEqual({ kind: "direction", text: "Enter ROMA and LUCIO." });
    expect(scenes[0]!.items.at(-1)).toEqual({ kind: "direction", text: "Exeunt." });
  });

  it("detects the colon, bare-name, mixed-case and dash styles by frequency", () => {
    const colon = ["ACT I", ...Array.from({ length: 4 }, () => ["CYRANO:", "  Fine.", "", "LE BRET:", "  Good.", ""]).flat()].join("\n");
    expect(speakers(parsePlayText(colon, "c"))).toEqual(["CYRANO", "LE BRET"]);

    const bare = Array.from({ length: 4 }, () => ["  TARTUFFE", "  Speak softly.", "", "  DORINE", "  I will not.", ""]).flat().join("\n");
    expect(speakers(parsePlayText(bare, "b"))).toEqual(["TARTUFFE", "DORINE"]);

    const mixed = Array.from({ length: 4 }, () => ["Boy. Help me.", "Titus. What now?"]).flat().join("\n");
    expect(speakers(parsePlayText(mixed, "m"))).toEqual(["Boy", "Titus"]);

    const dash = Array.from({ length: 4 }, () => ["RITA – Come here.", "", "LUÍS, rindo – Never."]).flat().join("\n");
    const d = parsePlayText(dash, "d");
    expect(speakers(d)).toEqual(["RITA", "LUÍS"]);
  });

  it("extracts parenthetical directions in the dash style and drops footnote marks", () => {
    const text = Array.from({ length: 4 }, () => ["RITA – Come here (she waves). Now [12].", "", "LUÍS – No."]).flat().join("\n");
    const items = parsePlayText(text, "d")[0]!.items;
    expect(items.some((i) => i.kind === "direction" && i.text === "she waves")).toBe(true);
    expect(JSON.stringify(items)).not.toContain("[12]");
  });

  it("drops italic underscores and the Gutenberg header and footer", () => {
    const raw = ["junk", "*** START OF THE PROJECT GUTENBERG EBOOK X ***", "ACT I", "ANNA.", "Hello.", "", "BORIS.", "[_Exit._]", "", "ANNA.", "Hm.", "", "BORIS.", "Yes.", "", "ANNA.", "So.", "", "BORIS.", "So.", "*** END OF THE PROJECT GUTENBERG EBOOK X ***", "licence text"].join("\n");
    expect(stripGutenberg(raw)).not.toContain("licence text");
    expect(stripGutenberg(raw)).not.toContain("junk");
    const items = parsePlayText(raw, "g")[0]!.items;
    expect(items).toContainEqual({ kind: "direction", text: "Exit." });
  });

  it("converts roman numerals", () => {
    expect([romanToInt("I"), romanToInt("IV"), romanToInt("IX"), romanToInt("XIV")]).toEqual([1, 4, 9, 14]);
  });
});
