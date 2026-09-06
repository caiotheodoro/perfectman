/**
 * Minimal structured-markdown reader.
 *
 * Authoring markdown is not prose to be rendered — it is a config surface that
 * happens to be pleasant to write. So the reader is deliberately dumb: YAML
 * frontmatter, `##` sections, `###` subsections, and bullet lists. Anything
 * fancier (tables, nested lists, inline formatting) is not part of the format,
 * which keeps "did my markdown parse the way I meant" answerable by eye.
 *
 * Every accessor records a line number, because the whole point of the
 * compiled-config preview is to point at the line that produced a bad field.
 */
import { parse as parseYaml } from "yaml";

export type MdSection = {
  /** Heading text, lowercased and trimmed — sections are looked up case-insensitively. */
  key: string;
  /** Heading text exactly as written, for error messages. */
  heading: string;
  /** 1-based line of the heading itself. */
  line: number;
  /** Body lines between this heading and the next one at the same-or-higher level. */
  body: string[];
  /** 1-based line of the first body line. */
  bodyLine: number;
  /** `###` subsections nested under a `##` section. */
  subsections: MdSection[];
};

export type MdDocument = {
  frontmatter: Record<string, unknown>;
  /** 1-based line where the frontmatter block's first key sits, or 1 when absent. */
  frontmatterLine: number;
  sections: MdSection[];
};

export class MdParseError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message);
    this.name = "MdParseError";
  }
}

const FRONTMATTER_FENCE = /^---\s*$/;
const HEADING = /^(#{2,3})\s+(.+?)\s*$/;

/**
 * Splits leading `---` fenced YAML off the document.
 * A missing frontmatter block is not an error here — required-key checks belong
 * to the persona/scenario readers, which can say which key is missing and why.
 */
function splitFrontmatter(lines: string[]): {
  frontmatter: Record<string, unknown>;
  frontmatterLine: number;
  bodyStart: number;
} {
  if (lines.length === 0 || !FRONTMATTER_FENCE.test(lines[0] ?? "")) {
    return { frontmatter: {}, frontmatterLine: 1, bodyStart: 0 };
  }
  const close = lines.findIndex((line, i) => i > 0 && FRONTMATTER_FENCE.test(line));
  if (close === -1) {
    throw new MdParseError("Frontmatter opened with `---` but never closed.", 1);
  }
  const raw = lines.slice(1, close).join("\n");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new MdParseError(`Frontmatter is not valid YAML: ${message}`, 2);
  }
  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, frontmatterLine: 2, bodyStart: close + 1 };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new MdParseError("Frontmatter must be a block of `key: value` pairs.", 2);
  }
  return {
    frontmatter: parsed as Record<string, unknown>,
    frontmatterLine: 2,
    bodyStart: close + 1,
  };
}

export function parseMarkdown(text: string): MdDocument {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const { frontmatter, frontmatterLine, bodyStart } = splitFrontmatter(lines);

  const sections: MdSection[] = [];
  let current: MdSection | undefined;
  let currentSub: MdSection | undefined;

  for (let i = bodyStart; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const heading = HEADING.exec(line);
    if (!heading) {
      const target = currentSub ?? current;
      if (target) {
        if (target.body.length === 0) target.bodyLine = i + 1;
        target.body.push(line);
      }
      continue;
    }
    const level = (heading[1] ?? "").length;
    const headingText = heading[2] ?? "";
    const section: MdSection = {
      key: headingText.toLowerCase().trim(),
      heading: headingText,
      line: i + 1,
      body: [],
      bodyLine: i + 2,
      subsections: [],
    };
    if (level === 2) {
      sections.push(section);
      current = section;
      currentSub = undefined;
    } else {
      if (!current) {
        throw new MdParseError(`"### ${headingText}" appears before any "## " section.`, i + 1);
      }
      current.subsections.push(section);
      currentSub = section;
    }
  }

  return { frontmatter, frontmatterLine, sections };
}

export function findSection(doc: MdDocument, key: string): MdSection | undefined {
  return doc.sections.find((s) => s.key === key.toLowerCase());
}

/** Body with blank lines trimmed off both ends, joined back into prose. */
export function sectionText(section: MdSection | undefined): string {
  if (!section) return "";
  return section.body.join("\n").trim();
}

export type MdBullet = {
  text: string;
  /** 1-based line of the bullet's first line. */
  line: number;
};

/**
 * Bullets, with continuation lines folded in.
 *
 * A bullet runs until the next bullet or a blank line, so a memory can span
 * two lines (`- [unresolved, ...]` then the summary underneath) without the
 * author having to cram it onto one.
 */
export function sectionBullets(section: MdSection | undefined): MdBullet[] {
  if (!section) return [];
  const bullets: MdBullet[] = [];
  let open: MdBullet | undefined;
  section.body.forEach((raw, index) => {
    const line = section.bodyLine + index;
    // The marker may stand alone (`-`); such a bullet is empty and is filtered
    // out below, but it must still close the previous one rather than being
    // folded into it as a continuation line.
    const bullet = /^\s*[-*](?:\s+(.*))?$/.exec(raw);
    if (bullet) {
      open = { text: (bullet[1] ?? "").trim(), line };
      bullets.push(open);
      return;
    }
    if (raw.trim() === "") {
      open = undefined;
      return;
    }
    if (open) open.text = `${open.text} ${raw.trim()}`.trim();
  });
  return bullets.filter((b) => b.text.length > 0);
}

/**
 * Splits `key: value` where the value may itself contain colons
 * (`ana:bruno: close_friends`, `Hidden objective: keep it quiet (resource: x)`).
 * `which` picks the separating colon — the last one for pair keys, the first
 * for everything else.
 */
export function splitKeyValue(
  text: string,
  which: "first" | "last" = "first",
): { key: string; value: string } | undefined {
  const index = which === "first" ? text.indexOf(":") : text.lastIndexOf(":");
  if (index <= 0) return undefined;
  const key = text.slice(0, index).trim();
  const value = text.slice(index + 1).trim();
  if (key.length === 0) return undefined;
  return { key, value };
}
