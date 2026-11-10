import { describe, expect, it } from "vitest";
import { MAX_SPEECH_CHARS, parsePlayText, romanToInt, splitSpeech, stripApparatus, stripGutenberg } from "../ingest/play-text.js";

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

  it("does not let an unclosed bracket swallow the speaker that follows", () => {
    const text = [
      "ACT I", "ANNA.", "Hello there.", "", "BORIS.", "No.", "", "ANNA.", "Well.", "",
      "     [She goes to the door and opens it.", "", "", "BORIS.", "", "[Aside.] What now?", "", "ANNA.", "Nothing.", "", "BORIS.", "Good.",
    ].join("\n");
    const items = parsePlayText(text, "t")[0]!.items;
    expect(items).toContainEqual({ kind: "direction", text: "She goes to the door and opens it." });
    expect(items).toContainEqual({ kind: "speech", speaker: "BORIS", text: "What now?" });
    expect(items.filter((i) => i.kind === "speech" && i.text.includes("["))).toEqual([]);
  });

  it("reads NAME (direction): cues, keeping the direction as its own item", () => {
    const text = ["ACT I", ...Array.from({ length: 4 }, () => ["CYRA:", "  Fine.", "", "BERT (smiling):", "  Good.", ""]).flat()].join("\n");
    const items = parsePlayText(text, "c")[0]!.items;
    expect(items.slice(0, 4)).toEqual([
      { kind: "speech", speaker: "CYRA", text: "Fine." },
      { kind: "direction", text: "smiling" },
      { kind: "speech", speaker: "BERT", text: "Good." },
      { kind: "speech", speaker: "CYRA", text: "Fine." },
    ]);
  });

  it("keeps a minor speaker that appears once, and reads a one-letter typo of a frequent name as that name", () => {
    const body = Array.from({ length: 4 }, () => ["ANNA.", "Yes.", "", "BORISLAV.", "No.", ""]).flat();
    const text = ["ACT I", ...body, "MESSENGER.", "News from the port.", "", "BORISLAU.", "What news?", "", "MRS. HARRIS went home.", "", "ANNA.", "Go."].join("\n");
    const speeches = parsePlayText(text, "t")[0]!.items.filter((i) => i.kind === "speech") as Array<{ speaker: string; text: string }>;
    expect(speeches.find((i) => i.text === "News from the port.")?.speaker).toBe("MESSENGER");
    const typo = speeches.find((i) => i.text.startsWith("What news?"));
    expect(typo?.speaker).toBe("BORISLAV");
    expect(typo?.text).toContain("MRS. HARRIS went home.");
    expect([...new Set(speeches.map((i) => i.speaker))].sort()).toEqual(["ANNA", "BORISLAV", "MESSENGER"]);
  });

  it("splits two speeches written on one line in the dash style, including an abbreviated title in the name", () => {
    const text = ["ATO I", ...Array.from({ length: 4 }, () => ["RITA - Come here.", "", "D. LUIZA - Never."]).flat(), "RITA - Why not? D. LUIZA - Because I said so."].join("\n");
    const last = parsePlayText(text, "d")[0]!.items.slice(-2);
    expect(last).toEqual([
      { kind: "speech", speaker: "RITA", text: "Why not?" },
      { kind: "speech", speaker: "D. LUIZA", text: "Because I said so." },
    ]);
  });

  it("ends a speech at a lone CURTAIN and drops what follows it", () => {
    const text = ["ACT I", ...Array.from({ length: 4 }, () => ["ANNA.", "Yes.", "", "BORIS.", "No.", ""]).flat(), "ANNA.", "The end of it.", "", "CURTAIN.", "", "This play was first produced in a theatre by a company.", "Cast notes follow."].join("\n");
    const items = parsePlayText(text, "t")[0]!.items;
    expect(items.at(-1)).toEqual({ kind: "speech", speaker: "ANNA", text: "The end of it." });
  });

  it("drops footnote blocks, a licence tail with no leading stars, and everything from a stopBefore pattern", () => {
    const foot = ["FOOTNOTES:", "", "[Footnote 1: old editions read 'his',", "and the second quarto differs.", "", "     a long quoted passage that is only apparatus.]"].join("\n");
    expect(stripApparatus(foot)).not.toMatch(/Footnote|apparatus|FOOTNOTES/);
    expect(stripGutenberg("play text\nEND OF THE PROJECT GUTENBERG EBOOK X\nlicence")).toBe("play text\n");
    expect(stripGutenberg("play text\nSTART: FULL LICENSE\nlicence")).toBe("play text\n");
    const body = Array.from({ length: 4 }, () => ["ANNA.", "Yes.", "", "BORIS.", "No.", ""]).flat();
    const text = ["ACT I", ...body, "ANNA.", "Last words.", "", "Afterword by the editor, who thinks highly of the piece."].join("\n");
    const items = parsePlayText(text, "t", { stopBefore: /^Afterword by the editor/ })[0]!.items;
    expect(items.at(-1)).toEqual({ kind: "speech", speaker: "ANNA", text: "Last words." });
    const kept = parsePlayText(text, "t")[0]!.items.at(-1);
    expect(kept).toMatchObject({ speaker: "ANNA", text: expect.stringContaining("Afterword") });
  });

  it("never emits a speech longer than the cap, splitting at sentence ends", () => {
    const sentence = "This is one sentence of moderate length that goes on a bit. ";
    const long = sentence.repeat(60).trim();
    const text = ["ACT I", ...Array.from({ length: 4 }, () => ["ANNA.", "Yes.", "", "BORIS.", "No.", ""]).flat(), "ANNA.", long, "", "BORIS.", "Enough."].join("\n");
    const speeches = parsePlayText(text, "t")[0]!.items.filter((i) => i.kind === "speech") as Array<{ speaker: string; text: string }>;
    expect(Math.max(...speeches.map((i) => i.text.length))).toBeLessThanOrEqual(MAX_SPEECH_CHARS);
    const pieces = speeches.filter((i) => i.text.startsWith("This is one sentence"));
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces.every((i) => i.speaker === "ANNA" && i.text.endsWith("."))).toBe(true);
    expect(pieces.map((i) => i.text).join(" ")).toBe(long);
  });
});

describe("splitSpeech", () => {
  it("leaves a short speech alone, cuts a long one at sentence ends, and cuts a sentence with no stops at a space", () => {
    expect(splitSpeech("Short one.", 50)).toEqual(["Short one."]);
    const parts = splitSpeech("Aaa bbb ccc. Ddd eee fff. Ggg hhh iii.", 20);
    expect(parts).toEqual(["Aaa bbb ccc.", "Ddd eee fff.", "Ggg hhh iii."]);
    const run = splitSpeech(Array.from({ length: 40 }, (_, i) => `word${i}`).join(" "), 60);
    expect(run.length).toBeGreaterThan(3);
    expect(run.every((p) => p.length <= 60)).toBe(true);
    expect(run.join(" ")).toBe(Array.from({ length: 40 }, (_, i) => `word${i}`).join(" "));
    expect(splitSpeech("x".repeat(130), 50).every((p) => p.length <= 50)).toBe(true);
  });
});
