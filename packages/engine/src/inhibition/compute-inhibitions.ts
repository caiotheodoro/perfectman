import type {
  AgentState,
  PersonaConfig,
  ActionEmotions,
  Inhibition,
  InhibitionType,
  InhibitionStrength,
} from "@perfectman/shared";

const INHIBITION_THRESHOLD = 0.20;

type InhibitionSignal = {
  type: InhibitionType;
  score: number;
  reason: string;
};

/**
 * Compute inhibitions from persona sensitivities + social state + action emotions.
 * Inhibitions are blocks that prevent or suppress urges (pressures).
 * 14 inhibition types.
 */
export function computeInhibitions(
  agentState: AgentState,
  persona: PersonaConfig,
  actionEmotions: ActionEmotions,
): Inhibition[] {
  const social = agentState.socialEmotions;
  const mood = agentState.coreMood;
  const rels = [...agentState.relationalStates.values()];

  const avgSuspicion = rels.length > 0
    ? rels.reduce((s, r) => s + r.suspicion, 0) / rels.length
    : 0;
  const avgTrust = rels.length > 0
    ? rels.reduce((s, r) => s + (r.trust + 1) / 2, 0) / rels.length
    : 0.5;

  const signals: InhibitionSignal[] = [
    // fear_of_looking_needy — high neediness + self-awareness
    {
      type:   "fear_of_looking_needy",
      score:  social.neediness * persona.intimacySensitivity / 3,
      reason: "Worried about coming across as needy or overly eager.",
    },

    // fear_of_escalating — conflict sensitivity + resentment
    {
      type:   "fear_of_escalating",
      score:  persona.conflictSensitivity / 3 * social.resentment,
      reason: "Nervous about making things worse — the tension feels fragile.",
    },

    // fear_of_rejection — exclusion sensitivity + low trust
    {
      type:   "fear_of_rejection",
      score:  persona.exclusionSensitivity / 3 * (1 - avgTrust),
      reason: "Afraid of reaching out and being ignored or turned down.",
    },

    // fear_of_exclusion_worsening — high fearOfExclusion
    {
      type:   "fear_of_exclusion_worsening",
      score:  social.fearOfExclusion * persona.exclusionSensitivity / 3,
      reason: "Acting might draw attention to the exclusion or make it worse.",
    },

    // shame_about_desire — shame + desire for intimacy mismatch
    {
      type:   "shame_about_desire",
      score:  social.shame * 0.5 + actionEmotions.shameWithdrawal * 0.5,
      reason: "The want feels embarrassing — not sure it's okay to show it.",
    },

    // social_anxiety_block — social anxiety + high arousal
    {
      type:   "social_anxiety_block",
      score:  social.socialAnxiety * 0.6 + mood.arousal * social.socialAnxiety * 0.4,
      reason: "Something is holding back — a general dread about how this might land.",
    },

    // status_protection — high status desire + risk of looking bad
    {
      type:   "status_protection",
      score:  social.desireForStatus * actionEmotions.strategicPatience * 0.5,
      reason: "Don't want to say something that makes you look uncool or out of touch.",
    },

    // conflict_avoidance — conflict sensitivity
    {
      type:   "conflict_avoidance",
      score:  persona.conflictSensitivity / 3 * (1 - actionEmotions.impulsiveProvocation),
      reason: "Just don't want a fight right now — not worth it.",
    },

    // vulnerability_guard — fear of openness
    {
      type:   "vulnerability_guard",
      score:  actionEmotions.vulnerableRetreat * (1 - avgTrust),
      reason: "Not sure it's safe to be open here — might get used against you.",
    },

    // contempt_concealment — high contempt but social norms
    {
      type:   "contempt_concealment",
      score:  social.contempt * 0.7,
      reason: "Feeling contemptuous but it would be rude — or strategic — to hide it.",
    },

    // strategic_patience_hold — strategic patience action emotion
    {
      type:   "strategic_patience_hold",
      score:  actionEmotions.strategicPatience,
      reason: "Better to wait and see — acting now might not serve you.",
    },

    // intimacy_fear — desire for intimacy + fear of closeness
    {
      type:   "intimacy_fear",
      score:  social.desireForIntimacy * avgSuspicion,
      reason: "Want to be closer but something holds you back — not sure you can trust it.",
    },

    // performance_anxiety — pride performance + embarrassment risk
    {
      type:   "performance_anxiety",
      score:  actionEmotions.pridefulPerformance * social.humiliation,
      reason: "Want to show off but scared of falling flat or looking stupid.",
    },

    // repair_doubt — repair impulse but uncertain it'll work
    {
      type:   "repair_doubt",
      score:  actionEmotions.repairImpulse * (1 - avgTrust) * 0.5,
      reason: "Would like to fix things, but not sure it'll go well — maybe it'll just make it awkward.",
    },
  ];

  return signals
    .filter(s => s.score >= INHIBITION_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map(s => ({
      id:               `${agentState.agentId}:${s.type}`,
      agentId:          agentState.agentId,
      type:             s.type,
      strength:         toStrength(s.score),
      reason:           s.reason,
    }));
}

function toStrength(score: number): InhibitionStrength {
  if (score >= 0.65) return "high";
  if (score >= 0.40) return "medium";
  return "low";
}
