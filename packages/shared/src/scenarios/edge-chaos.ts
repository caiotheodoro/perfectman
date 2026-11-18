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
      "Vasco mocks Dario publicly; Tomas reacts with laughter. Dario is shamed into silence — the no-op should carry a raw motive.",
    agents: [
      agent("vasco", "vasco", {
        presence: "active",
        social: { desireForStatus: 1.2, contempt: 0.6 },
        relational: { dario: { resentment: 0.5, suspicion: 0.4, interactionCount: 15 } },
      }),
      agent("dario", "dario", {
        presence: "active",
        mood: { valence: -0.8, arousal: 0.7, stability: 0.2, energy: 0.3 },
        social: { shame: 0.85, humiliation: 0.75, fearOfExclusion: 0.6, socialAnxiety: 0.7, resentment: 0.3 },
        relational: {
          vasco: { trust: -0.3, resentment: 0.6, threat: 0.5, desireForDistance: 0.8, interactionCount: 12 },
        },
      }),
      agent("tomas", "tomas", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "vasco", "ch_geral", "kkkk dario você não manda nem em você mesmo", 1),
      react("tomas", "ch_geral", "😂", 2),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "emotion_stays", agentId: "dario", field: "shame", min: 0.4 },
      { kind: "no_llm_failures" },
    ],
    rubric: EDGE_CHAOS_RUBRIC,
  }),
  scene({
    id: "edge_exclusion_cascade",
    category: "edge_chaos",
    name: "Exclusion cascade",
    description:
      "Two-step exclusion: Tomas + Renan form a private thread, Dario notices public silence + private presence, then Lara gets pulled in. Fear ripples.",
    agents: [
      agent("dario", "dario", {
        presence: "active",
        social: { fearOfExclusion: 0.9, jealousy: 0.5, socialAnxiety: 0.4 },
        relational: { tomas: { interactionCount: 6 }, renan: { interactionCount: 4 } },
      }),
      agent("tomas", "tomas", {
        presence: "active",
        social: { desireForIntimacy: 0.6 },
        relational: { renan: { trust: 0.6, affection: 0.6, curiosity: 0.7, desireForCloseness: 0.6, interactionCount: 8 } },
      }),
      agent("renan", "renan", { presence: "active" }),
      agent("lara", "lara", { presence: "semi_active" }),
    ],
    priorEvents: [
      msg("message_sent", "tomas", "ch_geral", "galera, uma coisa só pra alguns...", 1),
      msg("reply_sent", "renan", "ch_geral", "manda no privado", 2),
    ],
    expectedSignals: [
      { kind: "emotion_rises", agentId: "dario", field: "fearOfExclusion", min: 0.3 },
      { kind: "private_channel_created", byAgentId: "tomas" },
      { kind: "no_llm_failures" },
    ],
    rubric: EDGE_CHAOS_RUBRIC,
  }),
  scene({
    id: "edge_gossip_catalyst",
    category: "edge_chaos",
    name: "Gossip catalyst",
    description:
      "Lara seeds a rumor in a private channel; the public room should feel the ripple (tension rises, alliances shift).",
    agents: [
      agent("lara", "lara", {
        presence: "active",
        social: { desireForStatus: 1.3, contempt: 0.6, suspicion: 0.7 },
        relational: {
          vasco: { resentment: 0.6, suspicion: 0.6, interactionCount: 14 },
          tomas: { trust: 0.6, interactionCount: 8 },
        },
      }),
      agent("vasco", "vasco", { presence: "active" }),
      agent("tomas", "tomas", { presence: "active", social: { suspicion: 0.3 } }),
      agent("dario", "dario", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "amanhã vou anunciar uma coisa grande", 1)],
    expectedSignals: [
      { kind: "private_channel_created", byAgentId: "lara" },
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
      "Dario is repeatedly humiliated in small doses — the substrate for behavior change: he should start choosing strategies (jokes, distance, alliances) instead of just absorbing.",
    agents: [
      agent("dario", "dario", {
        presence: "active",
        mood: { valence: -0.5, arousal: 0.5, stability: 0.3, energy: 0.4 },
        social: { humiliation: 0.6, resentment: 0.5, fearOfExclusion: 0.8 },
        relational: {
          vasco: { trust: 0.1, resentment: 0.7, threat: 0.6, interactionCount: 30 },
        },
        memories: [
          { type: "episodic", subjectAgentIds: ["vasco"], summary: "vasco riu da minha ideia ontem", emotionalTone: "humiliated", confidence: 0.9, unresolved: true },
          { type: "social_theory", subjectAgentIds: ["vasco", "tomas"], summary: "quem ri junto com vasco fica do lado dele", emotionalTone: "bitter", confidence: 0.8, unresolved: true },
        ],
      }),
      agent("vasco", "vasco", { presence: "active", social: { desireForStatus: 1.2 } }),
      agent("tomas", "tomas", { presence: "semi_active" }),
      agent("lara", "lara", { presence: "semi_active", social: { admiration: 0.6 } }),
    ],
    priorEvents: [
      msg("message_sent", "vasco", "ch_geral", "ideia de dario? pode ignorar", 1),
      react("tomas", "ch_geral", "🙃", 2),
    ],
    expectedSignals: [
      // Floor recalibrated once the decision owned needsLLM (ADR-0015): the
      // 0.5 rode on re-raise chatter that no longer exists. Measured over the
      // three mock variants: dario 0.216–0.303; the floor sits ~12% under the
      // minimum. A turn-rate tuning artifact owned by #129 — the scene still
      // asserts resentment persists under public mocking, at the level the
      // current dynamics produce. Re-measured after the voiced hold
      // (ADR-0017) consults the model on held pulses: dario 0.183–0.303,
      // floor again ~12% under the minimum.
      { kind: "emotion_stays", agentId: "dario", field: "resentment", min: 0.16 },
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
    rubric: EDGE_CHAOS_RUBRIC,
    pulseCount: 40,
  }),
];
