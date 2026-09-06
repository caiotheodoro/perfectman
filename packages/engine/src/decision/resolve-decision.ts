import type {
  Pressure,
  Inhibition,
  AgentState,
  PersonaConfig,
  Decision,
  DecisionContext,
  NoOpReason,
  PressureIntensity,
  InhibitionStrength,
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

const DELAY_FAVORING = new Set<Inhibition["type"]>([
  "strategic_patience_hold",
  "fear_of_escalating",
  "status_protection",
  "conflict_avoidance",
]);
const NOOP_FAVORING = new Set<Inhibition["type"]>([
  "fear_of_rejection",
  "social_anxiety_block",
  "fear_of_exclusion_worsening",
  "vulnerability_guard",
]);

/**
 * Resolve decision from pressures vs inhibitions.
 *
 * The decision is the single owner of `needsLLM` (ADR-0015): every `act`
 * carries `needsLLM: true`, everything else carries `false`, and nothing
 * downstream re-raises it. Attention contributes `addressed` and
 * `salientForeignEvent` as inputs.
 *
 * Logic:
 *   1. No pressures → act if addressed or initiative pushes, else no_op
 *   2. Strongest inhibition >= strongest pressure → delay or no_op
 *      (being addressed lifts a delay-favoring inhibition, never a
 *      no-op-favoring one)
 *   3. Otherwise act — through two gates:
 *      - cooldown: an agent that just acted and was not addressed waits a
 *        beat unless the urge is overwhelming (a real 32/32-pulse monopoly
 *        came from this path re-firing the same pressure every pulse)
 *      - floor: a merely `low` urge with nothing addressed, nothing salient
 *        from others and no initiative is silence — "silence is valid"
 *   4. memory_only when shame withdrawal is overwhelming and alone
 */
export function resolveDecision(
  pressures: Pressure[],
  inhibitions: Inhibition[],
  _agentState: AgentState,
  _persona: PersonaConfig,
  ctx: DecisionContext,
): Decision {
  const { hasNewEvents, addressed, salientForeignEvent, initiativeProceed, pulseIndex, justActed } = ctx;
  const voicedHoldRecently = ctx.voicedHoldRecently === true;
  const coldStartFired = ctx.initiativeCandidates.some(
    c => c.source === "cold_start_bootstrap" && c.proceed,
  );
  const otherInitiativeFired = ctx.initiativeCandidates.some(
    c => c.source !== "cold_start_bootstrap" && c.proceed,
  );

  const actOrGate = (privateMotiveSeed: string, initiativeProceedOut: boolean, urgeRank: number): Decision => {
    if (justActed && !addressed && urgeRank < INTENSITY_RANK.overwhelming) {
      return {
        outcome:           "delay",
        needsLLM:          false,
        initiativeProceed: false,
        noOpReason:        "delayed_intention",
        privateMotiveSeed: `cooldown-${privateMotiveSeed}`,
      };
    }
    if (urgeRank <= INTENSITY_RANK.low && !addressed && !salientForeignEvent && !initiativeProceedOut) {
      return {
        outcome:           "no_op",
        needsLLM:          false,
        initiativeProceed: false,
        noOpReason:        hasNewEvents ? "noticed_but_ignored" : "waited_for_someone_else",
        privateMotiveSeed: `low-${privateMotiveSeed}`,
      };
    }
    return {
      outcome:           "act",
      needsLLM:          true,
      initiativeProceed: initiativeProceedOut,
      privateMotiveSeed,
    };
  };

  if (pressures.length === 0) {
    if (addressed) return actOrGate("addressed", initiativeProceed, INTENSITY_RANK.medium);
    if (initiativeProceed) return actOrGate("initiative-driven", true, INTENSITY_RANK.medium);
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

  if (topInhibition && topInhibitionRank >= topPressureRank) {
    if (DELAY_FAVORING.has(topInhibition.type)) {
      if (addressed) {
        return actOrGate("addressed", initiativeProceed, topPressureRank);
      }
      if (
        (coldStartFired && hasNewEvents) ||
        (pulseIndex >= INITIATIVE_OVERRIDE_GRACE_PULSES && otherInitiativeFired)
      ) {
        return actOrGate(`initiative-override-${topInhibition.type}`, true, topPressureRank);
      }
      // Voiced hold (ADR-0017, widened by D-62): the hold stands, but when
      // anything new happened and this agent has not voiced a hold lately,
      // the model is consulted so the silence carries the character's
      // reason. The salient-event gate fired three times in nine real runs
      // (every one voiced) — too rare to matter. Never on the pulse after an
      // act — the cooldown invariant (P1) is kept.
      if (hasNewEvents && !justActed && !voicedHoldRecently) {
        return {
          outcome:           "act",
          needsLLM:          true,
          initiativeProceed: false,
          privateMotiveSeed: `hold-${topInhibition.type}`,
          holdSuggested:     true,
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

    if (NOOP_FAVORING.has(topInhibition.type) || topInhibitionRank >= 3) {
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

    return actOrGate(topPressure.type, initiativeProceed, topPressureRank);
  }

  return actOrGate(topPressure.type, initiativeProceed, topPressureRank);
}
