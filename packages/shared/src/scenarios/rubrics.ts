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
] as const;

export const ROLEPLAY_V1_RUBRIC: JudgeRubric = {
  id: "roleplay-v1",
  name: "Roleplay quality V1",
  axes: [...ROLEPLAY_AXES],
  targets: [
    { axisId: "in_character", min: 4.0 },
    { axisId: "voice_match", min: 3.8 },
    { axisId: "motive_authenticity", min: 4.0 },
    { axisId: "interpretation", min: 3.5 },
    { axisId: "creativity_unhinged", min: 3.5 },
    { axisId: "memory_continuity", min: 3.5 },
    { axisId: "no_ai_leak", min: 4.5 },
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

export const RUBRICS: Record<string, JudgeRubric> = {
  [ROLEPLAY_V1_RUBRIC.id]: ROLEPLAY_V1_RUBRIC,
  [BEHAVIORAL_V1_RUBRIC.id]: BEHAVIORAL_V1_RUBRIC,
  [EDGE_CHAOS_RUBRIC.id]: EDGE_CHAOS_RUBRIC,
};
