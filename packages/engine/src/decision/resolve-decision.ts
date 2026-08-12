import type {
  Pressure,
  Inhibition,
  AgentState,
  PersonaConfig,
  Decision,
  DecisionOutcome,
  NoOpReason,
  PressureIntensity,
  InhibitionStrength,
  InitiativeCandidate,
} from "@perfectman/shared";

const INTENSITY_RANK: Record<PressureIntensity, number> = {
  low: 1, medium: 2, high: 3, overwhelming: 4,
};
const STRENGTH_RANK: Record<InhibitionStrength, number> = {
  low: 1, medium: 2, high: 3,
};

/** Room-birth grace: genuine initiative yields to strategic patience while
 *  the room is still waking up (cold-start stagger, no burst of messages). */
const INITIATIVE_OVERRIDE_GRACE_PULSES = 5;

/**
 * Resolve decision from pressures vs inhibitions.
 *
 * Logic:
 *   1. No pressures → no_op (with reason)
 *   2. Strongest inhibition >= strongest pressure → delay or no_op
 *   3. Delay preferred when strategic_patience_hold or fear_of_escalating dominant
 *   4. Otherwise act
 *   5. memory_only when shame_withdrawal overwhelming and no other pressures
 *   6. needsLLM = true when outcome is act or specific delay types
 *   7. initiativeProceed = true when no new events but initiative pushes action
 */
export function resolveDecision(
  pressures: Pressure[],
  inhibitions: Inhibition[],
  agentState: AgentState,
  persona: PersonaConfig,
  hasNewEvents: boolean,
  initiativeProceed: boolean,
  pulseIndex: number,
  initiativeCandidates: InitiativeCandidate[] = [],
): Decision {
  // cold_start_bootstrap can break strategic patience regardless of whether other
  // accumulators also fired — the agent has been silent long enough that waiting
  // longer serves nothing. It cannot override deeper inhibitions (fear_of_rejection,
  // social_anxiety_block, etc.) which remain fully blocking.
  const coldStartFired = initiativeCandidates.some(
    c => c.source === "cold_start_bootstrap" && c.proceed,
  );
  // Genuine (non-bootstrap) initiative — motivation that builds over time
  // (boredom, curiosity, repair…) — breaks the freeze after the room's
  // birth grace window.
  const otherInitiativeFired = initiativeCandidates.some(
    c => c.source !== "cold_start_bootstrap" && c.proceed,
  );
  // No pressures at all
  if (pressures.length === 0) {
    if (initiativeProceed) {
      return {
        outcome: "act",
        needsLLM: true,
        initiativeProceed: true,
        privateMotiveSeed: "initiative-driven",
      };
    }
    return {
      outcome:           "no_op",
      needsLLM:          false,
      initiativeProceed: false,
      noOpReason:        hasNewEvents ? "noticed_but_ignored" : "waited_for_someone_else",
      privateMotiveSeed: "",
    };
  }

  const topPressure = pressures[0]!;
  const topPressureRank = INTENSITY_RANK[topPressure.intensity];

  const topInhibition = inhibitions[0];
  const topInhibitionRank = topInhibition ? STRENGTH_RANK[topInhibition.strength] : 0;

  // Overwhelming shame withdrawal with no countervailing pressure → memory only
  if (
    topPressure.type === "urge_to_withdraw" &&
    topPressure.intensity === "overwhelming" &&
    pressures.length === 1
  ) {
    return {
      outcome:           "memory_only",
      needsLLM:          false,
      initiativeProceed: false,
      noOpReason:        "stored_memory_only",
      privateMotiveSeed: "shame-withdrawal",
    };
  }

  // Inhibition wins → delay or no_op
  if (topInhibition && topInhibitionRank >= topPressureRank) {
    const delayFavoring = [
      "strategic_patience_hold",
      "fear_of_escalating",
      "status_protection",
      "conflict_avoidance",
    ];
    const noopFavoring = [
      "fear_of_rejection",
      "social_anxiety_block",
      "fear_of_exclusion_worsening",
      "vulnerability_guard",
    ];

    if (delayFavoring.includes(topInhibition.type)) {
      // cold_start_bootstrap overrides strategic delays when others are actively
      // talking — the agent is being left out of a live conversation, so patience
      // serves nothing. When the channel is empty (no new events), strategic
      // patience holds normally.
      // Genuine initiative ALSO overrides after the room-birth grace window —
      // motivation creates action (docs core loop), and a stuck agent's real
      // drives must break the freeze.
      if (
        (coldStartFired && hasNewEvents) ||
        (pulseIndex >= INITIATIVE_OVERRIDE_GRACE_PULSES && otherInitiativeFired)
      ) {
        return {
          outcome:           "act",
          needsLLM:          true,
          initiativeProceed: true,
          privateMotiveSeed: `initiative-override-${topInhibition.type}`,
        };
      }
      return {
        outcome:           "delay",
        needsLLM:          false,
        initiativeProceed: false,
        noOpReason:        "delayed_intention",
        privateMotiveSeed: `delay-${topInhibition.type}`,
      };
    }

    if (noopFavoring.includes(topInhibition.type) || topInhibitionRank >= 3) {
      const noOpReason: NoOpReason =
        topInhibition.type === "fear_of_rejection"      ? "felt_too_uncertain" :
        topInhibition.type === "social_anxiety_block"    ? "felt_too_uncertain" :
        topInhibition.type === "contempt_concealment"    ? "pretended_not_to_care" :
        topInhibition.type === "strategic_patience_hold" ? "waited_for_someone_else" :
        "noticed_but_ignored";

      return {
        outcome:           "no_op",
        needsLLM:          false,
        initiativeProceed: false,
        noOpReason,
        privateMotiveSeed: `noop-${topInhibition.type}`,
      };
    }

    // Inhibition present but manageable → act with LLM
    return {
      outcome:           "act",
      needsLLM:          true,
      initiativeProceed,
      privateMotiveSeed: topPressure.type,
    };
  }

  // Pressure wins or no inhibition → act
  return {
    outcome:           "act",
    needsLLM:          true,
    initiativeProceed,
    privateMotiveSeed: topPressure.type,
  };
}
