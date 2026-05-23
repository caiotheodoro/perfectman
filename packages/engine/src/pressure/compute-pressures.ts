import type {
  ActionEmotions,
  AgentState,
  Pressure,
  PressureType,
  PressureIntensity,
  VisibilityPreference,
} from "@perfectman/shared";
import { ACTION_PRESSURE_MAP } from "@perfectman/shared";

const PRESSURE_THRESHOLD = 0.20;

type PressureTypeMapping = {
  actionEmotion: keyof ActionEmotions;
  pressureType: PressureType;
  visibilityBias: VisibilityPreference;
  weight: number;
};

// Map from action-pressure-map to concrete PressureType labels
const PRESSURE_MAPPINGS: PressureTypeMapping[] = [
  { actionEmotion: "warmth",               pressureType: "urge_to_message",               visibilityBias: "either",  weight: 1.2 },
  { actionEmotion: "curiousApproach",      pressureType: "urge_to_message",               visibilityBias: "public",  weight: 1.0 },
  { actionEmotion: "defensiveness",        pressureType: "urge_to_defend_self",           visibilityBias: "public",  weight: 1.3 },
  { actionEmotion: "jealousInspection",    pressureType: "urge_to_invite",                visibilityBias: "private", weight: 1.1 },
  { actionEmotion: "shameWithdrawal",      pressureType: "urge_to_withdraw",              visibilityBias: "hidden",  weight: 0.9 },
  { actionEmotion: "resentfulColdness",    pressureType: "urge_to_withdraw",              visibilityBias: "private", weight: 0.8 },
  { actionEmotion: "anxiousOverreach",     pressureType: "urge_to_reply",                 visibilityBias: "public",  weight: 1.2 },
  { actionEmotion: "pridefulPerformance",  pressureType: "urge_to_show_off",              visibilityBias: "public",  weight: 1.4 },
  { actionEmotion: "vulnerableRetreat",    pressureType: "urge_to_create_private_channel",visibilityBias: "private", weight: 0.9 },
  { actionEmotion: "contemptuousDismissal",pressureType: "urge_to_withdraw",              visibilityBias: "either",  weight: 1.0 },
  { actionEmotion: "strategicPatience",    pressureType: "urge_to_type",                  visibilityBias: "private", weight: 0.7 },
  { actionEmotion: "impulsiveProvocation", pressureType: "urge_to_provoke",               visibilityBias: "public",  weight: 1.5 },
  { actionEmotion: "comfortSeeking",       pressureType: "urge_to_seek_comfort",          visibilityBias: "private", weight: 1.1 },
  { actionEmotion: "dominanceAssertion",   pressureType: "urge_to_dominate",              visibilityBias: "public",  weight: 1.3 },
  { actionEmotion: "repairImpulse",        pressureType: "urge_to_repair",                visibilityBias: "either",  weight: 1.2 },
];

let pressureIdCounter = 0;
function nextId(): string {
  return `p${++pressureIdCounter}`;
}

export function computePressures(
  agentState: AgentState,
  actionEmotions: ActionEmotions,
  sourceEventIds: string[],
): Pressure[] {
  const pressures: Pressure[] = [];

  for (const mapping of PRESSURE_MAPPINGS) {
    const value = actionEmotions[mapping.actionEmotion] as number;
    const intensity = value * mapping.weight;

    if (intensity < PRESSURE_THRESHOLD) continue;

    pressures.push({
      id:                  nextId(),
      agentId:             agentState.agentId,
      type:                mapping.pressureType,
      targetAgentIds:      [],
      intensity:           toIntensityLabel(intensity),
      sourceEventIds,
      sourceMotivations:   [],
      sourceEmotions:      [mapping.actionEmotion],
      visibilityPreference: mapping.visibilityBias,
      decayRate:           0.15,
    });
  }

  // Deduplicate by type — keep highest intensity
  const byType = new Map<PressureType, Pressure>();
  for (const p of pressures) {
    const existing = byType.get(p.type);
    if (!existing || intensityRank(p.intensity) > intensityRank(existing.intensity)) {
      byType.set(p.type, p);
    }
  }

  return [...byType.values()].sort(
    (a, b) => intensityRank(b.intensity) - intensityRank(a.intensity),
  );
}

function toIntensityLabel(v: number): PressureIntensity {
  if (v >= 0.85) return "overwhelming";
  if (v >= 0.60) return "high";
  if (v >= 0.35) return "medium";
  return "low";
}

function intensityRank(i: PressureIntensity): number {
  return { low: 0, medium: 1, high: 2, overwhelming: 3 }[i];
}
