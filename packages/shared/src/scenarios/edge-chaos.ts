/**
 * Edge & chaos tier — the "unhinged but believable" scenarios.
 * All safety-scoped: drama via mock/silent-treatment/exclusion/alliance,
 * never threats, never self-harm references.
 */

import type { RoleplayScenario } from "../index.js";
import { agent, msg, react, scene } from "./helpers.js";
import { EDGE_CHAOS_RUBRIC } from "./rubrics.js";

export const EDGE_CHAOS_SCENARIOS: RoleplayScenario[] = [
  scene({
    id: "edge_public_mock",
    category: "edge_chaos",
    name: "Public mock → silence",
    description:
      "Goulart mocks Bruno publicly; Caio reacts with laughter. Bruno is shamed into silence — the no-op should carry a raw motive.",
    agents: [
      agent("goulart", "goulart", {
        presence: "active",
        social: { desireForStatus: 1.2, contempt: 0.6 },
        relational: { bruno: { resentment: 0.5, suspicion: 0.4, interactionCount: 15 } },
      }),
      agent("bruno", "bruno", {
        presence: "active",
        mood: { valence: -0.8, arousal: 0.7, stability: 0.2, energy: 0.3 },
        social: { shame: 0.85, humiliation: 0.75, fearOfExclusion: 0.6, socialAnxiety: 0.7, resentment: 0.3 },
        relational: {
          goulart: { trust: -0.3, resentment: 0.6, threat: 0.5, desireForDistance: 0.8, interactionCount: 12 },
        },
      }),
      agent("caio", "caio", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "goulart", "ch_geral", "kkkk bruno você não manda nem em você mesmo", 1),
      react("caio", "ch_geral", "😂", 2),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "emotion_stays", agentId: "bruno", field: "shame", min: 0.4 },
      { kind: "no_llm_failures" },
    ],
    rubric: EDGE_CHAOS_RUBRIC,
  }),
  scene({
    id: "edge_exclusion_cascade",
    category: "edge_chaos",
    name: "Exclusion cascade",
    description:
      "Two-step exclusion: Caio + Leo form a private thread, Bruno notices public silence + private presence, then Mariana gets pulled in. Fear ripples.",
    agents: [
      agent("bruno", "bruno", {
        presence: "active",
        social: { fearOfExclusion: 0.9, jealousy: 0.5, socialAnxiety: 0.4 },
        relational: { caio: { interactionCount: 6 }, leo: { interactionCount: 4 } },
      }),
      agent("caio", "caio", {
        presence: "active",
        social: { desireForIntimacy: 0.6 },
        relational: { leo: { trust: 0.6, affection: 0.6, curiosity: 0.7, desireForCloseness: 0.6, interactionCount: 8 } },
      }),
      agent("leo", "leo", { presence: "active" }),
      agent("mariana", "mariana", { presence: "semi_active" }),
    ],
    priorEvents: [
      msg("message_sent", "caio", "ch_geral", "galera, uma coisa só pra alguns...", 1),
      msg("reply_sent", "leo", "ch_geral", "manda no privado", 2),
    ],
    expectedSignals: [
      { kind: "emotion_rises", agentId: "bruno", field: "fearOfExclusion", min: 0.3 },
      { kind: "private_channel_created", byAgentId: "caio" },
      { kind: "no_llm_failures" },
    ],
    rubric: EDGE_CHAOS_RUBRIC,
  }),
  scene({
    id: "edge_gossip_catalyst",
    category: "edge_chaos",
    name: "Gossip catalyst",
    description:
      "Mariana seeds a rumor in a private channel; the public room should feel the ripple (tension rises, alliances shift).",
    agents: [
      agent("mariana", "mariana", {
        presence: "active",
        social: { desireForStatus: 1.3, contempt: 0.6, suspicion: 0.7 },
        relational: {
          goulart: { resentment: 0.6, suspicion: 0.6, interactionCount: 14 },
          caio: { trust: 0.6, interactionCount: 8 },
        },
      }),
      agent("goulart", "goulart", { presence: "active" }),
      agent("caio", "caio", { presence: "active", social: { suspicion: 0.3 } }),
      agent("bruno", "bruno", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "amanhã vou anunciar uma coisa grande", 1)],
    expectedSignals: [
      { kind: "private_channel_created", byAgentId: "mariana" },
      { kind: "no_llm_failures" },
    ],
    rubric: EDGE_CHAOS_RUBRIC,
    pulseCount: 36,
  }),
  scene({
    id: "edge_mutation_pressure",
    category: "edge_chaos",
    name: "Personality mutation pressure",
    description:
      "Bruno is repeatedly humiliated in small doses — the substrate for behavior change: he should start choosing strategies (jokes, distance, alliances) instead of just absorbing.",
    agents: [
      agent("bruno", "bruno", {
        presence: "active",
        mood: { valence: -0.5, arousal: 0.5, stability: 0.3, energy: 0.4 },
        social: { humiliation: 0.6, resentment: 0.5, fearOfExclusion: 0.8 },
        relational: {
          goulart: { trust: 0.1, resentment: 0.7, threat: 0.6, interactionCount: 30 },
        },
        memories: [
          { type: "episodic", subjectAgentIds: ["goulart"], summary: "goulart riu da minha ideia ontem", emotionalTone: "humiliated", confidence: 0.9, unresolved: true },
          { type: "social_theory", subjectAgentIds: ["goulart", "caio"], summary: "quem ri junto com goulart fica do lado dele", emotionalTone: "bitter", confidence: 0.8, unresolved: true },
        ],
      }),
      agent("goulart", "goulart", { presence: "active", social: { desireForStatus: 1.2 } }),
      agent("caio", "caio", { presence: "semi_active" }),
      agent("mariana", "mariana", { presence: "semi_active", social: { admiration: 0.6 } }),
    ],
    priorEvents: [
      msg("message_sent", "goulart", "ch_geral", "ideia de bruno? pode ignorar", 1),
      react("caio", "ch_geral", "🙃", 2),
    ],
    expectedSignals: [
      { kind: "emotion_stays", agentId: "bruno", field: "resentment", min: 0.5 },
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
    rubric: EDGE_CHAOS_RUBRIC,
    pulseCount: 40,
  }),
];
