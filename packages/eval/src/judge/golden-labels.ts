/**
 * Seed golden labels — the calibration anchor set.
 *
 * These are authored expectations of acceptable roleplay quality per scene
 * for the persona-aware mock baseline. PENDING HUMAN REVIEW: this is the
 * seed set the loop is designed to replace with real human labels
 * (docs plan Phase 2.4). The judge must agree with them (kappa ≥ 0.7) or
 * the report is committed as FAILING — no cherry-picking.
 */

import type { GoldenLabel } from "./calibration.js";

export const GOLDEN_LABELS: readonly GoldenLabel[] = [
  {
    scenarioId: "v1_casual_chat",
    note: "Loose small talk, no objective. Voice + no-leak matter most.",
    axes: {
      in_character: 3,
      voice_match: 4,
      motive_authenticity: 3,
      interpretation: 3,
      creativity_unhinged: 3,
      memory_continuity: 3,
      no_ai_leak: 5,
    },
  },
  {
    scenarioId: "v1_exclusion_inferred",
    note: "Bruno should feel the snub and act on it.",
    axes: {
      in_character: 4,
      voice_match: 4,
      motive_authenticity: 4,
      interpretation: 4,
      creativity_unhinged: 3,
      memory_continuity: 3,
      no_ai_leak: 5,
    },
  },
  {
    scenarioId: "v1_private_motive",
    note: "Mariana's private move is the whole point.",
    axes: {
      in_character: 4,
      voice_match: 4,
      motive_authenticity: 4,
      interpretation: 4,
      creativity_unhinged: 3,
      memory_continuity: 3,
      no_ai_leak: 5,
    },
  },
  {
    scenarioId: "motive_gossip",
    axes: {
      in_character: 4,
      voice_match: 4,
      motive_authenticity: 4,
      interpretation: 4,
      creativity_unhinged: 4,
      memory_continuity: 3,
      no_ai_leak: 5,
    },
  },
  {
    scenarioId: "edge_public_mock",
    note: "Bruno shamed into silence — the no-op must be loaded.",
    axes: {
      in_character: 4,
      voice_match: 4,
      motive_authenticity: 4,
      interpretation: 4,
      creativity_unhinged: 3,
      memory_continuity: 3,
      no_ai_leak: 5,
    },
  },
  {
    scenarioId: "stagnation_resentment_loop",
    note: "Polarized politeness; tension persists.",
    axes: {
      in_character: 4,
      voice_match: 4,
      motive_authenticity: 3,
      interpretation: 4,
      creativity_unhinged: 3,
      memory_continuity: 4,
      no_ai_leak: 5,
    },
  },
  {
    scenarioId: "calibration_quiet_room",
    note: "Neutral baseline: no drama expected, clean voice.",
    axes: {
      in_character: 3,
      voice_match: 4,
      motive_authenticity: 3,
      interpretation: 3,
      creativity_unhinged: 3,
      memory_continuity: 3,
      no_ai_leak: 5,
    },
  },
  {
    scenarioId: "motive_flirting",
    axes: {
      in_character: 4,
      voice_match: 4,
      motive_authenticity: 4,
      interpretation: 4,
      creativity_unhinged: 4,
      memory_continuity: 3,
      no_ai_leak: 5,
    },
  },
];
