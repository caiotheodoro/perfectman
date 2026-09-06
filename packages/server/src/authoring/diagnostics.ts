/**
 * Compilers collect diagnostics instead of throwing.
 *
 * The preview panel's job is to answer "did my markdown parse the way I meant"
 * before a run costs ten minutes of model time, and that only works if the
 * author sees *every* problem at once. A thrown error shows the first one.
 */

export type DiagnosticLevel = "error" | "warning" | "info";

export type Diagnostic = {
  level: DiagnosticLevel;
  /** Source file the problem came from, as uploaded. */
  file: string;
  /** 1-based line, when the problem can be traced to one. */
  line?: number;
  /** Dotted path of the field this affects, e.g. `cast[1].hiddenObjective`. */
  path?: string;
  message: string;
  /** What to do about it. Present whenever the fix is expressible in a sentence. */
  hint?: string;
};

export class DiagnosticBag {
  private readonly items: Diagnostic[] = [];

  constructor(private readonly file: string) {}

  error(message: string, extra: Omit<Diagnostic, "level" | "message" | "file"> = {}): void {
    this.items.push({ level: "error", file: this.file, message, ...extra });
  }

  warn(message: string, extra: Omit<Diagnostic, "level" | "message" | "file"> = {}): void {
    this.items.push({ level: "warning", file: this.file, message, ...extra });
  }

  info(message: string, extra: Omit<Diagnostic, "level" | "message" | "file"> = {}): void {
    this.items.push({ level: "info", file: this.file, message, ...extra });
  }

  /** Merge another file's diagnostics in, preserving their own `file`. */
  absorb(other: readonly Diagnostic[]): void {
    this.items.push(...other);
  }

  get all(): readonly Diagnostic[] {
    return this.items;
  }

  get hasErrors(): boolean {
    return this.items.some((d) => d.level === "error");
  }
}

/** Only errors block a run; warnings and info are shown but never gate. */
export function blocksRun(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.level === "error");
}

/**
 * Suggests the closest known heading for an unrecognized one, so a typo reads
 * as "did you mean ## Style Examples" rather than a silently ignored section.
 * Levenshtein over a handful of short strings — no need for anything cleverer.
 */
export function nearestHeading(actual: string, known: readonly string[]): string | undefined {
  const target = fold(actual);
  let best: { heading: string; distance: number } | undefined;
  for (const heading of known) {
    const distance = levenshtein(target, fold(heading));
    if (!best || distance < best.distance) best = { heading, distance };
  }
  if (!best) return undefined;
  // Past a third of the length the "suggestion" is noise, not help.
  return best.distance <= Math.max(2, Math.floor(target.length / 3)) ? best.heading : undefined;
}

/** Lowercase and strip accents, so `Memórias` matches `memorias`. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const substitution = (previous[j] ?? 0) + (a[i] === b[j] ? 0 : 1);
      const insertion = (current[j] ?? 0) + 1;
      const deletion = (previous[j + 1] ?? 0) + 1;
      current.push(Math.min(substitution, insertion, deletion));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}
