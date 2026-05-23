/**
 * 15 ActionEmotion → Pressure/Inhibition mappings.
 * pressureType and inhibitionType use canonical union values from
 * pressure.types.ts and inhibition.types.ts respectively.
 */
import type { PressureType } from "../pressure/pressure.types.js";
import type { InhibitionType } from "../inhibition/inhibition.types.js";

export type ActionPressureEntry = {
  actionEmotion:     string;
  pressureType:      PressureType;
  visibilityBias:    "public" | "private" | "either" | "hidden";
  inhibitionType?:   InhibitionType;
  pressureWeight:    number;
  inhibitionWeight?: number;
};

export const ACTION_PRESSURE_MAP: readonly ActionPressureEntry[] = [
  {
    actionEmotion:   "warmth",
    pressureType:    "urge_to_message",
    visibilityBias:  "either",
    pressureWeight:  1.2,
  },
  {
    actionEmotion:   "curiousApproach",
    pressureType:    "urge_to_message",
    visibilityBias:  "public",
    pressureWeight:  1.0,
  },
  {
    actionEmotion:   "defensiveness",
    pressureType:    "urge_to_defend_self",
    visibilityBias:  "public",
    inhibitionType:  "conflict_avoidance",
    pressureWeight:  1.3,
    inhibitionWeight: 0.8,
  },
  {
    actionEmotion:   "jealousInspection",
    pressureType:    "urge_to_invite",
    visibilityBias:  "private",
    inhibitionType:  "status_protection",
    pressureWeight:  1.1,
    inhibitionWeight: 1.0,
  },
  {
    actionEmotion:   "shameWithdrawal",
    pressureType:    "urge_to_withdraw",
    visibilityBias:  "hidden",
    inhibitionType:  "shame_about_desire",
    pressureWeight:  0.9,
    inhibitionWeight: 1.4,
  },
  {
    actionEmotion:   "resentfulColdness",
    pressureType:    "urge_to_withdraw",
    visibilityBias:  "private",
    inhibitionType:  "conflict_avoidance",
    pressureWeight:  0.8,
    inhibitionWeight: 0.9,
  },
  {
    actionEmotion:   "anxiousOverreach",
    pressureType:    "urge_to_reply",
    visibilityBias:  "public",
    inhibitionType:  "performance_anxiety",
    pressureWeight:  1.2,
    inhibitionWeight: 1.3,
  },
  {
    actionEmotion:   "pridefulPerformance",
    pressureType:    "urge_to_show_off",
    visibilityBias:  "public",
    pressureWeight:  1.4,
  },
  {
    actionEmotion:   "vulnerableRetreat",
    pressureType:    "urge_to_create_private_channel",
    visibilityBias:  "private",
    inhibitionType:  "vulnerability_guard",
    pressureWeight:  0.9,
    inhibitionWeight: 1.2,
  },
  {
    actionEmotion:   "contemptuousDismissal",
    pressureType:    "urge_to_withdraw",
    visibilityBias:  "either",
    inhibitionType:  "contempt_concealment",
    pressureWeight:  1.0,
    inhibitionWeight: 0.7,
  },
  {
    actionEmotion:   "strategicPatience",
    pressureType:    "urge_to_type",
    visibilityBias:  "private",
    pressureWeight:  0.7,
  },
  {
    actionEmotion:   "impulsiveProvocation",
    pressureType:    "urge_to_provoke",
    visibilityBias:  "public",
    inhibitionType:  "conflict_avoidance",
    pressureWeight:  1.5,
    inhibitionWeight: 0.6,
  },
  {
    actionEmotion:   "comfortSeeking",
    pressureType:    "urge_to_seek_comfort",
    visibilityBias:  "private",
    pressureWeight:  1.1,
  },
  {
    actionEmotion:   "dominanceAssertion",
    pressureType:    "urge_to_dominate",
    visibilityBias:  "public",
    inhibitionType:  "status_protection",
    pressureWeight:  1.3,
    inhibitionWeight: 0.8,
  },
  {
    actionEmotion:   "repairImpulse",
    pressureType:    "urge_to_repair",
    visibilityBias:  "either",
    pressureWeight:  1.2,
  },
];

/** Get the pressure entry for a given action emotion */
export function getActionPressureEntry(actionEmotion: string): ActionPressureEntry | undefined {
  return ACTION_PRESSURE_MAP.find(e => e.actionEmotion === actionEmotion);
}
