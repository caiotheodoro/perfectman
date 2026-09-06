import { describe, expect, it } from "vitest";
import {
  MdParseError,
  findSection,
  parseMarkdown,
  sectionBullets,
  sectionText,
  splitKeyValue,
} from "../md/document.js";

describe("parseMarkdown — frontmatter", () => {
  it("reads a fenced YAML block and starts the body after it", () => {
    const doc = parseMarkdown(["---", "id: ana", "seed: 42", "---", "", "## Identity", "prose"].join("\n"));
    expect(doc.frontmatter).toEqual({ id: "ana", seed: 42 });
    expect(findSection(doc, "identity")?.body.join("\n").trim()).toBe("prose");
  });

  it("treats a document with no frontmatter as empty frontmatter, not an error", () => {
    const doc = parseMarkdown("## Identity\nprose");
    expect(doc.frontmatter).toEqual({});
    expect(doc.sections).toHaveLength(1);
  });

  it("treats an empty frontmatter block as empty, not as null", () => {
    const doc = parseMarkdown(["---", "---", "## Identity", "x"].join("\n"));
    expect(doc.frontmatter).toEqual({});
  });

  it("rejects an unclosed frontmatter fence", () => {
    expect(() => parseMarkdown(["---", "id: ana", "## Identity"].join("\n"))).toThrow(MdParseError);
  });

  it("rejects frontmatter that is not a key/value block", () => {
    expect(() => parseMarkdown(["---", "- just", "- a list", "---"].join("\n"))).toThrow(
      /must be a block of/,
    );
  });

  it("reports invalid YAML rather than silently dropping the block", () => {
    expect(() => parseMarkdown(["---", "id: [unclosed", "---"].join("\n"))).toThrow(/not valid YAML/);
  });
});

describe("parseMarkdown — sections", () => {
  it("splits ## sections and nests ### subsections", () => {
    const doc = parseMarkdown(
      ["## Agents", "", "### ana", "Starting mood: guarded", "", "### bruno", "Starting mood: buoyant"].join(
        "\n",
      ),
    );
    expect(doc.sections).toHaveLength(1);
    const agents = findSection(doc, "agents");
    expect(agents?.subsections.map((s) => s.key)).toEqual(["ana", "bruno"]);
    expect(sectionText(agents?.subsections[0])).toBe("Starting mood: guarded");
  });

  it("looks sections up case-insensitively but keeps the original heading for messages", () => {
    const doc = parseMarkdown("## Style Examples\n- hi");
    expect(findSection(doc, "style examples")?.heading).toBe("Style Examples");
  });

  it("records 1-based line numbers for headings", () => {
    const doc = parseMarkdown(["---", "id: ana", "---", "## Identity", "prose"].join("\n"));
    expect(findSection(doc, "identity")?.line).toBe(4);
  });

  it("rejects a ### that appears before any ## section", () => {
    expect(() => parseMarkdown("### orphan\nx")).toThrow(/appears before any/);
  });

  it("handles CRLF line endings", () => {
    const doc = parseMarkdown("---\r\nid: ana\r\n---\r\n## Identity\r\nprose\r\n");
    expect(doc.frontmatter).toEqual({ id: "ana" });
    expect(sectionText(findSection(doc, "identity"))).toBe("prose");
  });
});

describe("sectionBullets", () => {
  it("reads bullets with either marker and drops empties", () => {
    const doc = parseMarkdown("## Voice\n- one\n* two\n-\n");
    expect(sectionBullets(findSection(doc, "voice")).map((b) => b.text)).toEqual(["one", "two"]);
  });

  it("folds a continuation line into the bullet above it", () => {
    const doc = parseMarkdown(
      ["## Memories", "- [unresolved, tone=resentful]", "  He took credit for her work.", "", "- second"].join(
        "\n",
      ),
    );
    const bullets = sectionBullets(findSection(doc, "memories"));
    expect(bullets).toHaveLength(2);
    expect(bullets[0]?.text).toBe("[unresolved, tone=resentful] He took credit for her work.");
    expect(bullets[1]?.text).toBe("second");
  });

  it("stops folding at a blank line, so stray prose is not absorbed", () => {
    const doc = parseMarkdown(["## Voice", "- one", "", "loose prose"].join("\n"));
    expect(sectionBullets(findSection(doc, "voice")).map((b) => b.text)).toEqual(["one"]);
  });

  it("reports the bullet's own line number", () => {
    const doc = parseMarkdown(["## Voice", "- one", "- two"].join("\n"));
    expect(sectionBullets(findSection(doc, "voice")).map((b) => b.line)).toEqual([2, 3]);
  });

  it("returns nothing for a missing section", () => {
    expect(sectionBullets(undefined)).toEqual([]);
  });
});

describe("splitKeyValue", () => {
  it("splits on the first colon by default, leaving colons in the value", () => {
    expect(splitKeyValue("Hidden objective: keep it quiet (resource: the_invite)")).toEqual({
      key: "Hidden objective",
      value: "keep it quiet (resource: the_invite)",
    });
  });

  it("splits on the last colon for pair keys", () => {
    expect(splitKeyValue("ana:bruno: close_friends", "last")).toEqual({
      key: "ana:bruno",
      value: "close_friends",
    });
  });

  it("returns undefined when there is no separator or no key", () => {
    expect(splitKeyValue("no separator here")).toBeUndefined();
    expect(splitKeyValue(": orphan value")).toBeUndefined();
  });
});
