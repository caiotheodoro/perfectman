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

/**
 * Map initiative source → relevant action emotion for growth modulation.
 *
 * TODO(owner: team): emotion-modulated accumulator growth is designed but
 * unwired — `run-engine-step` passes zeroed action emotions into this
 * function (initiative updates before the emotion stack runs), so
 * `emotionBoost` is always 0 in production. This map and the `emotionBoost`
 * term are kept intact for the "emotion-modulated accumulator growth" fog
 * item on issue #119. Designed-but-unwired since 63141c9 — not a regression.
 */
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

/**
 * Accumulator dynamics model
 * ==========================
 * Each of the 17 initiative sources carries a `value` in [0, 1] that pushes
 * the agent toward acting once `value > threshold`. The value evolves per
 * pulse under three regimes plus a firing cooldown:
 *
 * 1. Growth (silent pulse): `value += growthRate * energy`. `growthRate` is
 *    per-source (see DEFAULTS); `energy` is `coreMood.energy`. The
 *    `emotionBoost` term is present but inert in production (see
 *    SOURCE_EMOTION_MAP's TODO).
 *
 * 2. Passive decay (silent pulse): before growth is added, the value relaxes
 *    by `value *= 1 - decayRate * 0.5`. Without this a silent agent's motives
 *    only ever ratchet up and re-saturate at 1.0. With it, each source has a
 *    fixed point `growth / (decayRate * 0.5)` well below 1.0. The `0.5`
 *    coefficient is provisional — it is retuned in #129.
 *
 *    `cold_start_bootstrap` is exempt and stays growth-only on the silent
 *    branch. Its threshold (0.30) sits below the passive-decay ceiling
 *    `0.4 * energy`, so at typical persona energy (~0.3–0.5) the decayed
 *    fixed point never reaches the threshold. Decaying it would gate an
 *    always-on silence-breaker for a room that hasn't warmed up behind agent
 *    energy — for a calm agent the source would never cross and
 *    `scoreInitiativeCandidates` would never return `proceed` for it.
 *
 * 3. Global relief on action: when the agent committed an outward social act
 *    on the previous pulse (`justActed`), ALL 17 accumulators are multiplied
 *    by `1 - decayRate * 2`. Relief is deliberately global, not
 *    per-motive — targeted relief is deferred (parent #124). `justActed` is
 *    derived in `run-engine-step` from `AgentState.lastActionAt`, which the
 *    pulse scheduler stamps after a `send_message` / `reply_to_message` /
 *    `react` / `create_channel` commit.
 *
 * 4. Firing cooldown: after a source fires, `lastFiredAt` is set and
 *    `scoreInitiativeCandidates` blocks that source for
 *    INITIATIVE_COOLDOWN_PULSES (5) pulses.
 *
 * A related post-action suppression lives in `score-attention.ts`: for
 * `pulseIntervalMs * 3` after `lastActionAt` it subtracts up to `0.20` from
 * the attention due-score. Both magnitudes there are provisional.
 */
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

    // Cold start is the state of never having acted. Once the agent has
    // committed an outward act it is retired to 0 for the rest of the run:
    // decay-exempt and regrowing at growthRate*energy, it re-crossed its
    // 0.30 threshold every ~5 pulses and re-fired "make an entrance" for
    // the whole run (observed as re-announcements at p7/10/12/18/28).
    // Post-first-act silence is the boredom accumulator's job.
    if (source === "cold_start_bootstrap" && agentState.lastActionAt !== null) {
      return { ...acc, value: 0 };
    }

    // If just acted, apply global relief (multiply all 17 accumulators)
    if (justActed) {
      return { ...acc, value: clamp(acc.value * (1 - acc.decayRate * 2), 0, 1) };
    }

    // Compute growth for this pulse
    const emotionKey = SOURCE_EMOTION_MAP[source];
    const emotionBoost = emotionKey ? (actionEmotions[emotionKey] as number) * 0.3 : 0;
    const growth = (acc.growthRate + emotionBoost) * agentState.coreMood.energy;

    // Passive decay on the silent branch so unspoken motives also relax and
    // don't re-saturate at 1.0. The 0.5 coefficient is provisional (#129).
    // cold_start_bootstrap is exempt: its 0.30 threshold sits below the
    // passive-decay ceiling 0.4*energy, so decaying it would gate the
    // always-on cold-start stagger behind agent energy.
    const decayed =
      source === "cold_start_bootstrap"
        ? acc.value
        : acc.value * (1 - acc.decayRate * 0.5);
    const newValue = clamp(decayed + growth, 0, 1);

    return {
      ...acc,
      value: newValue,
    };
  });
}

/**
 * Score initiative candidates — determines if initiative should proceed.
 * Cold-start stagger: agents with arrivalDelayPulses haven't arrived yet.
 * arrivalPulse: agent must not fire until pulseIndex >= arrivalPulse.
 */
export function scoreInitiativeCandidates(
  accumulators: InitiativeAccumulator[],
  pulseIndex: number,
  arrivalPulse: number | null,
): InitiativeCandidate[] {
  const notArrived = arrivalPulse !== null && pulseIndex < arrivalPulse;

  return accumulators.map(acc => {
    const cooldownRemaining =
      acc.lastFiredAt !== null
        ? Math.max(0, INITIATIVE_COOLDOWN_PULSES - (pulseIndex - acc.lastFiredAt))
        : 0;

    const proceed =
      !notArrived &&
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
