import type {
  EngineSnapshot,
  EngineStepResult,
  AgentState,
  NoOpRecord,
  OperatorMetrics,
} from "@perfectman/shared";

// Visibility
import { filterVisibleEventsForAgent } from "../visibility/filter-visible-events.js";

// Anti-drift
import { getNewEventsSince, getLastEventId } from "../memory/get-new-events-since.js";

// Attention
import { scoreAttention } from "../attention/score-attention.js";

// Perception
import { buildPerceptionPacket } from "../perception/build-perception-packet.js";

// Interpretation
import { interpretProgrammaticSignals } from "../interpretation/interpret-programmatic-signals.js";

// Emotion Stack
import { updateEmotionStack } from "../emotion/update-emotion-stack.js";

// Motivation
import { deriveMotivations } from "../motivation/derive-motivations.js";

// Pressure + Inhibition
import { computePressures } from "../pressure/compute-pressures.js";
import { computeInhibitions } from "../inhibition/compute-inhibitions.js";

// Decision
import { resolveDecision } from "../decision/resolve-decision.js";

// Initiative
import {
  updateInitiativeAccumulators,
  scoreInitiativeCandidates,
  anyInitiativeProceed,
} from "../initiative/update-initiative-accumulators.js";

// Rumination
import { applyRumination } from "../rumination/apply-rumination.js";

// Available Actions
import { computeAvailableActions } from "../action/compute-available-actions.js";

/**
 * Pure engine step — primary entry point.
 * Dev2 calls this per agent per pulse with an assembled EngineSnapshot.
 *
 * Pipeline:
 *   1. Visibility filter
 *   2. Anti-drift cursor
 *   3. Update initiative accumulators
 *   4. Score attention
 *   5. Build perception packet
 *   6. Programmatic interpretation
 *   7. Emotion stack (8-step cycle)
 *   8. Rumination
 *   9. Derive motivations
 *   10. Compute pressures + inhibitions
 *   11. Resolve decision
 *   12. Score initiative candidates
 *   13. Compute available actions
 *   14. Package EngineStepResult
 */
