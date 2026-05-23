import type {
  AgentState,
  PersonaConfig,
  CommittedEvent,
  ActionEmotions,
  EmotionDelta,
  SocialEmotions,
  RelationalState,
} from "@perfectman/shared";
import { EVENT_IMPULSE_TABLE } from "@perfectman/shared";
import { updateCoreMood } from "./update-core-mood.js";
import { updateSocialEmotions } from "./update-social-emotions.js";
import { updateRelationalEmotions } from "./update-relational-emotions.js";
import { computeActionEmotions } from "./compute-action-emotions.js";

export type EmotionStackResult = {
  updatedState: Pick<AgentState, "coreMood" | "socialEmotions" | "relationalStates">;
  actionEmotions: ActionEmotions;
  emotionDelta: EmotionDelta;
};

/**
 * 8-step emotion stack cycle:
 *   1. Collect MoodImpulses from new events via EVENT_IMPULSE_TABLE
 *   2. Update L2 SocialEmotions (triggers × persona sensitivity, decay, mood-congruent amplification)
 *   3. Update L3 RelationalEmotions (per-pair asymmetric, mood-congruent distortion)
 *   4. Aggregate L3→L2 feedback
 *   5. Update L1 CoreMood (damped spring, angular constraint, shock override, energy/stability)
 *   6. Compute L4 ActionEmotions (15 formulas from mood+social+relational)
 *   7. Clamp all values (done inside each sub-function)
 *   8. Compute EmotionDelta summary
 */
export function updateEmotionStack(
  agentState: AgentState,
  persona: PersonaConfig,
  newEvents: CommittedEvent[],
  dt: number,
  now: number,
): EmotionStackResult {
  // Step 1: Collect MoodImpulses from events
  const impulses = collectImpulses(agentState.agentId, newEvents);

  // Step 2: Update L2 SocialEmotions
  const newSocial = updateSocialEmotions(
    agentState.socialEmotions,
    newEvents,
    agentState.agentId,
    agentState.coreMood,
    persona,
  );

  // Step 3: Update L3 RelationalEmotions
  const newRelational = updateRelationalEmotions(
    agentState.relationalStates,
    newEvents,
    agentState.agentId,
    agentState.coreMood,
    persona,
    now,
  );

  // Step 4: L3→L2 feedback: average resentment/trust from relational affects L2 resentment/suspicion
  const feedbackSocial = applyRelationalFeedback(newSocial, newRelational);

  // Step 5: Update L1 CoreMood
  const newMood = updateCoreMood(agentState.coreMood, impulses, persona, dt);

  // Step 6: Compute L4 ActionEmotions
  const actionEmotions = computeActionEmotions(newMood, feedbackSocial, newRelational);

  // Step 8: EmotionDelta
  const emotionDelta: EmotionDelta = {
    coreMoodDelta: {
      valence:   newMood.valence   - agentState.coreMood.valence,
      arousal:   newMood.arousal   - agentState.coreMood.arousal,
      stability: newMood.stability - agentState.coreMood.stability,
      energy:    newMood.energy    - agentState.coreMood.energy,
    },
    socialEmotionDeltas: computeSocialDelta(agentState.socialEmotions, feedbackSocial),
    relationalDeltas:    new Map(), // populated below
    ruminationApplied:   false,     // set by rumination module
  };

  for (const [targetId, newRel] of newRelational.entries()) {
    const old = agentState.relationalStates.get(targetId);
    if (old) {
      emotionDelta.relationalDeltas.set(targetId, {
        trust:      newRel.trust      - old.trust,
        affection:  newRel.affection  - old.affection,
        resentment: newRel.resentment - old.resentment,
      });
    } else {
      emotionDelta.relationalDeltas.set(targetId, { trust: newRel.trust, affection: newRel.affection });
    }
  }

  return {
    updatedState: {
      coreMood:        newMood,
      socialEmotions:  feedbackSocial,
      relationalStates: newRelational,
    },
    actionEmotions,
    emotionDelta,
  };
}

function collectImpulses(agentId: string, events: CommittedEvent[]) {
  const impulses = [];
  for (const event of events) {
    for (const rule of EVENT_IMPULSE_TABLE) {
      if (rule.eventType !== event.type) continue;
      const isActor = event.actorId === agentId;
      const personTargets = event.payload["personTargets"] as string[] | undefined ?? [];
      const mentions = event.payload["mentionedAgentIds"] as string[] | undefined ?? [];
      const isTarget = personTargets.includes(agentId) || mentions.includes(agentId);
      const isBystander = !isActor && !isTarget;
      const roleMatches =
        (rule.role === "actor" && isActor) ||
        (rule.role === "target" && isTarget) ||
        (rule.role === "bystander" && isBystander);
      if (!roleMatches) continue;
      impulses.push({
        deltaValence:  rule.valenceShift,
        deltaArousal:  rule.arousalShift,
        magnitude:     rule.magnitude,
        sourceEventId: event.id,
      });
    }
  }
  return impulses;
}

function applyRelationalFeedback(
  social: SocialEmotions,
  relational: Map<string, RelationalState>,
): SocialEmotions {
  const rels = [...relational.values()];
  if (rels.length === 0) return social;

  const avgRel_res = rels.reduce((s, r) => s + r.resentment, 0) / rels.length;
  const avgSuspicion = rels.reduce((s, r) => s + r.suspicion, 0) / rels.length;
  const avgAffection = rels.reduce((s, r) => s + r.affection, 0) / rels.length;

  // L3→L2: modulate L2 resentment, suspicion, affection by L3 averages (gentle 10% feedback)
  return {
    ...social,
    resentment: Math.min(1, social.resentment * 0.9 + avgRel_res * 0.1),
    suspicion:  Math.min(1, social.suspicion  * 0.9 + avgSuspicion * 0.1),
    affection:  Math.min(1, social.affection  * 0.9 + avgAffection * 0.1),
  };
}

function computeSocialDelta(
  old: SocialEmotions,
  updated: SocialEmotions,
): Partial<SocialEmotions> {
  const delta: Partial<SocialEmotions> = {};
  for (const key of Object.keys(old) as (keyof SocialEmotions)[]) {
    const d = updated[key] - old[key];
    if (Math.abs(d) > 0.001) delta[key] = d;
  }
  return delta;
}
