/**
 * The drama verbs of the act contract (docs/drama/act-contract.md section 0.2 and 5.5).
 * Pure constants and two small functions. The machine-readable table is the hotel's
 * `verb-vocab.json`; `packages/hotel` cross-checks every list here against it
 * (`verb-vocab: matches the generated ids`), so a drift fails a test, not a run.
 */

/** The 18 verbs. */
export const ACT_VERBS = [
  "glare",
  "insult",
  "shove",
  "slap",
  "punch",
  "kill",
  "die",
  "recoil",
  "freeze_gasp",
  "hug",
  "kiss",
  "turn_back",
  "cry",
  "storm_off",
  "tableau",
  "restrain",
  "faint",
  "tend_fallen",
] as const;

export type ActVerb = (typeof ACT_VERBS)[number];

/** Who started the act: the model (a proposal the director approved), the director, or an authored scenario beat. */
export const ACT_ORIGINS = ["model", "director", "scenario"] as const;

export type ActOrigin = (typeof ACT_ORIGINS)[number];

/** `required`: the act names another avatar (`with`). `none`: a solo verb, `with` is a validation error (ACT-8). */
export type ActTargetMode = "required" | "none";

export const ACT_TARGET_MODE: Readonly<Record<ActVerb, ActTargetMode>> = {
  glare: "required",
  insult: "required",
  shove: "required",
  slap: "required",
  punch: "required",
  kill: "required",
  die: "none",
  recoil: "none",
  freeze_gasp: "none",
  hug: "required",
  kiss: "required",
  turn_back: "required",
  cry: "none",
  storm_off: "none",
  tableau: "none",
  restrain: "required",
  faint: "none",
  tend_fallen: "required",
};

/** The ladder, rung 1 to 6 in order. */
export const LADDER_VERBS = ["glare", "insult", "shove", "slap", "punch", "kill"] as const;

/** The physical beats, which share the 20 s spacing (LAD-3). */
export const PHYSICAL_VERBS = ["shove", "slap", "punch", "kill"] as const;

export function ladderRung(verb: ActVerb): number | undefined {
  const i = (LADDER_VERBS as readonly string[]).indexOf(verb);
  return i < 0 ? undefined : i + 1;
}

export type ImpactClass = "L" | "M" | "H" | "F";

const IMPACT_ORDER: readonly ImpactClass[] = ["L", "M", "H", "F"];

/** Hit-stop per impact class, ms (TBL-4). */
export const ACT_HIT_STOP_MS: Readonly<Record<ImpactClass, number>> = { L: 50, M: 100, H: 150, F: 175 };

type IntensityEntry = { default: number; class: { min: ImpactClass; max: ImpactClass } | null };

/** Default intensity and the impact-class clamp of every verb (`verbs.<id>.intensity` in the table). */
export const ACT_INTENSITY: Readonly<Record<ActVerb, IntensityEntry>> = {
  glare: { default: 0.4, class: null },
  insult: { default: 0.5, class: null },
  shove: { default: 0.25, class: { min: "L", max: "M" } },
  slap: { default: 0.5, class: { min: "M", max: "H" } },
  punch: { default: 0.8, class: { min: "M", max: "H" } },
  kill: { default: 1, class: { min: "F", max: "F" } },
  die: { default: 1, class: null },
  recoil: { default: 0.5, class: null },
  freeze_gasp: { default: 0.5, class: null },
  hug: { default: 0.5, class: null },
  kiss: { default: 0.5, class: null },
  turn_back: { default: 0.5, class: null },
  cry: { default: 0.5, class: null },
  storm_off: { default: 0.6, class: null },
  tableau: { default: 0.5, class: null },
  restrain: { default: 0.3, class: { min: "L", max: "L" } },
  faint: { default: 0.7, class: null },
  tend_fallen: { default: 0.5, class: null },
};

/**
 * TBL-4: `L` below 0.34, `M` up to and including 0.67, `H` above; then clamped to the verb's
 * `[min, max]`. A verb with no class bound has no impact class (the wire field is omitted).
 */
export function impactClassOf(verb: ActVerb, intensity?: number): ImpactClass | undefined {
  const entry = ACT_INTENSITY[verb];
  if (!entry.class) return undefined;
  const x = intensity ?? entry.default;
  const raw = x < 0.34 ? 0 : x <= 0.67 ? 1 : 2;
  const lo = IMPACT_ORDER.indexOf(entry.class.min);
  const hi = IMPACT_ORDER.indexOf(entry.class.max);
  return IMPACT_ORDER[Math.min(hi, Math.max(lo, raw))];
}
