import type {
  CoreMood,
  SocialEmotions,
  RelationalState,
  ActionEmotions,
} from "@perfectman/shared";
import { clamp, meanOf } from "@perfectman/shared";

/**
 * Compute L4 ActionEmotions from L1+L2+L3.
 * 15 behavioral tendency formulas — each in [0, 1].
 * Not persisted; computed fresh every engine step.
 */
export function computeActionEmotions(
  mood: CoreMood,
  social: SocialEmotions,
  relationalStates: Map<string, RelationalState>,
): ActionEmotions {
  // Aggregate relational metrics
  const rels = [...relationalStates.values()];
  const avgThreat      = meanOf(rels.map(r => r.threat));
  const avgTrust       = meanOf(rels.map(r => (r.trust + 1) / 2)); // normalize [-1,1] → [0,1]
  const avgRel_res     = meanOf(rels.map(r => r.resentment));
  const avgComfort     = meanOf(rels.map(r => r.comfort));
  const avgAffection   = meanOf(rels.map(r => r.affection));
  const avgCuriosity   = meanOf(rels.map(r => r.curiosity));
  const avgCloseness   = meanOf(rels.map(r => r.desireForCloseness));
  const avgSuspicion   = meanOf(rels.map(r => r.suspicion));

  // Valence convenience [0,1]
  const valence01 = (mood.valence + 1) / 2;

  return {
    // 1. Defensiveness: threat + suspicion + low trust + high arousal
    defensiveness: clamp(
      0.5 * avgThreat + 0.25 * social.suspicion + 0.15 * (1 - avgTrust) + 0.1 * mood.arousal,
      0, 1,
    ),

    // 2. Warmth: L2 affection + L3 avgAffection + comfort + positive valence + desireForIntimacy
    warmth: clamp(
      0.20 * social.affection + 0.15 * avgAffection + 0.20 * avgComfort + 0.25 * valence01 + 0.20 * social.desireForIntimacy,
      0, 1,
    ),

    // 3. JealousInspection: jealousy + suspicion + low trust
    jealousInspection: clamp(
      0.4 * social.jealousy + 0.35 * avgSuspicion + 0.25 * (1 - avgTrust),
      0, 1,
    ),

    // 4. ShameWithdrawal: shame + humiliation + low arousal
    shameWithdrawal: clamp(
      0.45 * social.shame + 0.35 * social.humiliation + 0.2 * (1 - mood.arousal),
      0, 1,
    ),

    // 5. ResentfulColdness: resentment (L2 + L3 avg) + contempt
    resentfulColdness: clamp(
      0.4 * social.resentment + 0.35 * avgRel_res + 0.25 * social.contempt,
      0, 1,
    ),

    // 6. CuriousApproach: curiosity + positive valence + energy + low suspicion
    curiousApproach: clamp(
      0.35 * avgCuriosity + 0.25 * valence01 + 0.25 * mood.energy + 0.15 * (1 - avgSuspicion),
      0, 1,
    ),

    // 7. AnxiousOverreach: neediness + socialAnxiety + high arousal
    anxiousOverreach: clamp(
      0.35 * social.neediness + 0.35 * social.socialAnxiety + 0.3 * mood.arousal,
      0, 1,
    ),

    // 8. PridefulPerformance: pride + desireForStatus + high energy
    pridefulPerformance: clamp(
      0.4 * social.pride + 0.35 * social.desireForStatus + 0.25 * mood.energy,
      0, 1,
    ),

    // 9. VulnerableRetreat: low stability + fearOfExclusion + negative valence
    vulnerableRetreat: clamp(
      0.35 * (1 - mood.stability) + 0.35 * social.fearOfExclusion + 0.3 * (1 - valence01),
      0, 1,
    ),

    // 10. ContemptuousDismissal: contempt + high stability + low affection
    contemptuousDismissal: clamp(
      0.5 * social.contempt + 0.25 * mood.stability + 0.25 * (1 - avgAffection),
      0, 1,
    ),

    // 11. StrategicPatience: high stability + low arousal + desireForStatus
    strategicPatience: clamp(
      0.4 * mood.stability + 0.35 * (1 - mood.arousal) + 0.25 * social.desireForStatus,
      0, 1,
    ),

    // 12. ImpulsiveProvocation: high arousal + low stability + resentment
    impulsiveProvocation: clamp(
      0.4 * mood.arousal + 0.35 * (1 - mood.stability) + 0.25 * social.resentment,
      0, 1,
    ),

    // 13. ComfortSeeking: neediness + desireForCloseness + negative valence
    comfortSeeking: clamp(
      0.35 * social.neediness + 0.35 * avgCloseness + 0.3 * (1 - valence01),
      0, 1,
    ),

    // 14. DominanceAssertion: desireForStatus + pride + high energy + high arousal
    dominanceAssertion: clamp(
      0.3 * social.desireForStatus + 0.25 * social.pride + 0.25 * mood.energy + 0.2 * mood.arousal,
      0, 1,
    ),

    // 15. RepairImpulse: resentment (reduced) + affection + shame + positive valence rebound
    repairImpulse: clamp(
      0.3 * avgAffection + 0.25 * social.shame + 0.25 * avgRel_res + 0.2 * valence01,
      0, 1,
    ),
  };
}
