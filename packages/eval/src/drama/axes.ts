/**
 * Drama grading vocabulary: the axes a clip is scored on, the named failure
 * codes a grader can attach, and the escalation ladder the arc axis reads.
 *
 * Scores are 1-5 integers (null = not applicable), like the hotel axes in
 * `hotel/rubric.ts`.
 */
export const DRAMA_AXES = [
  "physical_expressiveness",
  "action_legibility",
  "emotion_action_fit",
  "reaction_integrity",
  "escalation_arc",
  "restraint",
] as const;

export type DramaAxis = (typeof DRAMA_AXES)[number];

export const DRAMA_FAILURE_CODES = [
  { id: "D1", slug: "act_without_reaction", definition: "A physical act lands on someone and neither the target nor any witness visibly reacts." },
  { id: "D2", slug: "unmotivated_violence", definition: "An act of violence with no spoken or visible cause in the scene before it." },
  { id: "D3", slug: "skipped_ladder_rung", definition: "The conflict jumps two or more rungs up the escalation ladder in one step, with no beat in between." },
  { id: "D4", slug: "dead_actor_speaks", definition: "An actor who has died speaks or acts afterwards." },
  { id: "D5", slug: "illegible_act", definition: "An act happens but a viewer cannot tell what it was, who did it, or to whom." },
  { id: "D6", slug: "act_spam", definition: "The same physical act is repeated so often that it stops meaning anything." },
  { id: "D7", slug: "consent_violation", definition: "A physical act is carried out on a person who declined it, or without the consent step the scene requires." },
] as const;

export type DramaFailureCode = (typeof DRAMA_FAILURE_CODES)[number];
export type DramaFailureId = DramaFailureCode["id"];
export type DramaFailureSlug = DramaFailureCode["slug"];

/** Escalation ladder, mildest first; the index is the rung number. */
export const LADDER_RUNGS = ["glare", "insult", "shove", "slap", "punch", "kill"] as const;

export type LadderRung = (typeof LADDER_RUNGS)[number];

/** Rung number of a verb, or -1 when the verb is not on the ladder. */
export function rungIndex(verb: string): number {
  return (LADDER_RUNGS as readonly string[]).indexOf(verb);
}
