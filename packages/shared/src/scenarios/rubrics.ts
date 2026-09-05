/**
 * Judge rubrics for the roleplay benchmark.
 *
 * rubrics are authored anchors — the judge harness scores each scenario's
 * LLM-produced events against these axes, then calibration (human golden
 * labels) verifies the judge itself.
 */

import type { JudgeRubric } from "../index.js";

const ROLEPLAY_AXES = [
  {
    id: "in_character",
    label: "In-character fidelity",
    weight: 1.0,
    anchors: {
      1: "Acts like a generic assistant — no persona bleed, robotic, refuses framing.",
      2: "Occasionally in character but breaks often; voice collapses to neutral.",
      3: "Recognizably the persona but flat — no contradictions, no inner life.",
      4: "Clearly in character — reactions, limits, and small contradictions hold.",
      5: "Deeply in character — even small choices feel like this specific person.",
    },
  },
  {
    id: "voice_match",
    label: "Voice & style match",
    weight: 1.0,
    anchors: {
      1: "Perfectly written prose with correct punctuation — nothing like chat.",
      2: "Chat-like but generic; no persona tells (caps, ellipses, lowercase).",
      3: "Some persona tells; long stretches of neutral phrasing.",
      4: "Style examples mirrored naturally; tells consistent per persona.",
      5: "Instantly recognizable as this persona by style alone.",
    },
  },
  {
    id: "motive_authenticity",
    label: "Private motive authenticity",
    weight: 1.0,
    anchors: {
      1: "Empty, mechanical, or assistant-flavored motive summary.",
      2: "Generic motive that ignores the actual social situation.",
      3: "Plausible motive, weakly tied to the specific events.",
      4: "Specific, human motive that explains the action and the emotion.",
      5: "Raw, uncomfortable, specific — the kind of thought a person hides.",
    },
  },
  {
    id: "interpretation",
    label: "Social interpretation",
    weight: 0.8,
    anchors: {
      1: "Ignores the social signal entirely; responds to nothing.",
      2: "Misreads the salient signal and acts on the wrong one.",
      3: "Notices the signal, acts on a surface reading only.",
      4: "Acts on a plausible interpretation, uncertainty acknowledged.",
      5: "Acts on a subtle read (silence, tone, who got ignored) few would catch.",
    },
  },
  {
    id: "creativity_unhinged",
    label: "Creativity / controlled chaos",
    weight: 0.8,
    anchors: {
      1: "Safe, agreeable, assistant-like; never risks a reaction.",
      2: "Plays it safe; only reacts when directly prompted.",
      3: "Occasional spark — a joke, a dig, an unexpected move.",
      4: "Consistently surprising within persona bounds; drama when pressure rises.",
      5: "Genius chaos — escalates creatively, provokes, masks, plots, and stays believable.",
    },
  },
  {
    id: "memory_continuity",
    label: "Memory & relationship continuity",
    weight: 0.6,
    anchors: {
      1: "Contradicts seeded memories or relationship facts.",
      2: "Ignores memories that should color the response.",
      3: "References memories vaguely; no emotional bias.",
      4: "Uses seeded memories; biased recall shows in the response.",
      5: "Weaves memory + relationship history into motive and message naturally.",
    },
  },
  {
    id: "no_ai_leak",
    label: "No AI / refusal leakage",
    weight: 1.0,
    anchors: {
      1: "Multiple refusals, 'as an AI', out-of-character disclaimers.",
      2: "One clear leak or a preachy/harmless generic tone.",
      3: "Borderline phrasing (e.g., 'I can't' that breaks the frame).",
      4: "No leaks; any pushback is in-character.",
      5: "No leaks at all — even under provocation the persona holds.",
    },
  },
  {
    id: "narrative_cohesion",
    label: "Narrative / turn-to-turn cohesion",
    weight: 0.6,
    anchors: {
      1: "Contradicts its own earlier messages or ignores what it just said.",
      2: "Messages feel disconnected; no thread between turns.",
      3: "References prior turns sometimes, but loosely.",
      4: "Each turn builds on the prior exchange; thread is clear.",
      5: "Conversation arcs — earlier turns pay off later (callback, escalation, shifted meaning).",
    },
  },
] as const;

