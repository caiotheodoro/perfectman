/**
 * No-I/O boundary test.
 * Verifies the engine package does NOT import any I/O modules.
 *
 * This test analyzes the compiled/source imports of the engine package
 * to ensure the pure engine boundary is maintained.
 *
 * Forbidden imports:
 *   - fs / node:fs
 *   - http / https / node:http / node:https
 *   - net / node:net
 *   - socket.io
 *   - better-sqlite3
 *   - @anthropic-ai/sdk
 *   - packages/server (any path containing /server/src)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const FORBIDDEN_IMPORTS = [
  /^['"]fs['"]/,
  /^['"]node:fs['"]/,
  /^['"]http['"]/,
  /^['"]https['"]/,
  /^['"]node:http['"]/,
  /^['"]node:https['"]/,
  /^['"]net['"]/,
  /^['"]node:net['"]/,
  /['"]socket\.io['"]/,
  /['"]better-sqlite3['"]/,
  /['"]@anthropic-ai\/sdk['"]/,
];

const ENGINE_SRC = resolve(__dirname, "..");

/** Recursively collect all .ts files in a directory */
function collectTsFiles(dir: string, results: string[] = []): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith("__")) {
      collectTsFiles(fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      results.push(fullPath);
    }
  }
  return results;
}

/** Extract import strings from a TypeScript file (naive regex, good enough for boundary check) */
function extractImports(content: string): string[] {
  const importRe = /import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g;
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    results.push(`"${m[1]}"`);
  }
  return results;
}

describe("Engine No-I/O Boundary", () => {
  it("engine source files do not import I/O modules", () => {
    const files = collectTsFiles(ENGINE_SRC).filter(f => !f.includes("__tests__"));
    const violations: Array<{ file: string; line: string; forbidden: string }> = [];

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const lines = content.split("\n");
      for (const line of lines) {
        for (const pattern of FORBIDDEN_IMPORTS) {
          if (pattern.test(line)) {
            violations.push({
              file:     file.replace(ENGINE_SRC, "").replace(/^\//, ""),
              line:     line.trim(),
              forbidden: pattern.toString(),
            });
          }
        }
      }
    }

    if (violations.length > 0) {
      const report = violations.map(v =>
        `  ${v.file}: ${v.line} (matched ${v.forbidden})`
      ).join("\n");
      throw new Error(`Engine imports forbidden I/O modules:\n${report}`);
    }

    expect(violations).toHaveLength(0);
  });

  it("engine source files do not import from packages/server", () => {
    const files = collectTsFiles(ENGINE_SRC).filter(f => !f.includes("__tests__"));
    const violations: Array<{ file: string; import: string }> = [];

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const imports = extractImports(content);
      for (const imp of imports) {
        if (imp.includes("/server/src") || imp.includes("packages/server")) {
          violations.push({ file, import: imp });
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Engine imports from server package (violates I/O boundary):\n` +
        violations.map(v => `  ${v.file}: ${v.import}`).join("\n"),
      );
    }

    expect(violations).toHaveLength(0);
  });

  it("engine source only imports from @perfectman/shared or relative paths", () => {
    const files = collectTsFiles(ENGINE_SRC).filter(f => !f.includes("__tests__"));
    const violations: string[] = [];

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const importRe = /from\s+['"]([^'"]+)['"]/g;
      let m: RegExpExecArray | null;
      while ((m = importRe.exec(content)) !== null) {
        const imp = m[1]!;
        // Allowed: relative imports, @perfectman/shared, node: builtins explicitly allowed in test
        const isRelative = imp.startsWith(".");
        const isShared = imp === "@perfectman/shared";
        const isNodeBuiltin = imp.startsWith("node:");

        if (!isRelative && !isShared && !isNodeBuiltin) {
          violations.push(`${file.replace(ENGINE_SRC, "")}: "${imp}"`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Engine imports unexpected external packages:\n` +
        violations.map(v => `  ${v}`).join("\n"),
      );
    }

    expect(violations).toHaveLength(0);
  });
});
