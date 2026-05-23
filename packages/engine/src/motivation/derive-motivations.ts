import type {
  AgentState,
  PersonaConfig,
  ActionEmotions,
  Motivation,
  MotivationType,
  MotivationStrength,
  RelationalState,
} from "@perfectman/shared";
import { meanOf } from "@perfectman/shared";

/**
 * Derive active motivations from action emotions + persona + relational state.
 * Returns only motivations above threshold — prevents motivation noise.
 *
 * 17 motivation categories, each mapped from dominant action emotion signals.
 */

const MOTIVATION_THRESHOLD = 0.25; // below this, motivation not surfaced

type MotivationSignal = {
  type: MotivationType;
  score: number;
  targetAgentIds: string[];
  description: string;
};

export function deriveMotivations(
  agentState: AgentState,
  persona: PersonaConfig,
  actionEmotions: ActionEmotions,
): Motivation[] {
  const rels = [...agentState.relationalStates.entries()];
  const mood = agentState.coreMood;

  const signals: MotivationSignal[] = [
    // boredom — low arousal, low activity, initiative accumulator
    {
      type:           "boredom",
      score:          (1 - mood.arousal) * (1 - actionEmotions.curiousApproach) * persona.boredomSensitivity / 3,
      targetAgentIds: [],
      description:    "Feeling restless — the conversation has been quiet and there's a pull to stir something up or just reach out.",
    },

    // curiosity — curious approach emotion
    {
      type:           "curiosity",
      score:          actionEmotions.curiousApproach,
      targetAgentIds: rels.filter(([, r]) => r.curiosity > 0.4).map(([id]) => id),
      description:    "Genuinely interested in what someone is thinking or what's happening around here.",
    },

    // repair — repair impulse + recent negative interactions
    {
      type:           "repair",
      score:          actionEmotions.repairImpulse,
      targetAgentIds: rels.filter(([, r]) => r.resentment > 0.3 || r.lastNegativeAt !== null).map(([id]) => id),
      description:    "Something feels unresolved — there's a low-key urge to smooth things over, even without saying it directly.",
    },

    // gossip — secrecy + suspicion + desire for private channel
    {
      type:           "gossip",
      score:          (agentState.socialEmotions.suspicion * 0.5 + actionEmotions.jealousInspection * 0.5),
      targetAgentIds: rels.filter(([, r]) => r.suspicion > 0.4).map(([id]) => id),
      description:    "There's something that feels like it can't be said out loud — a pull toward a more private conversation.",
    },

    // status — desire for status + prideful performance
    {
      type:           "status",
      score:          agentState.socialEmotions.desireForStatus * 0.6 + actionEmotions.pridefulPerformance * 0.4,
      targetAgentIds: [],
      description:    "Want to be seen as capable or in-the-know — maybe show off a bit, establish some presence.",
    },

    // attraction — desire for intimacy + high affection for specific person
    {
      type:           "attraction",
      score:          agentState.socialEmotions.desireForIntimacy * 0.5 + meanOf(rels.map(([, r]) => r.attraction)) * 0.5,
      targetAgentIds: rels.filter(([, r]) => r.attraction > 0.4 || r.affection > 0.5).map(([id]) => id),
      description:    "Drawn to someone in a way that's hard to articulate — want to be closer or get more attention from them.",
    },

    // comfort — comfort seeking + low valence
    {
      type:           "comfort",
      score:          actionEmotions.comfortSeeking,
      targetAgentIds: rels.filter(([, r]) => r.comfort > 0.5).map(([id]) => id),
      description:    "Feeling a bit low — would appreciate some warmth or an easy, uncomplicated interaction.",
    },

    // alliance — high trust + high affection for someone
    {
      type:           "alliance",
      score:          meanOf(rels.filter(([, r]) => r.trust > 0.3).map(([, r]) => r.affection)),
      targetAgentIds: rels.filter(([, r]) => r.trust > 0.3 && r.affection > 0.4).map(([id]) => id),
      description:    "Want to strengthen a connection — feeling like staying close to someone reliable.",
    },

    // avoidance — desire for distance + high threat
    {
      type:           "avoidance",
      score:          meanOf(rels.map(([, r]) => r.desireForDistance)) + meanOf(rels.map(([, r]) => r.threat)) * 0.5,
      targetAgentIds: rels.filter(([, r]) => r.desireForDistance > 0.4 || r.threat > 0.4).map(([id]) => id),
      description:    "Would rather not interact with someone right now — might stay quiet or redirect attention elsewhere.",
    },

    // control — dominance assertion + high status desire
    {
      type:           "control",
      score:          actionEmotions.dominanceAssertion,
      targetAgentIds: [],
      description:    "A pull toward shaping the direction of the conversation or asserting a position.",
    },

    // testing — suspicion + jealous inspection
    {
      type:           "testing",
      score:          agentState.socialEmotions.suspicion * 0.4 + actionEmotions.jealousInspection * 0.6,
      targetAgentIds: rels.filter(([, r]) => r.suspicion > 0.35).map(([id]) => id),
      description:    "Feeling uncertain about someone — might probe a little, see how they react to something ambiguous.",
    },

    // conflict — resentment + impulsive provocation
    {
      type:           "conflict",
      score:          agentState.socialEmotions.resentment * 0.4 + actionEmotions.impulsiveProvocation * 0.6,
      targetAgentIds: rels.filter(([, r]) => r.resentment > 0.4).map(([id]) => id),
      description:    "Something has been building — there's an edge, a want to push back or say something that cuts.",
    },

    // exclusion (as a motive, not a feeling) — fear of exclusion driving action
    {
      type:           "exclusion",
      score:          agentState.socialEmotions.fearOfExclusion * persona.exclusionSensitivity / 3,
      targetAgentIds: [],
      description:    "Worried about being left out — might try to insert into conversations or signal presence.",
    },

    // liking — admiration + affection + positive interactions
    {
      type:           "liking",
      score:          agentState.socialEmotions.admiration * 0.5 + meanOf(rels.map(([, r]) => r.affection)) * 0.5,
      targetAgentIds: rels.filter(([, r]) => r.affection > 0.5 || r.admiration > 0.4).map(([id]) => id),
      description:    "Just genuinely like someone — want to interact, maybe make them feel good.",
    },

    // vulnerability — shame withdrawal + vulnerable retreat
    {
      type:           "vulnerability",
      score:          actionEmotions.shameWithdrawal * 0.5 + actionEmotions.vulnerableRetreat * 0.5,
      targetAgentIds: rels.filter(([, r]) => r.comfort > 0.5).map(([id]) => id),
      description:    "Feeling exposed or uncertain — might want to share something real, or might need to retreat first.",
    },

    // secrecy — private info + desire for private channel
    {
      type:           "secrecy",
      score:          agentState.socialEmotions.suspicion * 0.3 + agentState.socialEmotions.shame * 0.3 + actionEmotions.vulnerableRetreat * 0.4,
      targetAgentIds: rels.filter(([, r]) => r.trust > 0.3).map(([id]) => id),
      description:    "There's something that belongs in a different, more private space — not for everyone to see.",
    },

    // impulse — high arousal + low stability + low inhibition
    {
      type:           "impulse",
      score:          mood.arousal * (1 - mood.stability) * actionEmotions.impulsiveProvocation,
      targetAgentIds: [],
      description:    "Just feeling the urge to do something — not sure what, just something, right now.",
    },
  ];

  return signals
    .filter(s => s.score >= MOTIVATION_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .map(s => ({
      type:           s.type,
      strength:       scoreToStrength(s.score),
      targetAgentIds: s.targetAgentIds.slice(0, 3), // max 3 targets
      description:    s.description,
    }));
}

function scoreToStrength(score: number): MotivationStrength {
  if (score >= 0.65) return "strong";
  if (score >= 0.40) return "moderate";
  return "weak";
}
