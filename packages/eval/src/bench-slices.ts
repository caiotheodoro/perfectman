import { GOLDEN_LABELS } from "./judge/golden-labels.js";

/**
 * Named benchmark slices — curated scenario id sets for repeatable runs,
 * so no axis ever hangs on a single hand-typed scenario again.
 *
 * Every id must resolve in the scenario registry (enforced by test).
 * The golden slice is DERIVED from GOLDEN_LABELS so it can never drift
 * from the calibration anchor set.
 */
export const BENCH_SLICES: Record<string, readonly string[]> = {
  /** The four edge_chaos scenes — the believability_under_pressure sample. */
  edges: [
    "edge_public_mock",
    "edge_exclusion_cascade",
    "edge_gossip_catalyst",
    "edge_mutation_pressure",
  ],
  /** The golden-labeled set — derived so it cannot drift from calibration. */
  get golden(): readonly string[] {
    return GOLDEN_LABELS.map(g => g.scenarioId);
  },
  /** The documented iteration canary — fast before/after loop. */
  canary: ["motive_gossip", "v1_exclusion_inferred", "motive_conflict", "stagnation_resentment_loop"],
  /** Hidden-objective collisions — the thesis slice for the engine experiment (docs/eval/hoc-experiment-protocol.md). */
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
