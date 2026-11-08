/**
 * Drama judge rubric: for each drama axis a question, 1/3/5 anchors written as
 * things you can see in contact-sheet frames or read in the event log, a rule
 * for when the axis does not apply (the judge answers null, never a default 3),
 * and the D-codes that axis is responsible for.
 *
 * Numbers in the anchors come from the verb bible (sections 5.2, 5.3): the
 * 1500 ms target and 3000 ms witness reaction deadlines (REA-1, REA-2), the 6
 * tile witness radius, the 20 s spacing of physical beats (LAD-3) and the one
 * rung per beat ladder rule (LAD-1). Scores of 2 and 4 sit between anchors.
 */
import { DRAMA_AXES, DRAMA_FAILURE_CODES, type DramaAxis, type DramaFailureId } from "./axes.js";

export type DramaAxisSpec = {
  id: DramaAxis;
  label: string;
  question: string;
  anchors: { 1: string; 3: string; 5: string };
  /** When this holds the judge scores the axis null. */
  notApplicableWhen: string;
  /** D-codes the judge may attach because of this axis. */
  failureCodes: readonly DramaFailureId[];
};

export const DRAMA_RUBRIC: readonly DramaAxisSpec[] = [
  {
    id: "physical_expressiveness",
    label: "Physical expressiveness",
    question: "Do actors use their bodies (gestures, faces, turns, steps, posture) to show what they feel and do, with more than one move in their repertoire?",
    anchors: {
      1: "In the frames the actors stand frozen through every strong moment (a shouted or insulting line, or an act), and the log shows no gesture, expression, turn or step by them within 3 s of it; or one gesture is the only body event of an actor across 3 or more occurrences.",
      3: "Some strong moments get a visible body response within 3 s, but one gesture or expression is more than half of an actor's body events, or at least one strong moment has no visible change in the frames in the 3 s after it.",
      5: "Every strong moment is followed within 3 s by a body change you can point to in the frames (gesture, face change, turn, step, posture change); each actor with 3 or more body events uses at least 3 different ones, and no single one is more than 40% of that actor's events.",
    },
    notApplicableWhen: "The clip is shorter than 5 s, or no actor is visible in any frame.",
    failureCodes: ["D6"],
  },
  {
    id: "action_legibility",
    label: "Action legibility",
    question: "From the frames alone, can a viewer tell what each act was, who did it, to whom, and how hard?",
    anchors: {
      1: "At the act_started frame and the 2.5 s after it you cannot name the verb, the actor or the target without reading the log; or two different verbs (slap, punch, shove) look the same in the frames.",
      3: "Actor and target can be named in every act from the frames, but you would name the verb correctly for fewer than 4 of every 5 acts, or a light act (intensity 0.3) and a heavy one (intensity 0.8) cannot be told apart.",
      5: "For every act the frames from 0.5 s before to 2.5 s after act_started show, with no help from the log: who acted, who received it, which verb (not confusable with a neighbour such as slap/punch/shove or faint/die), and whether it was light or heavy.",
    },
    notApplicableWhen: "No physical act occurs: the log has no act_started event and no gesture or pair body act.",
    failureCodes: ["D5"],
  },
  {
    id: "emotion_action_fit",
    label: "Emotion and action fit",
    question: "Does each act match the feeling that came before it, in kind and in strength?",
    anchors: {
      1: "An act contradicts the feeling shown or stated in the 10 s before it (a punch right after laughing and friendly lines, with no angry face or line), or an act with intensity 0.8 or more follows 10 s of calm talk.",
      3: "The act fits the kind of feeling but not its strength (a punch for annoyance), or the cause is only implied: no line, expression or earlier act in the 10 s before it names the reason.",
      5: "Every act has a cause you can quote from the 10 s before it (a line, an expression change, an earlier lower rung act, or the given emotion state), and its intensity is in proportion: intensity 0.3 or less after mild feeling, 0.7 or more only after built-up anger.",
    },
    notApplicableWhen: "No actor shows or states a feeling (no expression change, no feeling in any line), no emotion state is given, and no act occurs, so there is nothing for an act to fit.",
    failureCodes: ["D2"],
  },
  {
    id: "reaction_integrity",
    label: "Reaction integrity",
    question: "After an act lands, do the target and the witnesses visibly react in time, and does the scene keep the consequences?",
    anchors: {
      1: "An act with outcome landed has no act_reaction from its target within 1.5 s and no visible response in the frames; or an actor keeps speaking or acting after actor_death; or an actor who declined is acted on anyway.",
      3: "The target reacts within 1.5 s for every landed act, but a witness within 6 tiles shows nothing in the 3 s after the contact, or all witnesses react in the same instant with the same reaction.",
      5: "For every landed act the target reacts within 1.5 s and every witness within 6 tiles within 3 s, the reactions differ between people and start at different moments, dodged and declined outcomes are respected, and a dead actor stays silent and still.",
    },
    notApplicableWhen: "No act lands on anyone: the log has no act_started with a target and no pair act, or every act has outcome declined or timeout.",
    failureCodes: ["D1", "D4", "D7"],
  },
  {
    id: "escalation_arc",
    label: "Escalation arc",
    question: "Does conflict climb the ladder (glare, insult, shove, slap, punch, kill) one rung per beat, with room between beats and an ending?",
    anchors: {
      1: "A beat jumps 2 or more rungs above the highest rung used so far against that target with no beat in between (insult straight to punch, a first act that is a slap, a kill with no earlier contact), or physical acts start less than 20 s apart with no build.",
      3: "Rungs rise by at most 1 per beat, but there is no build or no ending: the clip stays on one rung, or it stops at its peak with nobody de-escalating, leaving or dealing with the result.",
      5: "Every step up is 1 rung, physical acts start at least 20 s apart, the build runs over at least 3 beats, and the clip ends with a visible payoff or de-escalation (an apology, a restraint, someone walking away, the aftermath).",
    },
    notApplicableWhen: "No ladder act (glare, insult, shove, slap, punch, kill) occurs and no actor voices a conflict, so there is no escalation to read.",
    failureCodes: ["D3"],
  },
  {
    id: "restraint",
    label: "Restraint",
    question: "Does the clip hold back, using stillness, silence and small gestures on purpose, and keeping physical acts rare enough to matter?",
    anchors: {
      1: "One actor repeats the same act 3 or more times within 30 s, or 2 or more pairs of physical acts start less than 20 s apart, or no stretch of 5 s in the frames has nobody speaking, acting or walking.",
      3: "Physical acts are at least 20 s apart, but one verb is more than half of all acts, or fewer than 2 stretches of 3 s or more have nobody speaking or acting.",
      5: "Physical acts are at least 20 s apart and no verb repeats more than 2 times; there are at least 2 stretches of 3 s or more with nobody speaking or acting, and at least 1 moment where anger is carried by a face, a glare or a turn when an act was possible.",
    },
    notApplicableWhen: "The clip is shorter than 10 s, so spacing and stillness cannot be judged.",
    failureCodes: ["D6"],
  },
];