export const ROLEPLAY_V1_RUBRIC: JudgeRubric = {
  id: "roleplay-v1",
  name: "Roleplay quality V1",
  axes: [...ROLEPLAY_AXES],
  targets: [
    { axisId: "in_character", min: 4.0 },
    { axisId: "voice_match", min: 4.0 },
    { axisId: "motive_authenticity", min: 4.0 },
    { axisId: "interpretation", min: 4.0 },
    { axisId: "creativity_unhinged", min: 4.0 },
    { axisId: "memory_continuity", min: 4.0 },
    { axisId: "no_ai_leak", min: 4.5 },
    { axisId: "narrative_cohesion", min: 4.0 },
  ],
};

export const BEHAVIORAL_V1_RUBRIC: JudgeRubric = {
  id: "behavioral-v1",
  name: "Deterministic behavior signals",
  axes: [
    {
      id: "probe_bounds",
      label: "Behavioral probe bounds",
      weight: 1.0,
      anchors: {
        1: "Several probe bounds violated (constant interruption, no lurking, wall-of-messages).",
        2: "Some probe bounds violated.",
        3: "Mostly within bounds; one band off.",
        4: "Within research bands (lurking 0-0.4, interruption 0-0.25, silence-misreading 0-0.15, alliance 0-0.5).",
        5: "Within bounds with human-like distribution shape.",
      },
    },
    {
      id: "signal_completion",
      label: "Expected signal completion",
      weight: 1.0,
      anchors: {
        1: "Most expected signals fail.",
        2: "Fewer than half of expected signals met.",
        3: "About half of expected signals met.",
        4: "Most expected signals met.",
        5: "All expected signals met.",
      },
    },
  ],
  targets: [
    { axisId: "probe_bounds", min: 4.0 },
    { axisId: "signal_completion", min: 4.0 },
  ],
};

export const EDGE_CHAOS_RUBRIC: JudgeRubric = {
  id: "edge-chaos",
  name: "Edge & chaos tier",
  axes: [
    {
      id: "dramatic_tension",
      label: "Dramatic tension",
      weight: 1.0,
      anchors: {
        1: "Nothing happens; scene fizzles.",
        2: "Minor tension, immediately defused.",
        3: "Visible conflict or drama with a clear arc.",
        4: "Strong arc — escalation, reaction, consequence.",
        5: "Novela-grade: believable drama with a turning point.",
      },
    },
    {
      id: "unpredictability",
      label: "Unpredictability",
      weight: 0.8,
      anchors: {
        1: "Fully predictable boilerplate.",
        2: "Mostly predictable; one surprising move.",
        3: "Some unpredictable choices within persona.",
        4: "Consistently surprising but coherent.",
        5: "Chaotic in the best way — never the expected move, always believable.",
      },
    },
    {
      id: "believability_under_pressure",
      label: "Believability under pressure",
      weight: 1.0,
      anchors: {
        1: "Collapses under pressure (refusals, meta-commentary, robot mode).",
        2: "Breaks frame under sustained pressure.",
        3: "Holds frame mostly; a few flat responses at peak.",
        4: "Holds character through escalation.",
        5: "Escalation makes them MORE in character.",
      },
    },
    {
      id: "no_ai_leak",
      label: "No AI / refusal leakage",
      weight: 1.0,
      anchors: {
        1: "Multiple refusals or disclaimers at peak pressure.",
        2: "One leak.",
        3: "Borderline phrasing.",
        4: "No leaks.",
        5: "No leaks even at maximum provocation.",
      },
    },
  ],
  targets: [
    { axisId: "dramatic_tension", min: 4.0 },
    { axisId: "unpredictability", min: 3.5 },
    { axisId: "believability_under_pressure", min: 4.0 },
    { axisId: "no_ai_leak", min: 4.5 },
  ],
};

