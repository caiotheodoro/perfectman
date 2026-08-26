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
 * This guard exists because `rate_limit_hit` was declared but never emitted
 * anywhere in packages/server/src — removed with this change. The
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

/**
 * True if `type` is emitted as an OperatorEvent somewhere in `source`.
 *
 * A bare `type: "<name>"` occurrence is not proof of an operator emission:
 * `intent_blocked`, `intent_delayed` and `llm_failure` are also committed
 * `SimulationEvent` types, and the same `type:` literal appears in their
 * constructions (`intent-resolver.ts` builds committed events with
 * `type: "intent_blocked"`/`"intent_delayed"`; `pulse-scheduler.ts` builds a
 * committed `llm_failure`). `detail` is a required field of `OperatorEvent`
 * and never appears on `SimulationEvent`, so an occurrence with a `detail`
 * property nearby is structurally an operator emission; one without (a
 * committed-event construction, or a stray mention) must not count.
 *
 * Residual limitation: a doc comment that happens to mention both the type
 * literal and `detail` within the window would count — none exists today.
 */
function hasOperatorEmission(source: string, type: string): boolean {
  const needle = `type: "${type}"`;
  let from = 0;
  for (;;) {
    const at = source.indexOf(needle, from);
    if (at === -1) return false;
    // `detail` is the operator-only discriminator; match both the explicit
    // `detail:` form and the shorthand `detail,` (pulse-scheduler.ts uses
    // shorthand in its schedulerError helper).
    const window = source.slice(Math.max(0, at - 200), at + 300);
    if (/detail\s*[:,]/.test(window)) return true;
    from = at + needle.length;
  }
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
    (type: (typeof OPERATOR_EVENT_TYPES)[number]) => {
      expect(
        hasOperatorEmission(allSource, type),
        `${type} is declared in shared but never emitted as an OperatorEvent in packages/server/src — remove it from OPERATOR_EVENT_TYPES or wire a producer`,
      ).toBe(true);
    },
  );
});

describe("hasOperatorEmission discriminates operator events from committed events", () => {
  it("rejects a committed-event construction that shares the type name", () => {
    // `llm_failure` exists in BOTH the SimulationEvent and OperatorEvent
    // unions; a plain substring match for `type: "llm_failure"` would pass
    // on this committed-event shape (SimulationEvent has no `detail` field)
    // even though no OperatorEvent is emitted. This is the false-positive
    // class the guard must reject.
    const committedEventShape = `
      const event: SimulationEvent = {
        simulationId: "sim-1",
        channelId: "general",
        actorId: "leo",
        type: "llm_failure",
        payload: { reason: "provider error" },
        sourceEventIds: [],
        emotionalSalience: "low",
        visibility: { visibleToAgents: [], visibleToSpectators: false, visibleToOperators: true, visibilityReason: "x" },
      };
    `;
    expect(hasOperatorEmission(committedEventShape, "llm_failure")).toBe(false);
  });

  it("accepts a real operator-event construction", () => {
    const operatorEventShape = `
      const op: OperatorEvent = {
        type: "llm_failure",
        simulationId: "sim-1",
        agentId: "leo",
        pulseIndex: 3,
        detail: "LLM provider execution failed",
        createdAt: 0,
      };
    `;
    expect(hasOperatorEmission(operatorEventShape, "llm_failure")).toBe(true);
  });

  it("accepts the shorthand-detail form used by schedulerError", () => {
    const shorthand = `
      return {
        type: "scheduler_error",
        simulationId: this.config.simulation.id,
        agentId,
        pulseIndex: this.pulseIndex,
        detail,
        data,
        createdAt: Date.now(),
      };
    `;
    expect(hasOperatorEmission(shorthand, "scheduler_error")).toBe(true);
  });
});
