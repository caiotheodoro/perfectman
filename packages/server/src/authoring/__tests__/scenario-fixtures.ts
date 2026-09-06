/**
 * Shared setup for the scenario-compiler tests, which are split across two
 * files to stay under the per-file `it` cap: the golden fixture and structural
 * errors in `scenario-md-compiler.test.ts`, the diagnostics that must not fail
 * silently in `scenario-md-diagnostics.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic } from "../diagnostics.js";

export const FIXTURE = readFileSync(join(__dirname, "fixtures/dinner.scenario.md"), "utf8");

export function messages(diagnostics: readonly Diagnostic[], level: Diagnostic["level"]): string {
  return diagnostics.filter((d) => d.level === level).map((d) => d.message).join(" | ");
}

/** A minimal scenario that compiles, for tests that vary one thing at a time. */
export function minimal(overrides: { frontmatter?: string; body?: string } = {}): string {
  const frontmatter =
    overrides.frontmatter ??
    `name: T
seed: 1
channels:
  - { id: geral, type: public_channel, name: geral, default: true, members: [a, b] }
cast:
  - { agentId: a, persona: a.md }
  - { agentId: b, persona: b.md }`;
  const body = overrides.body ?? "## Room Context\nA room.\n\n## Starting Mood\nquiet";
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}
