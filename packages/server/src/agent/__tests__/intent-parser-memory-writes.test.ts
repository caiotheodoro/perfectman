import { describe, it, expect } from "vitest";
import { IntentParser } from "../intent-parser.js";
import { MEMORY_TONE_UNSPECIFIED, type AvailableAction } from "@perfectman/shared";

// Twelve real DeepSeek runs answered the seven-field memoryWrites contract
// with nothing at all. The model now sends `{summary, about?}`; the parser
// fills structure, the resolver fills tone/intensity, and a malformed
// proposal is dropped instead of sinking the whole intent into a fallback.
describe("IntentParser memoryWrites — short form", () => {
  const actorId = "nina";
  const availableActions: AvailableAction[] = [
    { intentType: "send_message", channelTargets: ["ch_familia"], personTargets: [], blocked: false },
  ];
  const packet = (memoryWrites: unknown) =>
    JSON.stringify({
      intentType: "send_message",
      channelTarget: "ch_familia",
      visibleContent: "Rafa, o cartório abre às nove.",
      privateMotiveSummary: "quero ver ele desviar de novo",
      memoryWrites,
    });

  it("normalizes a short proposal about someone into a relationship memory with the placeholder tone", () => {
    const result = IntentParser.parse(packet([{ summary: "o Rafa desviou do cartório de novo", about: ["Rafa"] }]), actorId, availableActions);
    expect(result.fallbackApplied).toBe(false);
    expect(result.droppedMemoryWrites).toBeUndefined();
    expect(result.intent.memoryWrites).toEqual([
      {
        type: "relationship",
        subjectAgentIds: ["Rafa"],
        summary: "o Rafa desviou do cartório de novo",
        emotionalTone: MEMORY_TONE_UNSPECIFIED,
        confidence: 0.7,
        intensity: 0.5,
        unresolved: true,
      },
    ]);
  });

  it("a short proposal about no one becomes a self memory", () => {
    const result = IntentParser.parse(packet([{ summary: "não tenho pra onde ir se venderem" }]), actorId, availableActions);
    expect(result.intent.memoryWrites[0]?.type).toBe("self");
    expect(result.intent.memoryWrites[0]?.subjectAgentIds).toEqual([]);
  });

  it("keeps the seven-field form exactly as sent", () => {
    const full = { type: "emotional_residue", subjectAgentIds: ["lia"], summary: "aquilo doeu", emotionalTone: "hurt", confidence: 0.8, intensity: 0.9, unresolved: true };
    const result = IntentParser.parse(packet([full]), actorId, availableActions);
    expect(result.intent.memoryWrites).toEqual([full]);
  });

  it("drops a malformed proposal, keeps the good one and the intent, and counts the drop", () => {
    const result = IntentParser.parse(
      packet([{ type: "episodic", subjectAgentIds: [], summary: "x", emotionalTone: "neutral", confidence: 0.5, intensity: 1.5, unresolved: false }, { summary: "a Lia já falou com o comprador", about: ["lia"] }, 42]),
      actorId,
      availableActions,
    );
    expect(result.fallbackApplied).toBe(false);
    expect(result.intent.intentType).toBe("send_message");
    expect(result.intent.memoryWrites).toHaveLength(1);
    expect(result.intent.memoryWrites[0]?.summary).toBe("a Lia já falou com o comprador");
    expect(result.droppedMemoryWrites).toBe(2);
  });

  it("an empty or missing memoryWrites stays empty", () => {
    expect(IntentParser.parse(packet([]), actorId, availableActions).intent.memoryWrites).toEqual([]);
    expect(IntentParser.parse(packet(null), actorId, availableActions).intent.memoryWrites).toEqual([]);
  });
});
