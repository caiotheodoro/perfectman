import type {
  EngineStepResult,
  SimulationEvent,
  EmotionDelta,
  StagnationMetrics,
} from "@perfectman/shared";

type EngineEventContext = {
  simulationId: string;
  agentId: string;
  channelId: string;
  pulseIndex: number;
};

function emotionDeltaMagnitude(delta: EmotionDelta): number {
  const moodVals = Object.values(delta.coreMoodDelta).filter(
    (v): v is number => typeof v === "number",
  );
  if (moodVals.length === 0) return 0;
  const sumSq = moodVals.reduce((acc, v) => acc + v * v, 0);
  return Math.sqrt(sumSq / moodVals.length);
}

function salience(magnitude: number): SimulationEvent["emotionalSalience"] {
  if (magnitude >= 0.6) return "critical";
  if (magnitude >= 0.4) return "high";
  if (magnitude >= 0.2) return "medium";
  return "low";
}

const OPERATOR_ONLY_VISIBILITY: SimulationEvent["visibility"] = {
  visibleToAgents: [],
  visibleToSpectators: false,
  visibleToOperators: true,
  visibilityReason: "operator_only",
};

export class EngineEventBuilder {
  fromStepResult(
    stepResult: EngineStepResult,
    ctx: EngineEventContext,
  ): SimulationEvent[] {
    const events: SimulationEvent[] = [];

    // memory_written: one per proposal when proposals exist
    for (const proposal of stepResult.memoryProposals) {
      const mag = emotionDeltaMagnitude(stepResult.emotionDelta);
      events.push({
        simulationId: ctx.simulationId,
        channelId: ctx.channelId,
        actorId: ctx.agentId,
        type: "memory_written",
        payload: {
          memoryType: proposal.type,
          summary: proposal.summary,
          emotionalTone: proposal.emotionalTone,
          confidence: proposal.confidence,
          unresolved: proposal.unresolved,
          subjectAgentIds: proposal.subjectAgentIds,
        },
        sourceEventIds: [],
        emotionalSalience: salience(mag),
        pulseIndex: ctx.pulseIndex,
        visibility: OPERATOR_ONLY_VISIBILITY,
      });
    }

    // no_op_recorded: when noOpRecord present
    if (stepResult.noOpRecord) {
      events.push({
        simulationId: ctx.simulationId,
        channelId: ctx.channelId,
        actorId: ctx.agentId,
        type: "no_op_recorded",
        payload: {
          reason: stepResult.noOpRecord.reason,
          privateMotiveSummary: stepResult.noOpRecord.privateMotiveSummary,
        },
        sourceEventIds: [],
        emotionalSalience: "low",
        pulseIndex: ctx.pulseIndex,
        visibility: OPERATOR_ONLY_VISIBILITY,
      });
    }

    return events;
  }

  fromStagnation(
    metrics: StagnationMetrics,
    ctx: EngineEventContext,
  ): SimulationEvent | null {
    if (metrics.level === "normal") return null;
    return {
      simulationId: ctx.simulationId,
      channelId: ctx.channelId,
      actorId: "system",
      type: "stagnation_detected",
      payload: {
        level: metrics.level,
        compositeScore: metrics.compositeScore,
        metrics,
      },
      sourceEventIds: [],
      emotionalSalience:
        metrics.level === "critical" ? "critical"
        : metrics.level === "red" ? "high"
        : "medium",
      pulseIndex: ctx.pulseIndex,
      visibility: {
        visibleToAgents: [],
        visibleToSpectators: false,
        visibleToOperators: true,
        visibilityReason: "operator_only",
      },
    };
  }
}
