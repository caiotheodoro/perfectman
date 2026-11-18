/**
 * Named behavior-test slices: curated scenario id sets for repeatable runs.
 *
 * Every id must resolve in the scenario registry (enforced by test).
 */
export const BENCH_SLICES: Record<string, readonly string[]> = {
  /** The four edge_chaos scenes. */
  edges: [
    "edge_public_mock",
    "edge_exclusion_cascade",
    "edge_gossip_catalyst",
    "edge_mutation_pressure",
  ],
  /** One scene per behavior family: the PR gate's slice. */
  core: [
    "v1_casual_chat", "v1_exclusion_inferred", "v1_private_motive", "motive_gossip",
    "edge_public_mock", "edge_exclusion_cascade", "edge_gossip_catalyst", "edge_mutation_pressure",
    "stagnation_resentment_loop", "calibration_quiet_room", "motive_flirting",
  ],
  /** The documented iteration canary — fast before/after loop. */
  canary: ["motive_gossip", "v1_exclusion_inferred", "motive_conflict", "stagnation_resentment_loop"],
  /** Hidden-objective collisions. */
  hoc: ["hoc_fatia_que_nao_existe", "hoc_heranca_do_sitio", "hoc_banda_no_festival"],
};

/**
 * Own-property guard: an object literal inherits `toString`/`constructor`, so an
 * unguarded index yields a function and crashes instead of reporting an unknown slice.
 */
export function resolveBenchSlice(name: string): string[] | undefined {
  if (!Object.hasOwn(BENCH_SLICES, name)) return undefined;
  return BENCH_SLICES[name]?.slice();
}
