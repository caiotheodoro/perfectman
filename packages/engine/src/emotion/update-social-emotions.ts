import type {
  SocialEmotions,
  CoreMood,
  PersonaConfig,
  CommittedEvent,
} from "@perfectman/shared";
import {
  clamp,
  EVENT_IMPULSE_TABLE,
  SOCIAL_EMOTION_DECAY,
} from "@perfectman/shared";

/**
 * Update L2 SocialEmotions given new events, core mood, and persona.
 *
 * 3 steps:
 *   1. Apply triggers from EVENT_IMPULSE_TABLE
 *   2. Mood-congruent amplification (negative valence boosts negative emotions)
 *   3. Per-dimension decay
 */
export function updateSocialEmotions(
  current: SocialEmotions,
  events: CommittedEvent[],
  agentId: string,
  mood: CoreMood,
  persona: PersonaConfig,
): SocialEmotions {
  const updated = { ...current } as Record<string, number>;

  // Step 1: Apply triggers from event impulse table
  for (const event of events) {
    for (const rule of EVENT_IMPULSE_TABLE) {
      if (rule.eventType !== event.type) continue;

      // Determine if this agent matches the role
      const isActor = event.actorId === agentId;
      const personTargets = event.payload["personTargets"] as string[] | undefined ?? [];
      const mentionedAgentIds = event.payload["mentionedAgentIds"] as string[] | undefined ?? [];
      const isTarget = personTargets.includes(agentId) || mentionedAgentIds.includes(agentId);
      const isBystander = !isActor && !isTarget;

      const roleMatches =
        (rule.role === "actor" && isActor) ||
        (rule.role === "target" && isTarget) ||
        (rule.role === "bystander" && isBystander);

      if (!roleMatches) continue;

      const scale = rule.magnitude * persona.emotionalReactivity;

      for (const dim of rule.affectedDimensions) {
        if (dim in updated) {
          // Use valence of impulse to determine direction relative to the emotion
          const sensitivity = (persona.socialSensitivities[dim] ?? 1.0);
          const delta = rule.valenceShift > 0
            ? rule.magnitude * scale * sensitivity  // positive = increase positive emotions
            : Math.abs(rule.valenceShift) * scale * sensitivity; // negative = increase negative emotions
          updated[dim] = clamp((updated[dim] ?? 0) + delta, 0, 1);
        }
      }
    }
  }

  // Step 2: Mood-congruent amplification
  // Negative valence boosts negative-valence emotions; positive boosts positive
  const moodCongruence = -mood.valence; // negative → amplify negative emotions
  if (Math.abs(moodCongruence) > 0.2) {
    const NEGATIVE_DIMS = ["jealousy", "envy", "humiliation", "shame", "resentment",
                           "suspicion", "contempt", "neediness", "socialAnxiety", "fearOfExclusion"];
    const POSITIVE_DIMS = ["pride", "affection", "admiration", "desireForStatus", "desireForIntimacy"];
    const ampFactor = 1 + Math.abs(moodCongruence) * 0.15;

    for (const dim of moodCongruence > 0 ? NEGATIVE_DIMS : POSITIVE_DIMS) {
      if (dim in updated) {
        updated[dim] = clamp((updated[dim] ?? 0) * ampFactor, 0, 1);
      }
    }
  }

  // Step 3: Per-dimension decay
  for (const [dim, decay] of Object.entries(SOCIAL_EMOTION_DECAY)) {
    if (dim in updated) {
      updated[dim] = clamp((updated[dim] ?? 0) * decay, 0, 1);
    }
  }

  return updated as SocialEmotions;
}