export function runEngineStep(snapshot: EngineSnapshot): EngineStepResult {
  const {
    pulseIndex,
    simulation,
    committedEvents,
    agentState,
    persona,
    channels,
    channelMembership,
    worldSignals,
    rateLimitStatus,
    dt,
    rng,
  } = snapshot;

  const now = Date.now();

  // ── 1. Visibility filter ──────────────────────────────────────────────────
  const visibleEvents = filterVisibleEventsForAgent(
    committedEvents,
    agentState.agentId,
    channels,
    channelMembership,
  );

  // ── 2. Anti-drift cursor ──────────────────────────────────────────────────
  const newEvents = getNewEventsSince(visibleEvents, agentState.lastProcessedEventId);
  const hasNewEvents = newEvents.length > 0;

  // ── 3. Update initiative accumulators ────────────────────────────────────
  // (Pre-attention so attention can see accumulator scores)
  const justActed = agentState.lastActionAt !== null &&
    now - agentState.lastActionAt < snapshot.simulation.settings.pulseIntervalMs * 1.5;

  const updatedAccumulators = updateInitiativeAccumulators(
    agentState.initiativeAccumulators,
    // Temporary zero action emotions — will be refined after emotion stack
    // This is intentional: initiative updates before full emotion processing
    zeroActionEmotions(),
    agentState,
    persona,
    pulseIndex,
    justActed,
  );

  // ── 4. Attention scoring ──────────────────────────────────────────────────
  const attentionResults = scoreAttention(
    { ...agentState, initiativeAccumulators: updatedAccumulators },
    persona,
    newEvents,
    worldSignals,
    agentState.relationalStates,
    agentState.lastActionAt,
    simulation.settings.pulseIntervalMs,
  );

  // ── 5. Interpretation ─────────────────────────────────────────────────────
  const interpretations = interpretProgrammaticSignals(
    agentState.agentId,
    agentState,
    visibleEvents,
    worldSignals.timeSinceLastPublicMessage,
    simulation.settings.pulseIntervalMs,
  );

  // ── 6. Emotion stack ──────────────────────────────────────────────────────
  const emotionResult = updateEmotionStack(agentState, persona, newEvents, dt, now);

  // ── 7. Rumination ─────────────────────────────────────────────────────────
  const ruminationResult = applyRumination(
    {
      ...agentState,
      ...emotionResult.updatedState,
    },
    persona,
    emotionResult.emotionDelta,
    rng,
    pulseIndex,
    hasNewEvents,
  );

  // Merge relational updates
  const finalRelational = ruminationResult.updatedRelationalStates;

  // ── 8. Motivations ────────────────────────────────────────────────────────
  const motivations = deriveMotivations(
    agentState,
    persona,
    emotionResult.actionEmotions,
  );

  // ── 9. Pressures + Inhibitions ────────────────────────────────────────────
  const pressures = computePressures(
    agentState,
    emotionResult.actionEmotions,
    newEvents.map(e => e.id),
  );

  const tempAgentForInhibitions: AgentState = {
    ...agentState,
    socialEmotions: emotionResult.updatedState.socialEmotions,
    relationalStates: finalRelational,
  };
  const inhibitions = computeInhibitions(
    tempAgentForInhibitions,
    persona,
    emotionResult.actionEmotions,
  );

  // ── 10. Available Actions ─────────────────────────────────────────────────
  const availableActions = computeAvailableActions(
    agentState,
    channels,
    channelMembership,
    simulation.settings,
    rateLimitStatus,
  );

  // ── 11. Initiative candidates ─────────────────────────────────────────────
  const initiativeCandidates = scoreInitiativeCandidates(
    updatedAccumulators,
    pulseIndex,
    agentState.lastActionAt,
    simulation.settings.pulseIntervalMs,
  );
  const initiativeProceed = anyInitiativeProceed(initiativeCandidates);

  // ── 12. Decision ──────────────────────────────────────────────────────────
  const rawDecision = resolveDecision(
    pressures,
    inhibitions,
    agentState,
    persona,
    hasNewEvents,
    initiativeProceed,
    pulseIndex,
  );

  // If attention says needsLLM but decision doesn't (due to low pressures),
  // propagate needsLLM=true as long as the outcome is not no_op/memory_only.
  const decision = {
    ...rawDecision,
    needsLLM:
      rawDecision.needsLLM ||
      (attentionResults.needsLLM && rawDecision.outcome !== "no_op" && rawDecision.outcome !== "memory_only"),
  };

  // ── 13. Perception packet ─────────────────────────────────────────────────
  const triggeringEvent = attentionResults.triggeringEventId
    ? newEvents.find(e => e.id === attentionResults.triggeringEventId) ?? null
    : null;

  const emotionalState = {
    coreMood:        emotionResult.updatedState.coreMood,
    socialEmotions:  emotionResult.updatedState.socialEmotions,
    relationalStates: finalRelational,
  };

  const perceptionPacket = buildPerceptionPacket(
    agentState,
    visibleEvents,
    triggeringEvent,
    channels,
    attentionResults,
    emotionalState,
    availableActions,
  );

  // ── 14. Updated agent state ───────────────────────────────────────────────
  const newLastProcessedEventId =
    hasNewEvents ? getLastEventId(newEvents) : agentState.lastProcessedEventId;

  const updatedAgentState: AgentState = {
    ...agentState,
    coreMood:             emotionResult.updatedState.coreMood,
    socialEmotions:       emotionResult.updatedState.socialEmotions,
    relationalStates:     finalRelational,
    initiativeAccumulators: updatedAccumulators,
    lastProcessedEventId: newLastProcessedEventId,
    updatedAt:            now,
  };

  // ── 15. No-op record ──────────────────────────────────────────────────────
  const noOpRecord: NoOpRecord | null =
    decision.outcome === "no_op" && decision.noOpReason
      ? {
          agentId:              agentState.agentId,
          reason:               decision.noOpReason,
          privateMotiveSummary: decision.privateMotiveSeed || "Staying quiet for now.",
          pulseIndex,
        }
      : null;

  // ── 16. Operator metrics ──────────────────────────────────────────────────
  // Engine step provides per-agent snapshot data; dev2 scheduler aggregates
  // into the full OperatorMetrics before emitting to operator feed.
  const operatorMetrics: OperatorMetrics = {
    pulseIndex,
    pulseDurationMs:   0, // dev2 fills in actual duration
    agentsCalled:      1, // this agent was called
    eventsCommitted:   0, // dev2 fills in after commit
    llmCallsMade:      decision.needsLLM ? 1 : 0,
    budgetUsedPercent: 0, // dev1 fills in
  };

  return {
    visibleEvents,
    newEvents,
    attentionResults,
    perceptionPacket,
    interpretations,
    emotionDelta:     ruminationResult.emotionDelta,
    updatedAgentState,
    motivations,
    pressures,
    inhibitions,
    actionEmotions:   emotionResult.actionEmotions,
    decision,
    availableActions,
    initiativeCandidates,
    memoryProposals:  [],  // populated by dev1 IntentParser
    noOpRecord,
    operatorMetrics,
  };
}

function zeroActionEmotions() {
  return {
    defensiveness: 0, warmth: 0, jealousInspection: 0, shameWithdrawal: 0,
    resentfulColdness: 0, curiousApproach: 0, anxiousOverreach: 0,
    pridefulPerformance: 0, vulnerableRetreat: 0, contemptuousDismissal: 0,
    strategicPatience: 0, impulsiveProvocation: 0, comfortSeeking: 0,
    dominanceAssertion: 0, repairImpulse: 0,
  };
}