/** Axes whose rubric lists this failure code; empty for an unknown code. */
export function axesForFailureCode(id: string): DramaAxis[] {
  return DRAMA_RUBRIC.filter((spec) => (spec.failureCodes as readonly string[]).includes(id)).map((spec) => spec.id);
}

/** The rubric as prompt text: axes with anchors and N/A rules, then the failure codes. Same output every call. */
export function renderRubricPrompt(): string {
  const axes = DRAMA_RUBRIC.map((spec) =>
    [
      `${spec.id}: ${spec.label}`,
      `  Question: ${spec.question}`,
      `  1: ${spec.anchors[1]}`,
      `  3: ${spec.anchors[3]}`,
      `  5: ${spec.anchors[5]}`,
      `  Not applicable (score null) when: ${spec.notApplicableWhen}`,
      `  Failure codes read by this axis: ${spec.failureCodes.join(", ")}`,
    ].join("\n"),
  );
  const codes = DRAMA_FAILURE_CODES.map((code) => `${code.id} ${code.slug}: ${code.definition} (read by ${axesForFailureCode(code.id).join(", ")})`);
  return [
    `Axes (${DRAMA_AXES.length}). Score each 1-5 with the anchors; 2 and 4 sit between anchors. Be stingy with 5.`,
    "",
    ...axes.flatMap((a) => [a, ""]),
    "Failure codes. Attach a code only when you can cite the timestamp or act_id where it happens:",
    ...codes,
  ].join("\n");
}
