/**
 * Familiarity matrix → full `RelationalState` maps.
 *
 * `RelationalStateSchema` is strict: sixteen fields per pair, every one
 * required. Asking an author to write sixteen floats per relationship — or
 * asking a model to invent them — produces noise, not texture. So the authored
 * surface is one word per pair ("close_friends") and this expands it.
 *
 * Lifted verbatim from `__e2e__/scenario-presets.ts`, which is where it grew;
 * that module now re-exports from here so production code doesn't import a
 * test directory.
 */
import type { RelationalState } from "@perfectman/shared";

export type PairFamiliarity = "close_friends" | "friends" | "acquaintances" | "strangers";

export const PAIR_FAMILIARITIES: readonly PairFamiliarity[] = [
  "close_friends",
  "friends",
  "acquaintances",
  "strangers",
];

const FAMILIARITY_OVERRIDES: Record<PairFamiliarity, Partial<RelationalState>> = {
  close_friends: {
    trust: 0.85, affection: 0.75, comfort: 0.90, suspicion: 0.05,
    threat: 0.02, desireForCloseness: 0.80, desireForDistance: 0.05, resentment: 0.03,
  },
  friends: {
    trust: 0.65, affection: 0.50, comfort: 0.65, suspicion: 0.10,
    threat: 0.05, desireForCloseness: 0.55, desireForDistance: 0.10,
  },
  acquaintances: {
    trust: 0.35, affection: 0.20, comfort: 0.35, suspicion: 0.20,
    threat: 0.10, desireForCloseness: 0.25, desireForDistance: 0.15,
  },
  strangers: {
    trust: 0.10, affection: 0.00, comfort: 0.10, suspicion: 0.30,
    threat: 0.20, desireForCloseness: 0.15, desireForDistance: 0.25,
  },
};

export function relationalStateFromFamiliarity(
  targetAgentId: string,
  familiarity: PairFamiliarity,
): RelationalState {
  return {
    targetAgentId,
    trust: 0.5, affection: 0.3, resentment: 0, attraction: 0.2,
    suspicion: 0.1, admiration: 0.2, envy: 0, comfort: 0.5, threat: 0,
    curiosity: 0.3, desireForCloseness: 0.3, desireForDistance: 0.1,
    interactionCount: 0, lastInteractionAt: null, lastPositiveAt: null, lastNegativeAt: null,
    ...FAMILIARITY_OVERRIDES[familiarity],
  };
}

/**
 * Builds one agent's initial relational map.
 * Pair keys are symmetric — `"a:b"` and `"b:a"` are the same relationship — and
 * an unlisted pair defaults to `acquaintances`.
 */
export function buildRelationalStates(
  agentId: string,
  allAgentIds: readonly string[],
  pairFamiliarity: Record<string, PairFamiliarity>,
): Record<string, RelationalState> {
  const result: Record<string, RelationalState> = {};
  for (const otherId of allAgentIds) {
    if (otherId === agentId) continue;
    const familiarity =
      pairFamiliarity[`${agentId}:${otherId}`] ??
      pairFamiliarity[`${otherId}:${agentId}`] ??
      "acquaintances";
    result[otherId] = relationalStateFromFamiliarity(otherId, familiarity);
  }
  return result;
}
