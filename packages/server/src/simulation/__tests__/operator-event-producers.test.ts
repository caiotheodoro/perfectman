import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { OPERATOR_EVENT_TYPES } from "@perfectman/shared";

/**
 * Producer guard for `OperatorEventType`.
 *
 * The single source of truth is the `OPERATOR_EVENT_TYPES` array in
 * packages/shared/src/operator/operator.types.ts (the type is derived from
 * it). This test enforces the invariant that every *declared* operator type
 * actually has an emission site in packages/server/src — a declared type
 * nobody emits can never reach a receiver, and keeping it around invites
 * drift between the contract and the runtime.
 *
 * The reverse direction (emitting an undeclared type) needs no guard here:
 * the type system already rejects any `type: "..."` that is not a member of
 * the union.
 *
 * This guard exists because `rate_limit_hit` was declared but never
 * emitted anywhere in packages/server/src — removed with this change. The
 * observability-stream types (`agent_state_snapshot`, `action_intent`,
 * `event_visibility`) landed on main with PR #100 and each has a producer.
 */

// Test lives at packages/server/src/simulation/__tests__/, so the server
// source root is three levels up from this file.
const SERVER_SRC = fileURLToPath(new URL("../../..", import.meta.url));
const SKIP_DIRS = new Set(["__tests__", "__e2e__"]);

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      files.push(...collectSourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      files.push(full);
    }
  }
  return files;
}

describe("operator event producers", () => {
  const sourceFiles = collectSourceFiles(SERVER_SRC);

  it("scans the server source tree (not an empty or wrong path)", () => {
    // A broken path resolves to zero files and would make every producer
    // assertion below fail for the wrong reason — or pass vacuously if the
    // join were ever inverted. Fail loudly and name the resolved root.
    expect(sourceFiles.length, `no source files under ${SERVER_SRC}`).toBeGreaterThan(0);
  });

  const allSource = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");

  it.each(OPERATOR_EVENT_TYPES)(
    "declared operator type %s has an emission site in packages/server/src",
    (type) => {
      expect(
        allSource.includes(`type: "${type}"`),
        `${type} is declared in shared but never emitted in packages/server/src — remove it from OPERATOR_EVENT_TYPES or wire a producer`,
      ).toBe(true);
    },
  );
});
