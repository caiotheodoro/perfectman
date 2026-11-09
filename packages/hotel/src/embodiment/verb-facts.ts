import type { ActVerb } from "@perfectman/shared";
import type { ActMemoryEntry } from "@perfectman/engine";

/**
 * The few facts of the verb table the planner side needs, as data. `verb-vocab.json` is the source of truth; the test
 * `[VV-4] the planner's verb facts equal the table` reads the JSON and fails when any of this drifts from it.
 */

/** `contact: true` in the table: the actor touches the target (TGT-1 locks an actor target for the whole act). */
export const CONTACT_VERBS: ReadonlySet<ActVerb> = new Set<ActVerb>(["shove", "slap", "punch", "kill", "hug", "kiss", "restrain"]);

/** Verbs whose table ends in a `tableau` (a `follow_ups` entry, or the verb itself): everyone within `tableau_radius_tiles` holds (TBL-11). */
export const HOLDS_THE_ROOM: ReadonlySet<ActVerb> = new Set<ActVerb>(["slap", "punch", "kill", "faint", "tableau"]);

/** The celebration gestures a killer is locked from for `no_reward_ms` after a kill lands (LAD-8). */
export const CELEBRATION_GESTURES: ReadonlySet<string> = new Set(["dance", "thumbs", "laugh"]);

/** The verbs that put a body on the floor: their actor, or the victim of `kill`, is a fallen avatar until it stands (DOWN-1). */
export const FALLS: ReadonlySet<ActVerb> = new Set<ActVerb>(["faint", "die"]);

const NONE: ActMemoryEntry = { event: "none", tone: "neutral" };

type VerbMemory = { actor: ActMemoryEntry; target: ActMemoryEntry; witnesses: ActMemoryEntry };

const VERB_MEMORY: Partial<Record<ActVerb, VerbMemory>> = {
  glare: { actor: { event: "aggressor", tone: "hostile" }, target: { event: "victim", tone: "hurt" }, witnesses: { event: "witnessed", tone: "shocked" } },
  insult: { actor: { event: "aggressor", tone: "hostile" }, target: { event: "victim", tone: "hurt" }, witnesses: { event: "witnessed", tone: "shocked" } },
  shove: { actor: { event: "aggressor", tone: "hostile" }, target: { event: "victim", tone: "hurt" }, witnesses: { event: "witnessed", tone: "shocked" } },
  slap: { actor: { event: "aggressor", tone: "hostile" }, target: { event: "victim", tone: "hurt" }, witnesses: { event: "witnessed", tone: "shocked" } },
  punch: { actor: { event: "aggressor", tone: "hostile" }, target: { event: "victim", tone: "hurt" }, witnesses: { event: "witnessed", tone: "shocked" } },
  kill: { actor: { event: "aggressor", tone: "hostile" }, target: { event: "death", tone: "grief" }, witnesses: { event: "witnessed", tone: "shocked" } },
  die: { actor: { event: "none", tone: "neutral" }, target: { event: "death", tone: "grief" }, witnesses: { event: "witnessed", tone: "shocked" } },
  hug: { actor: { event: "affectionate", tone: "warm" }, target: { event: "receiver", tone: "tender" }, witnesses: { event: "witnessed", tone: "neutral" } },
  kiss: { actor: { event: "affectionate", tone: "warm" }, target: { event: "receiver", tone: "tender" }, witnesses: { event: "witnessed", tone: "neutral" } },
  faint: { actor: NONE, target: NONE, witnesses: { event: "witnessed", tone: "shocked" } },
  tend_fallen: { actor: { event: "affectionate", tone: "tender" }, target: { event: "receiver", tone: "tender" }, witnesses: NONE },
};

/** `verbs.<id>.memory` of the table: what each half of a landed act writes (REA-8). Absent: the verb writes nothing. */
export function verbMemory(verb: ActVerb): VerbMemory {
  return VERB_MEMORY[verb] ?? { actor: NONE, target: NONE, witnesses: NONE };
}

/** The ids of the verbs with a non-empty memory entry, for the drift test. */
export const VERBS_WITH_MEMORY: readonly ActVerb[] = Object.keys(VERB_MEMORY) as ActVerb[];