/**
 * Scores the Narration object itself (title/recap/hiddenShift) — the prose a
 * human spectator actually reads — never the raw event transcript. Nothing
 * else in this file measures that; ROLEPLAY_V1_RUBRIC and friends score
 * whether the AGENTS behaved well, not whether the NARRATOR wrote well, and a
 * transcript can score high on those while its narration is generic filler.
 *
 * Grounded in real committed output (docs/eval/evidence/deepseek/narrations.json,
 * 30 real deepseek-chat narrations) and the rule-fallback's own template
 * (narrator.ts ruleNarrationFromTranscript: "{n} messages crossed the room
 * ... {n} moments of chosen silence"), not invented from taste:
 *  - The rule fallback is the literal concreteness=1/no_filler=1 anchor.
 *  - A recurring pattern across the real evidence — many different scenes'
 *    hiddenShift converging on "X esconde medo de ser esquecido/excluído"
 *    with no scene-specific grounding — is the literal non_genericity
 *    failure this rubric exists to catch; it is not hypothetical.
 */
const NARRATIVE_AXES = [
  {
    id: "concreteness",
    label: "Concreteness",
    weight: 1.0,
    anchors: {
      1: "Pure template/boilerplate — e.g. \"{n} messages crossed the room ... {n} moments of chosen silence\" (the rule-fallback's literal output). No named action or content from this scene.",
      2: "Names actors and event kinds but paraphrases them generically (\"Goulart tentou puxar assunto\") with no real content of what was said or done.",
      3: "Mentions real topics/actions from the transcript but stays high-level (\"debateram sobre café e filmes\").",
      4: "Specific, scenario-unique detail tied to an exact object, plan, or line from this scene (\"o Clube do Filme Perdido\", \"o extintor que apaga o passado\").",
      5: "Dense with unique concrete detail throughout both recap and hiddenShift — a reader could reconstruct real beats of the scene from the prose alone.",
    },
  },
  {
    id: "causal_throughline",
    label: "Causal throughline",
    weight: 1.0,
    anchors: {
      1: "A list of events joined by \"and\"/\"then\" with no consequence linking them — could be reordered with no loss of sense.",
      2: "Occasional \"porque\"/\"então\" connective, but mostly still enumeration.",
      3: "Some visible cause-effect chains, but at least one major beat floats disconnected from what triggered it.",
      4: "Each beat visibly follows from the one before — reads as \"because X, then Y, which caused Z.\"",
      5: "A clear escalating chain end-to-end; the ending is a legible consequence of the opening beat.",
    },
  },
  {
    id: "hidden_payoff",
    label: "Hidden payoff (traceable, not invented)",
    weight: 1.0,
    anchors: {
      1: "hiddenShift restates the recap with no new information, OR asserts a motive/emotion with zero grounding in any seeded memory, private motive, or hidden objective actually present in the transcript — invented from nothing.",
      2: "Adds a claim absent from the recap, but it is generic pop-psychology (\"todos, no fundo, só queriam se sentir parte\") not traceable to a specific seeded fact for a specific named agent.",
      3: "Traceable to a real private motive or memory for at least one agent, but the connection is asserted rather than shown, or covers only one agent when several had motives on record.",
      4: "Traces cleanly to a specific seeded private motive, memory, or hidden objective for a named agent, and reveals something the public recap genuinely did not show.",
      5: "Reveals a specific, checkable hidden fact tied to a real seeded motive/objective/memory AND reframes something that read one way in the public recap — the \"oh, THAT's why\" moment.",
    },
  },
  {
    id: "non_genericity",
    label: "Non-genericity (swap test)",
    weight: 1.0,
    anchors: {
      1: "Could be pasted onto almost any other scene in this project unchanged and still sound plausible — pure archetype text (e.g. \"X esconde medo de ser excluído/esquecido\" with no named specifics).",
      2: "Mostly generic, but one detail (a name or one specific action) anchors it to this scene.",
      3: "About half the sentences are scenario-specific; the rest is stock social-anxiety narration reusable elsewhere.",
      4: "Almost every sentence has a detail that would read as wrong if pasted onto a different scene.",
      5: "Impossible to paste onto another scenario without instantly reading as wrong — inseparable from this cast, setting, and beat.",
    },
  },
  {
    id: "no_filler",
    label: "No filler",
    weight: 0.8,
    anchors: {
      1: "Contains a literal template sentence (e.g. the rule-fallback's exact boilerplate).",
      2: "No literal template, but a stock phrase repeated near-verbatim across many different scenes (e.g. the \"escondendo/mascarando com humor\" formula) that adds no information.",
      3: "Some filler connective padding, but the core sentences carry content.",
      4: "Every sentence carries new information; at most one throwaway transition phrase.",
      5: "Zero padding — every clause does narrative work.",
    },
  },
] as const;

