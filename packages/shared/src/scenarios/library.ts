/**
 * Scenario registry + deterministic rotation.
 *
 * rotateScenario() expands the hand-authored core into seeded variants so the
 * benchmark runs on hundreds of tasks (S2: <100 tasks = noise). Rotation is
 * deterministic given (scenarioId, variantIndex, seed).
 */

import type {
  RoleplayScenario,
  ScenarioCategory,
  AgentSeedSpec,
  EventSeedSpec,
} from "../index.js";
import { V1_BEHAVIOR_SCENARIOS } from "./v1-behaviors.js";
import { MOTIVE_ARCHETYPE_SCENARIOS } from "./motive-archetypes.js";
import { STAGNATION_ATTRACTOR_SCENARIOS } from "./stagnation-attractors.js";
import { EDGE_CHAOS_SCENARIOS } from "./edge-chaos.js";
import { CALIBRATION_SCENARIOS } from "./calibration.js";
import { HIDDEN_OBJECTIVE_COLLISION_SCENARIOS } from "./hidden-objective-collisions.js";

export const SCENARIO_REGISTRY: readonly RoleplayScenario[] = [
  ...V1_BEHAVIOR_SCENARIOS,
  ...MOTIVE_ARCHETYPE_SCENARIOS,
  ...STAGNATION_ATTRACTOR_SCENARIOS,
  ...EDGE_CHAOS_SCENARIOS,
  ...CALIBRATION_SCENARIOS,
  ...HIDDEN_OBJECTIVE_COLLISION_SCENARIOS,
];

export function allScenarios(): RoleplayScenario[] {
  return [...SCENARIO_REGISTRY];
}

export function scenariosByCategory(category: ScenarioCategory): RoleplayScenario[] {
  return SCENARIO_REGISTRY.filter(s => s.category === category);
}

export function getScenario(id: string): RoleplayScenario | undefined {
  return SCENARIO_REGISTRY.find(s => s.id === id);
}

/** Deterministic PRNG (mulberry32) — no dependency, byte-stable. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const jitter = (rand: () => number, base: number, amp: number, lo: number, hi: number) =>
  clamp(base + (rand() * 2 - 1) * amp, lo, hi);

function jitterAgent(agentSpec: AgentSeedSpec, rand: () => number): AgentSeedSpec {
  const mood = { ...(agentSpec.mood ?? {}) };
  if (mood.valence === undefined) mood.valence = jitter(rand, 0.05, 0.08, -1, 1);
  if (mood.arousal === undefined) mood.arousal = jitter(rand, 0.4, 0.08, 0, 1);
  if (mood.stability === undefined) mood.stability = jitter(rand, 0.6, 0.06, 0.1, 1);
  if (mood.energy === undefined) mood.energy = jitter(rand, 0.6, 0.06, 0, 1);
  if (agentSpec.mood) {
    if (mood.valence !== undefined) mood.valence = jitter(rand, mood.valence, 0.1, -1, 1);
    if (mood.arousal !== undefined) mood.arousal = jitter(rand, mood.arousal, 0.05, 0, 1);
    if (mood.stability !== undefined) mood.stability = jitter(rand, mood.stability, 0.08, 0.1, 1);
    if (mood.energy !== undefined) mood.energy = jitter(rand, mood.energy, 0.08, 0, 1);
  }
  const social = { ...(agentSpec.social ?? {}) };
  if (agentSpec.social) {
    for (const key of Object.keys(social) as (keyof typeof social)[]) {
      const v = social[key];
      if (typeof v === "number") social[key] = jitter(rand, v, 0.06, 0, 1) as never;
    }
  }
  const relational: Record<string, Record<string, number>> = {};
  if (agentSpec.relational) {
    for (const [target, rel] of Object.entries(agentSpec.relational)) {
      const r: Record<string, number> = {};
      for (const [k, v] of Object.entries(rel)) {
        if (typeof v === "number") {
          r[k] = jitter(rand, v, 0.1, k === "trust" ? -1 : 0, 1);
        }
      }
      relational[target] = r;
    }
  }
  return { ...agentSpec, mood, social, relational };
}

function jitterEvent(eventSpec: EventSeedSpec, rand: () => number): EventSeedSpec {
  return {
    ...eventSpec,
    minutesAgo:
      eventSpec.minutesAgo === undefined ? undefined : Math.max(0, eventSpec.minutesAgo + Math.floor(rand() * 3) - 1),
  };
}

/**
 * Deterministic variant of a scenario.
 * @param variantIndex 0..seedVariants-1
 * @param rngSeed simulation seed (fixed per bench run)
 */
export function rotateScenario(
  scenario: RoleplayScenario,
  variantIndex: number,
  rngSeed = 7,
): RoleplayScenario {
  const rand = mulberry32(hashSeed(scenario.id, variantIndex, rngSeed));
  return {
    ...scenario,
    id: `${scenario.id}__v${variantIndex}`,
    seed: rngSeed,
    agents: scenario.agents.map(a => jitterAgent(a, rand)),
    priorEvents: scenario.priorEvents.map(e => jitterEvent(e, rand)),
  };
}

function hashSeed(scenarioId: string, variant: number, rngSeed: number): number {
  let h = rngSeed * 2654435761;
  const s = `${scenarioId}#${variant}`;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** Expands the registry into all rotated variants. */
export function expandVariants(scenarios: readonly RoleplayScenario[], rngSeed = 7): RoleplayScenario[] {
  const out: RoleplayScenario[] = [];
  for (const s of scenarios) {
    for (let v = 0; v < s.seedVariants; v++) {
      out.push(rotateScenario(s, v, rngSeed));
    }
  }
  return out;
}
