import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateEvidence } from "../cli/evidence.js";

describe("evidence finalStates witnesses memory + relational subsystems", () => {
  let outDir: string;

  afterEach(() => {
    if (outDir) rmSync(outDir, { recursive: true, force: true });
  });

  it("surfaces non-empty memories and relationalStates for a 2-agent memory-seeded scenario", async () => {
    outDir = mkdtempSync(join(tmpdir(), "perfectman-evidence-"));
    const { evidence } = await generateEvidence({
      out: outDir,
      scenarios: ["v1_biased_memory"],
      llmMode: "mock",
    });

    expect(evidence).toHaveLength(1);
    const finalStates = evidence[0]!.finalStates;
    const agentIds = Object.keys(finalStates);
    expect(agentIds).toHaveLength(2);

    for (const agentId of agentIds) {
      expect(finalStates[agentId]!.relationalStates).toBeGreaterThan(0);
    }
    // The scenario seeds memories for goulart and the mock persona keeps
    // emitting memoryWrites through the run, so at least one agent's count
    // must reflect committed memory_written events.
    expect(Object.values(finalStates).some((s) => s.memories! > 0)).toBe(true);
  });
});
