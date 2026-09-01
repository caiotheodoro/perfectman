import type { EventPayload, MemoryWriteProposal } from "@perfectman/shared";

export function memoryWrittenPayload(proposal: MemoryWriteProposal): EventPayload {
  return {
    memoryType: proposal.type,
    summary: proposal.summary,
    emotionalTone: proposal.emotionalTone,
    confidence: proposal.confidence,
    intensity: proposal.intensity,
    unresolved: proposal.unresolved,
    subjectAgentIds: proposal.subjectAgentIds,
  };
}