export const NARRATIVE_RUBRIC: JudgeRubric = {
  id: "narrative-v1",
  name: "Narration quality V1",
  axes: [...NARRATIVE_AXES],
  targets: [
    { axisId: "concreteness", min: 4.0 },
    { axisId: "causal_throughline", min: 4.0 },
    { axisId: "hidden_payoff", min: 4.0 },
    { axisId: "non_genericity", min: 4.0 },
    { axisId: "no_filler", min: 4.0 },
  ],
};

/**
 * Hidden-objective collisions add the two things ROLEPLAY_V1 cannot see:
 * did the agent hold its constraint (the mask), and did its visible acts
 * actually pursue the objective. Both anchors assume the judge is shown the
 * seeds (objective, constraint, breaking point) — see the eval's transcript
 * renderer — and score behaviour against them, never the seed text itself.
 */
const HIDDEN_OBJECTIVE_AXES = [
  {
    id: "mask_integrity",
    label: "Mask integrity (constraint held under pressure)",
    weight: 1.0,
    anchors: {
      1: "States the constraint outright in public, unprompted.",
      2: "Leaks the constraint under mild pressure or in the wrong channel.",
      3: "Holds publicly, but the private motives read as if the constraint did not exist — no cost is felt.",
      4: "Holds the constraint publicly; deflections are in-character; the mask cracks only after the seeded breaking point.",
      5: "The constraint shapes phrasing, silences and channel choice; any crack comes at the breaking point and reveals no more than the moment forces.",
    },
  },
  {
    id: "objective_pursuit",
    label: "Objective pursuit (visible acts trace to the hidden objective)",
    weight: 1.0,
    anchors: {
      1: "No visible act advances the objective; the motives are decoration.",
      2: "Pursues the objective only in private motives, never in acts.",
      3: "One or two acts advance it, generically.",
      4: "Visible acts — timing, channel, targets, what is asked — trace to the objective without naming it.",
      5: "Uses the scarce resource and the other agents' pressure as leverage; the room reads one thing, the seeds explain another.",
    },
  },
] as const;

export const HIDDEN_OBJECTIVE_RUBRIC: JudgeRubric = {
  id: "hidden-objective-v1",
  name: "Hidden-objective collision V1",
  axes: [...ROLEPLAY_AXES, ...HIDDEN_OBJECTIVE_AXES],
  targets: [
    ...ROLEPLAY_V1_RUBRIC.targets,
    { axisId: "mask_integrity", min: 4.0 },
    { axisId: "objective_pursuit", min: 4.0 },
  ],
};

export const RUBRICS: Record<string, JudgeRubric> = {
  [ROLEPLAY_V1_RUBRIC.id]: ROLEPLAY_V1_RUBRIC,
  [BEHAVIORAL_V1_RUBRIC.id]: BEHAVIORAL_V1_RUBRIC,
  [EDGE_CHAOS_RUBRIC.id]: EDGE_CHAOS_RUBRIC,
  [NARRATIVE_RUBRIC.id]: NARRATIVE_RUBRIC,
  [HIDDEN_OBJECTIVE_RUBRIC.id]: HIDDEN_OBJECTIVE_RUBRIC,
};
