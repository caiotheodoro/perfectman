/**
 * Hybrid prompt-section writer — encapsulates the "full hybrid, precision-first"
 * string manipulation so callers never hand-write structural markers.
 *
 * Every structural piece is a typed builder call:
 *   - headings render `## text`
 *   - bullets render `- item` lines
 *   - containers render `<name> … </name>` with an AUTO-CLOSED tag (the caller
 *     provides inner content via a nested builder, never the closing tag)
 *   - fences render ``` literal ``` blocks (content the model must not execute)
 *   - raw passes through untouched multi-line prose
 *
 * Using this instead of raw template strings keeps the prompt structure
 * declarative and prevents opener/closer drift (the exact failure the old
 * hand-written SECTION approach produced).
 */
export class PromptSection {
  private readonly blocks: string[] = [];

  heading(text: string, level = 2): this {
    this.blocks.push(`${"#".repeat(level)} ${text}`);
    return this;
  }

  paragraph(text: string): this {
    this.push(text);
    return this;
  }

  /**
   * Renders a compact list as one block: `Title:` then `- item` per element.
   * Pass no title for a bare bullet list. Items that are already multi-line are
   * emitted verbatim (no re-prefixing).
   */
  list(title: string | undefined, items: readonly string[]): this {
    const lines: string[] = [];
    if (title) lines.push(`${title}:`);
    for (const it of items) lines.push(/^- /.test(it) ? it : `- ${it}`);
    this.blocks.push(lines.join("\n"));
    return this;
  }

  fence(content: string, lang?: string): this {
    // literal content is preserved verbatim (indentation included)
    this.push("```" + (lang ?? "") + "\n" + content + "\n```");
    return this;
  }

  raw(content: string): this {
    this.push(content);
    return this;
  }

  /**
   * Opens `<name>`, renders the nested builder's content, then closes `</name>`.
   * The caller never writes the closing tag.
   */
  container(name: string, inner: (s: PromptSection) => void): this {
    const nested = new PromptSection();
    inner(nested);
    this.blocks.push(`<${name}>`, nested.toString("\n\n"), `</${name}>`);
    return this;
  }

  private push(...lines: string[]): void {
    for (const line of lines) {
      if (line !== undefined && line.trim().length > 0) this.blocks.push(line);
    }
  }

  toString(separator = "\n\n"): string {
    return this.blocks.join(separator);
  }
}
