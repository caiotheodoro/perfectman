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
export declare const STAGNATION_THRESHOLDS: Readonly<StagnationThresholds>;
/** Composite score = sum(weight_i * metric_i) — must sum to 1.0 */
export type StagnationWeights = {
    bdi: number;
    rdv: number;
    ige: number;
    cue: number;
    eri: number;
    isd: number;
    cns: number;
};
export declare const STAGNATION_WEIGHTS: Readonly<StagnationWeights>;
/** Intervention cooldown — minimum pulses between stagnation interventions */
export declare const STAGNATION_INTERVENTION_COOLDOWN_PULSES = 20;
/** Window size for computing metrics */
export declare const STAGNATION_WINDOW_PULSES = 30;
/**
 * 6 attractor state signatures (behavioral patterns indicating stagnation).
 * Engine detects these to supplement the composite score.
 */
export type AttractorState = "message_loop" | "silence_cascade" | "single_topic_lock" | "dormant_agents" | "private_channel_flood" | "reaction_only";
export declare const ATTRACTOR_DETECTION_WINDOW_PULSES = 15;
/** Thresholds for individual attractor detection */
export declare const ATTRACTOR_THRESHOLDS: Readonly<Record<AttractorState, number>>;
//# sourceMappingURL=stagnation.d.ts.map