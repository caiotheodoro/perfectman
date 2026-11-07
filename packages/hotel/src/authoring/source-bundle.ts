import type { UploadedFile } from "@perfectman/server/hotel";

/**
 * The hotel's scenario `source` is one string (`scenario_versions.source`),
 * the markdown compiler wants a scene plus persona files. A bundle joins them:
 *
 *   === file: my-scene.scenario.md ===
 *   ...markdown...
 *   === file: person-1.persona.md ===
 *   ...markdown...
 *
 * A string with no marker is a lone scenario file.
 */
const MARKER = /^=== file: (.+?) ===[ \t]*$/;

export type SourceBundle = { scenario: UploadedFile | undefined; personas: UploadedFile[] };

export function parseBundle(source: string): SourceBundle {
  const files: UploadedFile[] = [];
  let current: { filename: string; lines: string[] } | undefined;
  for (const line of source.split(/\r?\n/)) {
    const m = MARKER.exec(line);
    if (m?.[1]) {
      if (current) files.push({ filename: current.filename, text: current.lines.join("\n") });
      current = { filename: m[1].trim(), lines: [] };
    } else current?.lines.push(line);
  }
  if (current) files.push({ filename: current.filename, text: current.lines.join("\n") });
  if (files.length === 0) return { scenario: { filename: "scenario.md", text: source }, personas: [] };
  const scenario = files.find((f) => /scenario/i.test(f.filename)) ?? files[0];
  return { scenario, personas: files.filter((f) => f !== scenario) };
}

export function makeBundle(files: readonly UploadedFile[]): string {
  return files.map((f) => `=== file: ${f.filename} ===\n${f.text.replace(/\n+$/, "")}\n`).join("");
}
