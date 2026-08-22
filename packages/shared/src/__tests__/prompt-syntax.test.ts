import { describe, it, expect } from "vitest";
import { PromptSection } from "../prompt/prompt-syntax.js";

describe("PromptSection", () => {
  it("renders a heading as ## and closes a container automatically", () => {
    const out = new PromptSection()
      .container("events", (s) => s.heading("What you noticed"))
      .toString();
    expect(out).toContain("<events>");
    expect(out).toContain("</events>");
    expect(out).toContain("## What you noticed");
    // closing tag is emitted by the helper, never hand-written
    expect(out).toMatch(/<events>\s*\n\s*## What you noticed[\s\S]*<\/events>/);
  });

  it("renders titled and bare lists as - items", () => {
    const out = new PromptSection()
      .list("Urges", ["Urge: a", "Urge: b"])
      .list(undefined, ["x", "y"])
      .toString("\n");
    expect(out).toContain("Urges:\n- Urge: a\n- Urge: b");
    expect(out).toContain("- x\n- y");
  });

  it("renders fenced literal content", () => {
    const out = new PromptSection().fence('  - "hi"').toString();
    expect(out).toContain("```\n  - \"hi\"\n```");
  });

  it("nests containers with the closing tag after the inner block", () => {
    const out = new PromptSection()
      .container("outer", (s) => s.container("inner", (i) => i.paragraph("body")))
      .toString();
    expect(out).toMatch(/<outer>\s*\n\s*<inner>[\s\S]*body[\s\S]*<\/inner>[\s\S]*<\/outer>/);
  });

  it("skips blank lines/blocks", () => {
    const out = new PromptSection().raw("   ").raw("text").toString();
    expect(out).toBe("text");
  });
});
