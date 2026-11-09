/**
 * The controlled vocabulary every beat is tagged against. Authored here, in our own words, from the craft sources listed in the README
 * (no copyrighted verb list is reproduced). Row values are permanent: append, never rename, because stored tags point at them.
 */

export const MEDIUMS = ["THEATRE", "CINEMA"] as const;
export type Medium = (typeof MEDIUMS)[number];

/** The same tags as `plan.schema.json` `physical_action_tag`, with DIALOGUE_ONLY where the plan says NONE, plus FAINTING. */
export const ACTION_TYPES = [
  "KILLING",
  "KISSING",
  "HUGGING",
  "CRYING",
  "VIOLENT_PUSH",
  "VIOLENT_STRIKE",
  "PHYSICAL_RETREAT",
  "FAINTING",
  "DIALOGUE_ONLY",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Plan tag to KB tag. NONE is the plan's word for dialogue only. */
export function fromPlanTag(tag: string): ActionType | undefined {
  if (tag === "NONE") return "DIALOGUE_ONLY";
  return (ACTION_TYPES as readonly string[]).includes(tag) ? (tag as ActionType) : undefined;
}

/** The driver's own movement against the person they act on, same values as the plan's `status_delta`. */
export const STATUS_DELTAS = ["HIGH_TO_LOW", "LOW_TO_HIGH", "EQUAL_STALEMATE", "EQUALIZE", "HIGH_STABLE", "LOW_STABLE"] as const;
export type StatusDelta = (typeof STATUS_DELTAS)[number];

export const EMOTIONS = ["anger", "contempt", "fear", "sadness", "shame", "joy", "love", "relief", "surprise", "jealousy", "resolve", "neutral"] as const;
export type Emotion = (typeof EMOTIONS)[number];

/**
 * Playable tactics: active, transitive, aimed at a person. Never a feeling ("to be angry") and never a result ("to win").
 * Grouped only to make the list readable; the tagger picks one string from the flat set.
 */
const TACTIC_GROUPS: Record<string, readonly string[]> = {
  pressure: ["to intimidate", "to threaten", "to command", "to demand", "to corner", "to press", "to provoke", "to challenge", "to confront", "to accuse", "to blame", "to interrogate", "to dominate", "to bully", "to dare"],
  lowering: ["to humiliate", "to mock", "to ridicule", "to dismiss", "to belittle", "to shame", "to scold", "to rebuke", "to snub", "to silence", "to patronise", "to tease"],
  soft: ["to plead", "to beg", "to appeal", "to implore", "to flatter", "to charm", "to seduce", "to coax", "to tempt", "to woo", "to entice", "to cajole", "to court"],
  care: ["to comfort", "to console", "to soothe", "to reassure", "to protect", "to shield", "to nurse", "to forgive", "to welcome", "to embrace", "to praise", "to encourage"],
  guard: ["to deflect", "to evade", "to stonewall", "to withhold", "to deny", "to conceal", "to bluff", "to dodge", "to refuse", "to resist", "to defy", "to withdraw", "to retreat", "to stall", "to appease"],
  truth: ["to confess", "to reveal", "to expose", "to admit", "to warn", "to inform", "to explain", "to justify", "to excuse", "to apologise", "to atone", "to testify"],
  steer: ["to persuade", "to convince", "to manipulate", "to deceive", "to trick", "to lure", "to sway", "to goad", "to incite", "to bribe", "to bargain", "to negotiate", "to propose"],
  end: ["to disarm", "to subdue", "to restrain", "to strike", "to kill", "to punish", "to avenge", "to condemn", "to banish", "to abandon", "to reject", "to surrender", "to yield", "to submit", "to grieve", "to mourn", "to break down"],
};

export const TACTIC_VERBS: readonly string[] = Array.from(new Set(Object.values(TACTIC_GROUPS).flat()));
export const TACTIC_GROUP_OF: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(TACTIC_GROUPS).flatMap(([g, verbs]) => verbs.map((v) => [v, g]))),
);

export function isTacticVerb(v: unknown): v is string {
  return typeof v === "string" && TACTIC_GROUP_OF[v] !== undefined;
}

/** Light normalisation so "intimidate", "To Intimidate" and "to  intimidate" all land on the list. Unknown stays unknown. */
export function normaliseTactic(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const withTo = t.startsWith("to ") ? t : `to ${t}`;
  return isTacticVerb(withTo) ? withTo : undefined;
}

/** A tactic list the tagger is shown, one group per line. */
export function tacticPromptList(): string {
  return Object.entries(TACTIC_GROUPS)
    .map(([g, verbs]) => `${g}: ${verbs.join(", ")}`)
    .join("\n");
}
