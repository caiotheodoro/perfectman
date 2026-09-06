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

    // Relational states accrue from witnessed `message_sent` events (see
    // RELATIONAL_UPDATE_RULES); which agent ends up with one depends on the
    // mock's turn dynamics (under the ADR-0017 D-62 consult, goulart's only
    // message became a reply and caio's count went to 0). The evidence
    // plumbing is what this test witnesses: at least one agent must carry a
    // non-zero count, as for memories below.
    expect(Object.values(finalStates).some((s) => s.relationalStates! > 0)).toBe(true);
    // The scenario seeds memories for goulart and the mock persona keeps
    // emitting memoryWrites through the run, so at least one agent's count
    // must reflect committed memory_written events.
    expect(Object.values(finalStates).some((s) => s.memories! > 0)).toBe(true);
  });
});
