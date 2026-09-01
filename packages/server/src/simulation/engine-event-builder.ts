import { memoryWrittenPayload } from "./memory-written-payload.js";
import type {
  DelusionGap,
  EmergentGoal,
  EndingOffer,
  EngineStepResult,
  GoalProposal,
  GoalSynthesisResult,
  SimulationEvent,
  EmotionDelta,
  StagnationMetrics,
  WorldVerdict,
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

type GoalEventContext = {
  simulationId: string;
  channelId: string;
  pulseIndex: number;
};

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
        payload: memoryWrittenPayload(proposal),
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

  /** Agent-legible goal announcement — the proposal reaches the target agent. */
  fromGoalProposed(
    result: GoalSynthesisResult,
    ctx: GoalEventContext,
  ): SimulationEvent {
    const agentId = result.proposal.agentId;
    return {
      simulationId: ctx.simulationId,
      channelId: ctx.channelId,
      actorId: "system",
      type: "goal_proposed",
      payload: {
        goalId: result.proposal.id,
        proposal: result.proposal,
        narrativeFraming: result.narrativeFraming,
        confidence: result.confidence,
        synthesizer: result.synthesizer,
      },
      sourceEventIds: [],
      emotionalSalience: "medium",
      pulseIndex: ctx.pulseIndex,
      visibility: agentVisible(agentId, "goal_proposal"),
    };
  }

  fromGoalAccepted(goal: EmergentGoal, ctx: GoalEventContext): SimulationEvent {
    return {
      simulationId: ctx.simulationId,
      channelId: ctx.channelId,
      actorId: "system",
      type: "goal_accepted",
      payload: { goalId: goal.id, goal },
      sourceEventIds: [],
      emotionalSalience: "medium",
      pulseIndex: ctx.pulseIndex,
      visibility: agentVisible(goal.agentId, "goal_proposal"),
    };
  }

  fromGoalDeclined(proposal: GoalProposal, ctx: GoalEventContext): SimulationEvent {
    return {
      simulationId: ctx.simulationId,
      channelId: ctx.channelId,
      actorId: "system",
      type: "goal_declined",
      payload: { goalId: proposal.id, proposal },
      sourceEventIds: [],
      emotionalSalience: "medium",
      pulseIndex: ctx.pulseIndex,
      visibility: agentVisible(proposal.agentId, "goal_proposal"),
    };
  }

  fromWorldVerdict(verdict: WorldVerdict, ctx: GoalEventContext): SimulationEvent {
    return {
      simulationId: ctx.simulationId,
      channelId: ctx.channelId,
      actorId: "system",
      type: "world_verdict",
      payload: { goalId: verdict.goalId, verdict },
      sourceEventIds: [],
      emotionalSalience: salience(verdict.confidence),
      pulseIndex: ctx.pulseIndex,
      visibility: WORLD_LAYER_VISIBILITY,
    };
  }

  fromDelusionGapSampled(gap: DelusionGap, ctx: GoalEventContext): SimulationEvent {
    const sample = gap.history[gap.history.length - 1]!;
    return {
      simulationId: ctx.simulationId,
      channelId: ctx.channelId,
      actorId: "system",
      type: "delusion_gap_sampled",
      payload: {
        goalId: gap.goalId,
        agentId: gap.agentId,
        at: sample.at,
        magnitude: sample.magnitude,
        divergenceFromLog: sample.divergenceFromLog,
        divergenceFromWorld: sample.divergenceFromWorld,
      },
      sourceEventIds: [],
      emotionalSalience: salience(sample.magnitude),
      pulseIndex: ctx.pulseIndex,
      visibility: WORLD_LAYER_VISIBILITY,
    };
  }

  fromEndingOffered(offer: EndingOffer, ctx: GoalEventContext): SimulationEvent {
    return {
      simulationId: ctx.simulationId,
      channelId: ctx.channelId,
      actorId: "system",
      type: "ending_offered",
      payload: { goalId: offer.goalId, offer },
      sourceEventIds: [],
      emotionalSalience: "high",
      pulseIndex: ctx.pulseIndex,
      visibility: WORLD_LAYER_VISIBILITY,
    };
  }
}

const WORLD_LAYER_VISIBILITY: SimulationEvent["visibility"] = {
  visibleToAgents: [],
  visibleToSpectators: true,
  visibleToOperators: true,
  visibilityReason: "goal_layer",
};

function agentVisible(
  agentId: string,
  reason: string,
): SimulationEvent["visibility"] {
  return {
    visibleToAgents: [agentId],
    visibleToSpectators: true,
    visibleToOperators: true,
    visibilityReason: reason,
  };
}
