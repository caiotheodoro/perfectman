import { describe, it, expect } from "vitest";
import { modelIntentPacketFieldContract } from "../intent-packet.schema.js";

describe("modelIntentPacketFieldContract — memoryWrites nested field types", () => {
  it("tells the model which memory `type` enum values are valid, not just the field name", () => {
    const contract = modelIntentPacketFieldContract();
    const memoryLine = contract.find((line) => line.startsWith('"memoryWrites"'));
    expect(memoryLine).toBeDefined();

    // The real bug this guards: without this, the model has no way to know
    // "type" must be one of these six values, and invents its own
    // ("observation", "reflection", "interaction", ...) — every one of
    // which fails MemoryWriteProposalSchema validation and silently
    // degrades a real turn into a no_op (see the memoryWrites fallback
    // path in composeIntentPacket / IntentParser).
    for (const validType of ["episodic", "relationship", "self", "social_theory", "pending_intention", "emotional_residue"]) {
      expect(memoryLine).toContain(validType);
    }
    // confidence/intensity must be typed as numbers, not left unspecified —
    // the same live run also saw them sent as strings.
    expect(memoryLine).toMatch(/confidence.*number/);
    expect(memoryLine).toMatch(/intensity.*number/);
  });
});
