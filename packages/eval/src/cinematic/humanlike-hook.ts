/**
 * The human-likeness hook: an optional input to the embodiment group.
 *
 * Agent B5 builds `packages/eval/src/humanlike/` (does the avatar move like a person, not a puppet). It is not merged yet, so nothing here imports it. The
 * contract is this one small shape: a 0-100 score and the named components behind it. When the module exists it hands the scorer a {@link HumanLikeReport}
 * (`scoreBundle(bundle, { humanlike })`, or `cinematic --run <dir> --humanlike report.json`); until then the score is exactly what it was, and a run scored
 * without a report says so in the embodiment detail (`humanLike: "off"`).
 *
 * The report enters embodiment as one reading, `humanLike`, with weight {@link HUMANLIKE_WEIGHT} next to the other embodiment readings (they sum to ~1), so it
 * is about a sixth of the group. Its score is used as it is (it is already 0-100); no band is applied to it here.
 */
export type HumanLikeReport = {
  /** 0-100, higher is more human. */
  score0to100: number;
  /** Named sub-scores (each 0-100 by convention, but they are only displayed here, never combined). */
  components: Record<string, number>;
};

export const HUMANLIKE_WEIGHT = 0.2;

/** Validates an untrusted object (a JSON file) into a report, or throws with what was wrong. The score is clamped to 0-100. */
export function parseHumanLikeReport(raw: unknown): HumanLikeReport {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("humanlike report: expected a JSON object { score0to100, components }");
  const o = raw as Record<string, unknown>;
  const score = o["score0to100"];
  if (typeof score !== "number" || !Number.isFinite(score)) throw new Error("humanlike report: score0to100 must be a finite number");
  const comps = o["components"];
  if (comps === null || typeof comps !== "object" || Array.isArray(comps)) throw new Error("humanlike report: components must be an object of numbers");
  const components: Record<string, number> = {};
  for (const [k, v] of Object.entries(comps as Record<string, unknown>)) {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`humanlike report: component "${k}" must be a finite number`);
    components[k] = v;
  }
  return { score0to100: Math.max(0, Math.min(100, score)), components };
}
