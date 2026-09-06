/**
 * What a preset contains, read off the markdown itself.
 *
 * The picker needs names and roles before anything has been compiled, and the
 * frontmatter already carries both. Parsing three keys here beats a round trip
 * — and if a file is malformed the card simply shows less, which is the right
 * failure for a preview.
 */
import type { UploadedFile } from "@perfectman/shared";

export type PreviewCharacter = { id: string; name: string; archetype: string };

export function charactersIn(files: readonly UploadedFile[]): PreviewCharacter[] {
  return files
    .filter((file) => !/\.scenario\.md$/i.test(file.filename))
    .map((file) => {
      const front = frontmatter(file.text);
      const id = front["personaid"] ?? front["id"];
      if (!id) return null;
      return {
        id,
        name: front["displayname"] ?? front["name"] ?? id,
        archetype: front["archetype"] ?? "",
      };
    })
    .filter((character): character is PreviewCharacter => character !== null);
}

export function sceneTitleIn(files: readonly UploadedFile[]): string | undefined {
  const scenario = files.find((file) => /\.scenario\.md$/i.test(file.filename)) ?? files[0];
  return scenario ? frontmatter(scenario.text)["name"] : undefined;
}

/** Top-level scalar keys only. Nested blocks are not needed for a preview. */
function frontmatter(text: string): Record<string, string> {
  const block = text.split(/^---\s*$/m)[1];
  if (!block) return {};
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+)$/.exec(line);
    if (!match) continue;
    out[match[1]!.toLowerCase()] = match[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}
