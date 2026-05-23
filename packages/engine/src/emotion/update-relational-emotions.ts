import type {
  RelationalState,
  CommittedEvent,
  CoreMood,
  PersonaConfig,
} from "@perfectman/shared";
import { clamp, RELATIONAL_UPDATE_RULES } from "@perfectman/shared";

/**
 * Update L3 RelationalStates per pair (observer → target).
 * Asymmetric — each agent's view of each other agent updated independently.
 *
 * Steps:
 *   1. Apply relational update rules triggered by events
 *   2. Mood-congruent distortion (negative mood → worse interpretation)
 *   3. Increment interactionCount for direct interactions
 *   4. Clamp all dimensions
 */
export function updateRelationalEmotions(
  current: Map<string, RelationalState>,
  events: CommittedEvent[],
  observerId: string,
  mood: CoreMood,
  persona: PersonaConfig,
  now: number,
): Map<string, RelationalState> {
  const updated = new Map<string, RelationalState>(
    [...current.entries()].map(([k, v]) => [k, { ...v }]),
  );

  for (const event of events) {
    // Build the set of agents involved in this event
    const personTargets = event.payload["personTargets"] as string[] | undefined ?? [];
    const mentionedAgentIds = event.payload["mentionedAgentIds"] as string[] | undefined ?? [];
    const invitedAgentIds = event.payload["invitedAgentIds"] as string[] | undefined ?? [];

    // Determine target agents (those this event creates relational updates about)
    const targetIds = new Set<string>();
    if (event.actorId !== observerId) targetIds.add(event.actorId);
    for (const id of [...personTargets, ...mentionedAgentIds, ...invitedAgentIds]) {
      if (id !== observerId) targetIds.add(id);
    }

    // Observer role
    const isActor = event.actorId === observerId;
    const isTarget = personTargets.includes(observerId) || mentionedAgentIds.includes(observerId);
    const isBystander = !isActor && !isTarget;

    for (const rule of RELATIONAL_UPDATE_RULES) {
      const roleMatches =
        (rule.trigger === event.type || rule.trigger === event.type) &&
        ((rule.role === "actor" && isActor) ||
         (rule.role === "target" && isTarget) ||
         (rule.role === "bystander" && isBystander));

      if (!roleMatches) continue;

      // Apply rule to all relevant target agents
      const affectedTargets: string[] = [];
      if (rule.role === "target") {
        // Update observer's view of the actor
        if (event.actorId !== observerId) affectedTargets.push(event.actorId);
      } else if (rule.role === "bystander") {
        // Bystander updates view of whoever was involved
        for (const id of targetIds) affectedTargets.push(id);
      } else {
        // Actor updates view of targets
        for (const id of [...personTargets, ...mentionedAgentIds]) {
          if (id !== observerId) affectedTargets.push(id);
        }
      }

      for (const targetId of affectedTargets) {
        const existing: RelationalState = updated.get(targetId) ?? makeDefaultRelational(targetId);
        const scale = rule.magnitude;

        const moodDistortion = mood.valence < -0.3
          ? 1 + Math.abs(mood.valence) * 0.2
          : 1.0;

        updated.set(targetId, {
          ...existing,
          trust:             clamp(existing.trust + rule.trustDelta * scale, -1, 1),
          affection:         clamp(existing.affection + rule.affectionDelta * scale, 0, 1),
          resentment:        clamp(existing.resentment + rule.resentmentDelta * moodDistortion * scale, 0, 1),
          suspicion:         clamp(existing.suspicion + rule.suspicionDelta * moodDistortion * scale, 0, 1),
          comfort:           clamp(existing.comfort + rule.comfortDelta * scale, 0, 1),
          curiosity:         clamp(existing.curiosity + rule.curiosityDelta * scale, 0, 1),
          desireForCloseness: clamp(existing.desireForCloseness + rule.desireForClosenessDelta * scale, 0, 1),
          desireForDistance:  clamp(existing.desireForDistance + rule.desireForDistanceDelta * scale, 0, 1),
          interactionCount:   existing.interactionCount + 1,
          lastInteractionAt:  now,
          lastPositiveAt:
            rule.trustDelta > 0 || rule.affectionDelta > 0 ? now : existing.lastPositiveAt,
          lastNegativeAt:
            rule.resentmentDelta > 0 || rule.suspicionDelta > 0 ? now : existing.lastNegativeAt,
        });
      }
    }
  }

  return updated;
}

function makeDefaultRelational(targetAgentId: string): RelationalState {
  return {
    targetAgentId,
    trust:              0.0,
    affection:          0.2,
    resentment:         0.0,
    attraction:         0.0,
    suspicion:          0.0,
    admiration:         0.0,
    envy:               0.0,
    comfort:            0.2,
    threat:             0.0,
    curiosity:          0.3,
    desireForCloseness: 0.2,
    desireForDistance:  0.0,
    interactionCount:   0,
    lastInteractionAt:  null,
    lastPositiveAt:     null,
    lastNegativeAt:     null,
  };
}
