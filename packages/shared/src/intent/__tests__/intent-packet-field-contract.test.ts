import { describe, it, expect } from "vitest";
import { modelIntentPacketFieldContract, memoryWriteProposalFieldContract } from "../intent-packet.schema.js";

describe("modelIntentPacketFieldContract — memoryWrites", () => {
  // The packet asks the model for the short proposal only: twelve real
  // DeepSeek runs answered the seven-field list with nothing. The full form
  // stays accepted and is still described where a surface emits it directly.
  it("describes the short memory proposal (summary, about) and nothing the model no longer has to fill", () => {
    const contract = modelIntentPacketFieldContract();
    const memoryLine = contract.find((line) => line.startsWith('"memoryWrites"'));
    expect(memoryLine).toBe('"memoryWrites" (optional): array of objects (summary: string; about: array of strings)');
    expect(memoryLine).not.toContain("emotionalTone");
    expect(memoryLine).not.toContain("confidence");
    const full = memoryWriteProposalFieldContract().join("\n");
    for (const validType of ["episodic", "relationship", "self", "social_theory", "pending_intention", "emotional_residue"]) {
      expect(full).toContain(validType);
    }
    expect(full).toMatch(/confidence.*number/);
  });
});
