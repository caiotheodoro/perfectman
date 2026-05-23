import type {
  InitiativeAccumulator,
  InitiativeCandidate,
  InitiativeSource,
  AgentState,
  PersonaConfig,
  ActionEmotions,
} from "@perfectman/shared";
import { clamp } from "@perfectman/shared";

const INITIATIVE_COOLDOWN_PULSES = 5;

/**
 * Default thresholds and growth rates per initiative source.
 * Agents fire when accumulator.value > accumulator.threshold.
 */
const DEFAULTS: Record<InitiativeSource, { threshold: number; growthRate: number; decayRate: number }> = {
  boredom_accumulator:      { threshold: 0.65, growthRate: 0.04, decayRate: 0.30 },
  curiosity_accumulator:    { threshold: 0.55, growthRate: 0.05, decayRate: 0.25 },
  reply_pressure:           { threshold: 0.45, growthRate: 0.08, decayRate: 0.40 },
  social_anxiety_relief:    { threshold: 0.70, growthRate: 0.03, decayRate: 0.15 },
  status_assertion:         { threshold: 0.60, growthRate: 0.04, decayRate: 0.20 },
  repair_urgency:           { threshold: 0.50, growthRate: 0.06, decayRate: 0.25 },
  gossip_impulse:           { threshold: 0.70, growthRate: 0.03, decayRate: 0.20 },
  attraction_reach:         { threshold: 0.65, growthRate: 0.04, decayRate: 0.20 },
  comfort_seeking:          { threshold: 0.60, growthRate: 0.05, decayRate: 0.30 },
  alliance_signal:          { threshold: 0.55, growthRate: 0.04, decayRate: 0.20 },
  avoidance_exit:           { threshold: 0.45, growthRate: 0.06, decayRate: 0.30 },
  conflict_provocation:     { threshold: 0.75, growthRate: 0.05, decayRate: 0.35 },
  exclusion_response:       { threshold: 0.55, growthRate: 0.07, decayRate: 0.30 },
  testing_probe:            { threshold: 0.65, growthRate: 0.03, decayRate: 0.20 },
  vulnerability_opening:    { threshold: 0.70, growthRate: 0.03, decayRate: 0.15 },
  secrecy_motive:           { threshold: 0.65, growthRate: 0.04, decayRate: 0.20 },
  cold_start_bootstrap:     { threshold: 0.30, growthRate: 0.10, decayRate: 0.50 },
};

/** Map initiative source → relevant action emotion for growth modulation */
const SOURCE_EMOTION_MAP: Partial<Record<InitiativeSource, keyof ActionEmotions>> = {
  boredom_accumulator:   "curiousApproach",
  curiosity_accumulator: "curiousApproach",
  reply_pressure:        "anxiousOverreach",
  status_assertion:      "pridefulPerformance",
  repair_urgency:        "repairImpulse",
  conflict_provocation:  "impulsiveProvocation",
  comfort_seeking:       "comfortSeeking",
  exclusion_response:    "defensiveness",
  attraction_reach:      "warmth",
  vulnerability_opening: "vulnerableRetreat",
};

export function updateInitiativeAccumulators(
  current: InitiativeAccumulator[],
  actionEmotions: ActionEmotions,
  agentState: AgentState,
  persona: PersonaConfig,
  pulseIndex: number,
  justActed: boolean,
): InitiativeAccumulator[] {
  const allSources = Object.keys(DEFAULTS) as InitiativeSource[];

  // Build a map from existing accumulators
  const existing = new Map(current.map(a => [a.source, a]));

  return allSources.map(source => {
    const defaults = DEFAULTS[source]!;
    const acc = existing.get(source) ?? {
      source,
      value: source === "cold_start_bootstrap" ? 0.25 : 0,
      threshold: defaults.threshold,
      growthRate: defaults.growthRate,
      decayRate: defaults.decayRate,
      lastFiredAt: null,
    };

    // If just acted, decay strongly
    if (justActed) {
      return { ...acc, value: clamp(acc.value * (1 - acc.decayRate * 2), 0, 1) };
    }

    // Compute growth for this pulse
    const emotionKey = SOURCE_EMOTION_MAP[source];
    const emotionBoost = emotionKey ? (actionEmotions[emotionKey] as number) * 0.3 : 0;
    const growth = (acc.growthRate + emotionBoost) * agentState.coreMood.energy;

    const newValue = clamp(acc.value + growth, 0, 1);

    return {
      ...acc,
      value: newValue,
    };
  });
}

/**
 * Score initiative candidates — determines if initiative should proceed.
 * Cold-start stagger: agents with arrivalDelayPulses haven't arrived yet.
 */
export function scoreInitiativeCandidates(
  accumulators: InitiativeAccumulator[],
  pulseIndex: number,
  lastActionAt: number | null,
  pulseIntervalMs: number,
): InitiativeCandidate[] {
  return accumulators.map(acc => {
    const cooldownRemaining =
      acc.lastFiredAt !== null
        ? Math.max(0, INITIATIVE_COOLDOWN_PULSES - (pulseIndex - acc.lastFiredAt))
        : 0;

    const proceed =
      acc.value > acc.threshold &&
      cooldownRemaining === 0;

    return {
      source:             acc.source,
      score:              acc.value,
      proceed,
      cooldownRemaining,
    };
  });
}

/** Returns true if any initiative candidate should proceed */
export function anyInitiativeProceed(candidates: InitiativeCandidate[]): boolean {
  return candidates.some(c => c.proceed);
}
