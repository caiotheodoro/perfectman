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
export const STAGNATION_THRESHOLDS = {
    yellow: 0.60,
    red: 0.75,
    critical: 0.85,
};
export const STAGNATION_WEIGHTS = {
    bdi: 0.20, // behavioral variety most important
    rdv: 0.18, // relational drift matters a lot
    ige: 0.15, // initiative gaps signal stuck agents
    cue: 0.12, // channel spread
    eri: 0.15, // emotional flatness = stagnation
    isd: 0.10, // intent success variety
    cns: 0.10, // conversation content novelty
};
/** Intervention cooldown — minimum pulses between stagnation interventions */
export const STAGNATION_INTERVENTION_COOLDOWN_PULSES = 20;
/** Window size for computing metrics */
export const STAGNATION_WINDOW_PULSES = 30;
export const ATTRACTOR_DETECTION_WINDOW_PULSES = 15;
/** Thresholds for individual attractor detection */
export const ATTRACTOR_THRESHOLDS = {
    message_loop: 0.70, // >70% of messages from only 2 agents
    silence_cascade: 0.60, // >60% of agent decisions are no_op
    single_topic_lock: 0.75, // >75% messages mention same entity
    dormant_agents: 0.50, // >50% agents idle
    private_channel_flood: 3, // absolute count
    reaction_only: 0.65, // >65% responses are reactions not text
};
//# sourceMappingURL=stagnation.js.map