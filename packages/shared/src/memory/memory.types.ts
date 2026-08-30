export type MemoryType =
  | "episodic"
  | "relationship"
  | "self"
  | "social_theory"
  | "pending_intention"
  | "emotional_residue";

export type Memory = {
  id: string;
  agentId: string;
  simulationId: string;
  type: MemoryType;
  subjectAgentIds: string[];
  sourceEventIds: string[];
  summary: string;
  emotionalTone: string;
  confidence: number; // [0, 1]
  intensity: number; // [0, 1]
  unresolved: boolean;
  createdAt: number;
  lastReinforcedAt: number;
};

export type MemoryWriteProposal = {
  type: MemoryType;
  subjectAgentIds: string[];
  summary: string;
  emotionalTone: string;
  confidence: number;
  intensity: number; // [0, 1]
  unresolved: boolean;
};
