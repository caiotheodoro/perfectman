/**
 * Applies what the config schema cannot carry, after the simulation is built
 * and before the first pulse: seed memories and prior events.
 *
 * Same slot the eval harness uses (packages/eval/src/run/scenario-runner.ts:199).
 * The difference is read-modify-write rather than construct-from-scratch:
 * `buildConfiguredSimulation` has already upserted agent states carrying mood,
 * social emotions and relational states from config, and overwriting those
 * would silently discard the familiarity matrix.
 */
import type { CommittedEvent, EventPayload, Memory } from "@perfectman/shared";
import type { RunSeeds } from "../../authoring/assemble-config.js";
import type { ConfiguredSimulationHandle } from "../../config/simulation-config.js";

/**
 * Memory timestamps live on the simulated clock, which starts at 0 — decay and
 * eviction measure age in pulses off that clock, not wall-clock time. A seeded
 * memory predates pulse 1, so it is stamped at the simulated epoch.
 */
const SIM_EPOCH = 0;

export type AppliedSeeds = {
  /** Prior events as committed, so the viewer can be shown history it never saw delivered. */
  priorEvents: CommittedEvent[];
  memoriesSeeded: number;
  warnings: string[];
};

export async function applySeeds(
  handle: ConfiguredSimulationHandle,
  seeds: RunSeeds,
): Promise<AppliedSeeds> {
  const warnings: string[] = [];
  let memoriesSeeded = 0;

  for (const [agentId, memories] of Object.entries(seeds.memoriesByAgent)) {
    const state = await handle.repositories.agentStateRepo.get(handle.simulationId, agentId);
    if (!state) {
      warnings.push(`No agent state for "${agentId}"; its ${memories.length} seed memories were skipped.`);
      continue;
    }
    await handle.repositories.agentStateRepo.upsert({
      ...state,
      memories: memories.map((seed, index): Memory => ({
        id: `mem_${handle.simulationId}_${agentId}_${index}`,
        agentId,
        simulationId: handle.simulationId,
        type: seed.type,
        subjectAgentIds: seed.subjectAgentIds,
        sourceEventIds: [],
        summary: seed.summary,
        emotionalTone: seed.emotionalTone,
        confidence: seed.confidence,
        intensity: seed.intensity ?? 0,
        unresolved: seed.unresolved,
        createdAt: SIM_EPOCH,
        lastReinforcedAt: SIM_EPOCH,
      })),
    });
    memoriesSeeded += memories.length;
  }

  const priorEvents = buildPriorEvents(handle.simulationId, seeds);
  if (priorEvents.length > 0) {
    await handle.repositories.eventRepo.append(handle.simulationId, priorEvents);
  }

  return { priorEvents, memoriesSeeded, warnings };
}

/**
 * Prior events are appended straight to the repository, which means they never
 * pass through the projections — no `sendAgentMessage`, no `event_visibility`.
 * A gateway therefore never sees them, so the caller has to hand them to the
 * viewer itself; that is why they are returned rather than just written.
 */
function buildPriorEvents(simulationId: string, seeds: RunSeeds): CommittedEvent[] {
  if (seeds.priorEvents.length === 0) return [];
  const now = Date.now();
  const minPulse = Math.min(...seeds.priorEvents.map((e) => e.pulseIndex));

  return seeds.priorEvents.map((seed, index): CommittedEvent => ({
    id: `seed_${simulationId}_${index}`,
    simulationId,
    // Shifted so the earliest seeded event sits at pulse 0 and the run's own
    // first pulse follows it, whatever indices the author wrote.
    pulseIndex: seed.pulseIndex - minPulse,
    type: seed.type as CommittedEvent["type"],
    actorId: seed.actorId,
    channelId: seed.channelId,
    payload: (seed.payload ?? {}) as EventPayload,
    sourceEventIds: [],
    createdAt: now - (seed.minutesAgo ?? 0) * 60_000,
    emotionalSalience: "medium",
    visibility: {
      // Empty means "everyone in the channel" — this is history the room shares.
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "scenario_seed",
    },
  }));
}
