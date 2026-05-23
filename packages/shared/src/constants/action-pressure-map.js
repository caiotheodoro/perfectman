/**
 * 15 ActionEmotion → Pressure/Inhibition mappings.
 * Each entry maps an L4 action emotion to the pressure type it generates
 * and optionally an inhibition type it can also activate.
 *
 * Engine reads this table in compute-pressures.ts and compute-inhibitions.ts.
 */
export const ACTION_PRESSURE_MAP = [
    {
        actionEmotion: "warmth",
        pressureType: "social_reach",
        visibilityBias: "either",
        pressureWeight: 1.2,
    },
    {
        actionEmotion: "curiousApproach",
        pressureType: "question_ask",
        visibilityBias: "public",
        pressureWeight: 1.0,
    },
    {
        actionEmotion: "defensiveness",
        pressureType: "self_defense",
        visibilityBias: "public",
        inhibitionType: "conflict_avoidance",
        pressureWeight: 1.3,
        inhibitionWeight: 0.8,
    },
    {
        actionEmotion: "jealousInspection",
        pressureType: "monitor_target",
        visibilityBias: "private",
        inhibitionType: "social_cost_awareness",
        pressureWeight: 1.1,
        inhibitionWeight: 1.0,
    },
    {
        actionEmotion: "shameWithdrawal",
        pressureType: "withdraw",
        visibilityBias: "private",
        inhibitionType: "self_censorship",
        pressureWeight: 0.9,
        inhibitionWeight: 1.4,
    },
    {
        actionEmotion: "resentfulColdness",
        pressureType: "passive_withdraw",
        visibilityBias: "private",
        inhibitionType: "conflict_avoidance",
        pressureWeight: 0.8,
        inhibitionWeight: 0.9,
    },
    {
        actionEmotion: "anxiousOverreach",
        pressureType: "over_communicate",
        visibilityBias: "public",
        inhibitionType: "embarrassment_risk",
        pressureWeight: 1.2,
        inhibitionWeight: 1.3,
    },
    {
        actionEmotion: "pridefulPerformance",
        pressureType: "show_off",
        visibilityBias: "public",
        pressureWeight: 1.4,
    },
    {
        actionEmotion: "vulnerableRetreat",
        pressureType: "seek_private",
        visibilityBias: "private",
        inhibitionType: "vulnerability_guard",
        pressureWeight: 0.9,
        inhibitionWeight: 1.2,
    },
    {
        actionEmotion: "contemptuousDismissal",
        pressureType: "ignore_target",
        visibilityBias: "either",
        inhibitionType: "norm_compliance",
        pressureWeight: 1.0,
        inhibitionWeight: 0.7,
    },
    {
        actionEmotion: "strategicPatience",
        pressureType: "delay_action",
        visibilityBias: "private",
        pressureWeight: 0.7,
    },
    {
        actionEmotion: "impulsiveProvocation",
        pressureType: "provoke",
        visibilityBias: "public",
        inhibitionType: "conflict_avoidance",
        pressureWeight: 1.5,
        inhibitionWeight: 0.6,
    },
    {
        actionEmotion: "comfortSeeking",
        pressureType: "seek_support",
        visibilityBias: "private",
        pressureWeight: 1.1,
    },
    {
        actionEmotion: "dominanceAssertion",
        pressureType: "assert_position",
        visibilityBias: "public",
        inhibitionType: "social_cost_awareness",
        pressureWeight: 1.3,
        inhibitionWeight: 0.8,
    },
    {
        actionEmotion: "repairImpulse",
        pressureType: "repair_relation",
        visibilityBias: "either",
        pressureWeight: 1.2,
    },
];
/** Get the pressure entry for a given action emotion */
export function getActionPressureEntry(actionEmotion) {
    return ACTION_PRESSURE_MAP.find(e => e.actionEmotion === actionEmotion);
}
//# sourceMappingURL=action-pressure-map.js.map