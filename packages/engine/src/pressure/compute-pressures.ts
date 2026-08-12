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
/**
 * Salience cap: a person feels a FEW salient urges, not all fifteen at once.
 * Without this, neutral states leak every action emotion past the threshold
 * (baseline terms in compute-action-emotions) and the pressure signal
 * carries no discrimination. Keep the top N by intensity.
 */
const MAX_SALIENT_PRESSURES = 3;

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

  const unique = [...byType.values()].sort(
    (a, b) => intensityRank(b.intensity) - intensityRank(a.intensity),
  );

  // Private-motive pressure: intimacy AND strategic drives both move to
  // private channels (docs' 17 motives: liking/curiosity/flirt/comfort are
  // intimacy-shaped; gossip/status/control/secrecy/alliance are strategic).
  // ACTION_PRESSURE_MAP alone under-fires it (vulnerableRetreat needs a
  // negative state).
  const privateDrive = privateMotiveIntensity(agentState);
  if (privateDrive.drive >= PRESSURE_THRESHOLD) {
    const existing = unique.find(p => p.type === "urge_to_create_private_channel");
    const targetIds = closestTargets(agentState);
    if (!existing) {
      unique.push({
        id: nextId(),
        agentId: agentState.agentId,
        type: "urge_to_create_private_channel",
        targetAgentIds: targetIds,
        intensity: toIntensityLabel(privateDrive.drive),
        sourceEventIds,
        sourceMotivations: privateDrive.intimacySourced ? ["desireForIntimacy"] : ["desireForStatus"],
        sourceEmotions: privateDrive.intimacySourced ? ["desireForIntimacy"] : ["suspicion"],
        visibilityPreference: "private",
        decayRate: 0.15,
      });
    } else {
      existing.intensity = toIntensityLabel(privateDrive.drive);
      existing.targetAgentIds = targetIds;
      existing.sourceMotivations = privateDrive.intimacySourced ? ["desireForIntimacy"] : ["desireForStatus"];
      existing.sourceEmotions = privateDrive.intimacySourced ? ["desireForIntimacy"] : ["suspicion"];
    }
    // Re-sort so the private drive competes for salience on equal intensity,
    // and give it the tie edge when it is the dominant felt motive.
    unique.sort(
      (a, b) =>
        intensityRank(b.intensity) - intensityRank(a.intensity) ||
        (b.type === "urge_to_create_private_channel" ? 1 : 0) -
          (a.type === "urge_to_create_private_channel" ? 1 : 0),
    );
  }

  // Salience: only the strongest few urges are felt strongly enough to act on.
  return unique.slice(0, MAX_SALIENT_PRESSURES);
}

function privateMotiveIntensity(agentState: AgentState): { drive: number; intimacySourced: boolean } {
  const social = agentState.socialEmotions;
  const rels = [...agentState.relationalStates.values()];
  const maxCloseness = rels.length > 0
    ? Math.max(...rels.map(r => r.desireForCloseness))
    : 0;
  const maxWarmth = rels.length > 0
    ? Math.max(...rels.map(r => r.affection * 0.3 + r.comfort * 0.25 + r.curiosity * 0.45))
    : 0;
  const maxRelResentment = rels.length > 0
    ? Math.max(...rels.map(r => r.resentment))
    : 0;
  const maxRelSuspicion = rels.length > 0
    ? Math.max(...rels.map(r => r.suspicion))
    : 0;
  const maxRelAvoidance = rels.length > 0
    ? Math.max(...rels.map(r => r.desireForDistance))
    : 0;
  const maxRelThreat = rels.length > 0
    ? Math.max(...rels.map(r => r.threat))
    : 0;

  const intimacyTerm = 0.35 * maxCloseness + 0.35 * maxWarmth + 0.3 * social.desireForIntimacy;
  const strategicTerm = 0.4 * social.desireForStatus + 0.3 * social.suspicion + 0.2 * maxRelSuspicion + 0.1 * maxRelResentment + 0.35 * maxRelAvoidance;
  // Anchor: the drive needs REAL signals, not default relational states
  // (defaults are curiosity 0.3 / comfort 0.5 — not enough to want privacy).
  const realDraw =
    maxCloseness >= 0.45 ||
    maxWarmth >= 0.4 ||
    social.desireForIntimacy >= 0.4 ||
    social.desireForStatus >= 0.6 ||
    social.suspicion >= 0.5 ||
    maxRelSuspicion >= 0.5 ||
    maxRelResentment >= 0.5 ||
    // Avoidance is a private-channel motive too: fleeing a threatening
    // presence is exactly when you move somewhere they aren't.
    maxRelAvoidance >= 0.7 ||
    maxRelThreat >= 0.6;
  if (!realDraw) return { drive: 0, intimacySourced: false };
  const intimacySourced = intimacyTerm >= strategicTerm;
  // Intimacy-sourced drives are a genuine human pull (liking, curiosity,
  // flirt, comfort) — they win over generic chat urges. Strategic drives
  // (status/suspicion scheming) stay at base scale.
  const scale = intimacySourced ? 1.5 : 1.35;
  return { drive: Math.max(intimacyTerm, strategicTerm) * scale, intimacySourced };
}

function closestTargets(agentState: AgentState): string[] {
  const rels = [...agentState.relationalStates.values()]
    .sort((a, b) => (b.desireForCloseness + b.affection + b.curiosity) - (a.desireForCloseness + a.affection + a.curiosity));
  return rels.slice(0, 2).map(r => r.targetAgentId);
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
