/**
 * Stagnation detection thresholds and composite score weights.
 * Used by packages/engine/src/health/compute-stagnation-metrics.ts
 *
 * 7 metrics:
 *   BDI — Behavioral Diversity Index
 *   RDV — Relational Drift Variance
 *   IGE — Initiative Gap Entropy
 *   CUE — Channel Utilization Entropy
 *   ERI — Emotional Range Index
 *   ISD — Intent Success Diversity
 *   CNS — Conversation Novelty Score
 */

export type StagnationThresholds = {
  /** Yellow alert: composite score ≥ this */
  yellow: number;
  /** Red alert: composite score ≥ this */
  red: number;
  /** Critical: composite score ≥ this */
  critical: number;
};

export const STAGNATION_THRESHOLDS: Readonly<StagnationThresholds> = {
  yellow:   0.60,
  red:      0.75,
  critical: 0.85,
};

/** Composite score = sum(weight_i * metric_i) — must sum to 1.0 */
export type StagnationWeights = {
  bdi: number;  // Behavioral Diversity Index
  rdv: number;  // Relational Drift Variance
  ige: number;  // Initiative Gap Entropy
  cue: number;  // Channel Utilization Entropy
  eri: number;  // Emotional Range Index
  isd: number;  // Intent Success Diversity
  cns: number;  // Conversation Novelty Score
};

export const STAGNATION_WEIGHTS: Readonly<StagnationWeights> = {
  bdi: 0.20,  // behavioral variety most important
  rdv: 0.18,  // relational drift matters a lot
  ige: 0.15,  // initiative gaps signal stuck agents
  cue: 0.12,  // channel spread
  eri: 0.15,  // emotional flatness = stagnation
  isd: 0.10,  // intent success variety
  cns: 0.10,  // conversation content novelty
};

/** Intervention cooldown — minimum pulses between stagnation interventions */
export const STAGNATION_INTERVENTION_COOLDOWN_PULSES = 20;

/**
 * Rolling window (in pulses) of committed events fed to the stagnation
 * detectors — `computeStagnationMetrics` and `detectAttractorStates`. Bounds
 * the input so early-run activity cannot mask a room that has since gone flat.
 * Exact N deferred to tuning (decision #125).
 */
export const STAGNATION_WINDOW_PULSES = 40;

/**
 * 6 attractor state signatures (behavioral patterns indicating stagnation).
 * Engine detects these to supplement the composite score.
 */
export type AttractorState =
  | "message_loop"          // same 2-3 agents replying to each other with no others joining
  | "silence_cascade"       // all agents trending to no_op
  | "single_topic_lock"     // all messages reference same entity/topic
  | "dormant_agents"        // >50% agents have no action in last N pulses
  | "private_channel_flood" // >3 private channels active simultaneously
  | "reaction_only"         // messages replaced mostly by reactions

export const ATTRACTOR_DETECTION_WINDOW_PULSES = 15;

/** Thresholds for individual attractor detection */
export const ATTRACTOR_THRESHOLDS: Readonly<Record<AttractorState, number>> = {
  message_loop:          0.70, // >70% of messages from only 2 agents
  silence_cascade:       0.60, // >60% of agent decisions are no_op
  single_topic_lock:     0.75, // >75% messages mention same entity
  dormant_agents:        0.50, // >50% agents idle
  private_channel_flood: 3,    // absolute count
  reaction_only:         0.65, // >65% responses are reactions not text
};
