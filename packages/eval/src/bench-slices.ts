/**
 * Named benchmark slices — curated scenario id sets for repeatable runs,
 * so no axis ever hangs on a single hand-typed scenario again.
 *
 * Every id must resolve in the scenario registry (enforced by test).
 */
export const BENCH_SLICES: Record<string, readonly string[]> = {
  /** The four edge_chaos scenes — the believability_under_pressure sample. */
  edges: [
    "edge_public_mock",
    "edge_exclusion_cascade",
    "edge_gossip_catalyst",
    "edge_mutation_pressure",
  ],
  /** The golden-labeled set — calibration's overlap. */
  golden: [
    "v1_casual_chat",
    "v1_exclusion_inferred",
    "v1_private_motive",
    "motive_gossip",
    "edge_public_mock",
    "stagnation_resentment_loop",
    "calibration_quiet_room",
    "motive_flirting",
  ],
  /** The documented iteration canary — fast before/after loop. */
  canary: ["motive_gossip", "v1_exclusion_inferred", "motive_conflict", "stagnation_resentment_loop"],
};

export function resolveBenchSlice(name: string): string[] | undefined {
  return BENCH_SLICES[name]?.slice();
}
