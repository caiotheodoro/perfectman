import type {
  AgentState,
  PersonaConfig,
  RelationalState,
  EmotionDelta,
  SeededRng,
} from "@perfectman/shared";
import { clamp } from "@perfectman/shared";

/**
 * Rumination: internalized emotional replay without new events.
 *
 * Probability = mood-based × persona reactivity
 * Effect: intensify unresolved relational emotions (resentment, suspicion,
 * fearOfExclusion) without creating synthetic evidence.
 * Cooldown prevents runaway.
 *
 * Returns updated relationalStates + modified emotionDelta.
 */

const RUMINATION_BASE_PROBABILITY = 0.15;
const RUMINATION_COOLDOWN_PULSES = 4;
const RUMINATION_INTENSIFY_FACTOR = 1.08; // multiply targeted dimensions by this

/** Tracks last rumination per agent (in-process state, not persisted) */
const ruminationCooldowns = new Map<string, number>(); // agentId → lastRuminationPulse

export function applyRumination(
  agentState: AgentState,
  persona: PersonaConfig,
  emotionDelta: EmotionDelta,
  rng: SeededRng,
  pulseIndex: number,
  hasNewEvents: boolean,
): {
  updatedRelationalStates: Map<string, RelationalState>;
  emotionDelta: EmotionDelta;
} {
  // No rumination when there are new events to process
  if (hasNewEvents) {
    return {
      updatedRelationalStates: agentState.relationalStates,
      emotionDelta: { ...emotionDelta, ruminationApplied: false },
    };
  }

  // Cooldown check
  const lastRuminated = ruminationCooldowns.get(agentState.agentId) ?? -Infinity;
  if (pulseIndex - lastRuminated < RUMINATION_COOLDOWN_PULSES) {
    return {
      updatedRelationalStates: agentState.relationalStates,
      emotionDelta: { ...emotionDelta, ruminationApplied: false },
    };
  }

  // Probability driven by negative mood + persona reactivity
  const mood = agentState.coreMood;
  const negativeMoodFactor = Math.max(0, -mood.valence); // 0..1
  const instabilityFactor = 1 - mood.stability;         // 0..1
  const probability = clamp(
    RUMINATION_BASE_PROBABILITY +
    negativeMoodFactor * 0.20 +
    instabilityFactor * 0.15 +
    persona.emotionalReactivity * 0.05,
    0,
    0.70,
  );

  if (rng.next() > probability) {
    return {
      updatedRelationalStates: agentState.relationalStates,
      emotionDelta: { ...emotionDelta, ruminationApplied: false },
    };
  }

  // Rumination fires — intensify unresolved relational emotions
  const updated = new Map<string, RelationalState>(
    [...agentState.relationalStates.entries()].map(([id, rel]) => [id, { ...rel }]),
  );

  // Only intensify agents with unresolved negative relational state
  for (const [targetId, rel] of updated.entries()) {
    const isUnresolved =
      rel.resentment > 0.2 ||
      rel.suspicion > 0.2 ||
      (rel.lastNegativeAt !== null && rel.trust < 0);

    if (!isUnresolved) continue;

    updated.set(targetId, {
      ...rel,
      resentment: clamp(rel.resentment * RUMINATION_INTENSIFY_FACTOR, 0, 1),
      suspicion:  clamp(rel.suspicion  * RUMINATION_INTENSIFY_FACTOR, 0, 1),
    });
  }

  // Also slightly intensify L2 fearOfExclusion if agent has relational distress
  const hasRelationalDistress = [...updated.values()].some(r => r.resentment > 0.3 || r.suspicion > 0.3);
  if (hasRelationalDistress) {
    // We modify emotionDelta to reflect this — actual L2 update happens in emotion stack
    const currentFearDelta = emotionDelta.socialEmotionDeltas.fearOfExclusion ?? 0;
    emotionDelta = {
      ...emotionDelta,
      socialEmotionDeltas: {
        ...emotionDelta.socialEmotionDeltas,
        fearOfExclusion: currentFearDelta + 0.03,
      },
    };
  }

  ruminationCooldowns.set(agentState.agentId, pulseIndex);

  return {
    updatedRelationalStates: updated,
    emotionDelta: { ...emotionDelta, ruminationApplied: true },
  };
}
