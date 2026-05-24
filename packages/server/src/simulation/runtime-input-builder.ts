import type {
  AgentRuntimeInput,
  EngineStepResult,
  PersonaConfig,
  BudgetPriority,
} from "@perfectman/shared";

export function buildAgentRuntimeInput(
  stepResult: EngineStepResult,
  persona: PersonaConfig,
  budgetPriority: BudgetPriority,
): AgentRuntimeInput {
  return {
    simulationId: stepResult.updatedAgentState.simulationId,
    agentId: stepResult.updatedAgentState.agentId,
    personaConfig: persona,
    perceptionPacket: stepResult.perceptionPacket,
    emotionalState: {
      coreMood: stepResult.updatedAgentState.coreMood,
      socialEmotions: stepResult.updatedAgentState.socialEmotions,
      relationalStates: stepResult.updatedAgentState.relationalStates,
    },
    activeMotivations: stepResult.motivations,
    activePressures: stepResult.pressures,
    activeInhibitions: stepResult.inhibitions,
    relevantMemories: stepResult.perceptionPacket.relevantMemories,
    availableActions: stepResult.availableActions,
    budgetPriority,
    triggeringReason: stepResult.attentionResults.triggeringReason,
  };
}
