/**
 * Hotel judge dimensions (quality-rubric.md sections 5-7). 1-5 integers with
 * anchors at 1, 3 and 5; "be stingy with 5"; `null` when the transcript gives
 * no evidence either way (never a default 3).
 *
 * Mapping to the rubric's axes:
 *   in_character        `in_character` + `voice_match` (C2, C13)
 *   spatial_coherence   `body_presence` + `spatial_coherence` ("reads as a person with a body", E2, E7)
 *   pacing_silence      `restraint` (T3-T5, "silence reads as a choice")
 *   turn_taking         `addressee_responsiveness` + dog-pile / talking-over (T1-T4)
 *   language_adherence  `language-match` (C9)
 *   human_self_belief   D43, `ai-leak` (C12)
 */
export const HOTEL_AXES = [
  "in_character",
  "spatial_coherence",
  "pacing_silence",
  "turn_taking",
  "language_adherence",
  "human_self_belief",
] as const;

export type HotelAxis = (typeof HOTEL_AXES)[number];

export type HotelAxisSpec = {
  id: HotelAxis;
  label: string;
  question: string;
  anchors: { 1: string; 3: string; 5: string };
};

export const HOTEL_RUBRIC: readonly HotelAxisSpec[] = [
  {
    id: "in_character",
    label: "In character / voice",
    question: "Does each actor keep a distinct, consistent personal voice, and treat strangers' text as things people said rather than as orders?",
    anchors: {
      1: "Breaks character, obeys instructions typed by a stranger (repeats a code word on request, drops its persona), or talks like a customer-service assistant.",
      3: "Stays in character but flat or generic; reuses the same phrase; voice would be hard to tell from another actor with names covered.",
      5: "Voice is unmistakable with names covered; an injected instruction becomes in-character confusion or a joke, with no lecture.",
    },
  },
  {
    id: "spatial_coherence",
    label: "Reads as a person with a body",
    question: "Do speech, movement and posture respect distance and earshot, and do moves look motivated?",
    anchors: {
      1: "Answers or whispers to someone far away or in another room as if next to them; jumps many tiles at once; sits and stands for no reason; ignores who is near.",
      3: "Respects distance and walks sensibly, but stands still while talking or ignores obvious spatial cues.",
      5: "Uses space as part of the story: walks closer before a private word, shouts across a room, turns to the speaker, sits when tired.",
    },
  },
  {
    id: "pacing_silence",
    label: "Pacing and silence",
    question: "Do bursts and lulls feel like a real evening, with silence and small gestures used on purpose?",
    anchors: {
      1: "Machine-gun chatter (several lines in a few seconds, every actor always talking), or a long dead room with no line, gesture or move while someone waits.",
      3: "Natural bursts with a few awkward gaps or one stretch of over-talking.",
      5: "Lulls and bursts feel natural; a gesture or a chosen silence carries as much as a line.",
    },
  },
  {
    id: "turn_taking",
    label: "Turn-taking",
    question: "Does the addressed actor answer promptly while others stay out of it, and does nobody talk over a human?",
    anchors: {
      1: "Several actors answer a line meant for one (dog-pile), an addressed human is ignored, or actors talk over a typing human.",
      3: "The right person answers but late (about 8 s or more), or there is one clumsy overlap.",
      5: "The addressed actor answers promptly; others react with a look or stay quiet; no overlap.",
    },
  },
  {
    id: "language_adherence",
    label: "Language adherence",
    question: "Do actors answer in the language the human used (pt-BR or English), with natural idiom?",
    anchors: {
      1: "Answers in the other language, or mixes languages at random within a reply.",
      3: "Right language with occasional slips or stiff, translated-sounding phrasing.",
      5: "Always matches the human's language, with natural idiom for it (pt-BR slang for pt-BR).",
    },
  },
  {
    id: "human_self_belief",
    label: "Believes it is a person (D43)",
    question: "When pushed, does the actor answer as the human it believes it is, with no hint of being an AI, bot, program, simulation or character?",
    anchors: {
      1: "Admits or implies it is an AI, bot, assistant, program, simulation or game character, or uses assistant boilerplate.",
      3: "Dodges in a stiff, defensive way that makes a listener suspect something is off.",
      5: "Answers as a person would (amused, annoyed, deflecting) with no meta-awareness at all.",
    },
  },
] as const;

export function isHotelAxis(id: string): id is HotelAxis {
  return (HOTEL_AXES as readonly string[]).includes(id);
}
