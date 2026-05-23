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

  for (const mapping of ACTION_PRESSURE_MAP) {
    const value = actionEmotions[mapping.actionEmotion as keyof ActionEmotions] as number;
    if (value === undefined) continue;
    const intensity = value * mapping.pressureWeight;
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
      visibilityPreference: mapping.visibilityBias as VisibilityPreference,
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
