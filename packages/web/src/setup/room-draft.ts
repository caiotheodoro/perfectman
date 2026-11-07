import { ROLES, roomFiles } from "@perfectman/shared";
import type { CharacterDraft, RoomDraft, RoomFiles, StoryDraft } from "@perfectman/shared";

// `roomFiles` and the draft types live in @perfectman/shared: the hotel sidecar compiles form-built scenarios with the same code.
export { ROLES, roomFiles };
export type { CharacterDraft, RoomDraft, RoomFiles };

export const INITIAL_ROOM: RoomDraft = {
  title: "The awkward evening",
  situation: "Three friends are stuck in the same room after something awkward happened. Nobody wants to be the first to bring it up.",
  people: [
    { name: "Alex", role: "connector", goal: "Keep the peace without anyone noticing how hard it is." },
    { name: "Sam", role: "skeptic", goal: "Get a straight answer out of somebody." },
    { name: "Robin", role: "performer", goal: "Be the center of attention without admitting why they need it." },
  ],
};

/** A one-line idea from the landing page becomes the situation; everything else keeps its starting point. */
export function draftFromSentence(sentence: string): RoomDraft {
  const idea = sentence.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  if (!idea) return INITIAL_ROOM;
  return { ...INITIAL_ROOM, idea, title: idea.length > 60 ? `${idea.slice(0, 59)}…` : idea, situation: `${idea}. Everyone is in the same room, and each of them wants something different out of it.` };
}
// Single-line prose keeps form input from accidentally becoming a Markdown section.
/** A room the model wrote, held in the form the person can still edit. */
export function draftFromStory(story: StoryDraft, idea: string): RoomDraft {
  return { idea, title: story.title, situation: story.situation, language: story.language,
    people: story.people.map(({ name, role, goal, voice, lines }) => ({ name, role, goal, voice, lines })) };
}
