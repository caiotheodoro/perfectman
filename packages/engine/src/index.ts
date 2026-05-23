// Pure functions only — no I/O imports allowed in this package

// Visibility
export {
  filterVisibleEventsForAgent,
  filterVisibleEventsForSpectator,
  filterVisibleEventsForOperator,
} from "./visibility/filter-visible-events.js";

// Anti-drift cursor
export {
  getNewEventsSince,
  getLastEventId,
} from "./memory/get-new-events-since.js";

// Attention
export { scoreAttention } from "./attention/score-attention.js";

// Perception
export { buildPerceptionPacket } from "./perception/build-perception-packet.js";

// Available Actions
export { computeAvailableActions } from "./action/compute-available-actions.js";

// Emotion Stack
export { updateCoreMood } from "./emotion/update-core-mood.js";
export { updateSocialEmotions } from "./emotion/update-social-emotions.js";
export { updateRelationalEmotions } from "./emotion/update-relational-emotions.js";
export { computeActionEmotions } from "./emotion/compute-action-emotions.js";
export { updateEmotionStack } from "./emotion/update-emotion-stack.js";
export type { EmotionStackResult } from "./emotion/update-emotion-stack.js";

// Interpretation
export { interpretProgrammaticSignals } from "./interpretation/interpret-programmatic-signals.js";

// Motivation
export { deriveMotivations } from "./motivation/derive-motivations.js";

// Pressure
export { computePressures } from "./pressure/compute-pressures.js";

// Inhibition
export { computeInhibitions } from "./inhibition/compute-inhibitions.js";

// Decision
export { resolveDecision } from "./decision/resolve-decision.js";

// Initiative
export {
  updateInitiativeAccumulators,
  scoreInitiativeCandidates,
  anyInitiativeProceed,
} from "./initiative/update-initiative-accumulators.js";

// Rumination
export { applyRumination } from "./rumination/apply-rumination.js";

// Intent Validation
export { validateIntentPure } from "./intent/validate-intent.js";
export { checkRateLimitPure } from "./intent/rate-limit-rules.js";

// Emotional State Translation (used by dev1 prompt builder)
export { translateEmotionalState } from "./prompt/translate-emotional-state.js";
export type { TranslatedEmotionalState, RelationalFlavor } from "./prompt/translate-emotional-state.js";

// Engine Step (primary entry point)
export { runEngineStep } from "./step/run-engine-step.js";

// Health / Stagnation
export {
  computeStagnationMetrics,
  detectAttractorStates,
} from "./health/compute-stagnation-metrics.js";
