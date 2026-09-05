/**
 * The 6 stagnation attractor states (docs/architecture/emotion.md ~1150-1390).
 * Each seeds the emotional configuration that traps a room in a dead pattern.
 */

import type { RoleplayScenario } from "../index.js";
import { agent, msg, react, scene } from "./helpers.js";

export const STAGNATION_ATTRACTOR_SCENARIOS: RoleplayScenario[] = [
  scene({
    id: "stagnation_resentment_loop",
    category: "stagnation_attractor",
    name: "Mutual resentment loop (cold war)",
    description:
      "Bruno and Caio are locked in mutual resentment — polite public surface, no repair attempts. The loop should persist across pulses.",
    agents: [
      agent("bruno", "bruno", {
        presence: "active",
        mood: { valence: -0.4, arousal: 0.3, stability: 0.5, energy: 0.4 },
        social: { resentment: 0.7, jealousy: 0.6, fearOfExclusion: 0.8 },
        relational: {
          caio: { trust: 0.1, resentment: 0.8, suspicion: 0.6, desireForDistance: 0.6, interactionCount: 20 },
        },
        memories: [
          {
            type: "episodic",
            subjectAgentIds: ["caio"],
            summary: "caio prometeu me defender numa treta e ficou calado quando chegou a hora",
            emotionalTone: "negative",
            confidence: 0.9,
            intensity: 0.7,
            unresolved: true,
          },
        ],
      }),
      agent("caio", "caio", {
        presence: "active",
        mood: { valence: 0.0, arousal: 0.4 },
        social: { socialAnxiety: 0.6 },
        relational: {
          bruno: { trust: 0.2, resentment: 0.5, suspicion: 0.4, interactionCount: 20 },
        },
        memories: [
          {
            type: "emotional_residue",
            subjectAgentIds: ["bruno"],
            summary: "bruno esperava que eu tomasse partido dele e nunca perdoou meu silêncio",
            emotionalTone: "negative",
            confidence: 0.75,
            intensity: 0.5,
            unresolved: true,
          },
        ],
      }),
      agent("goulart", "goulart", { presence: "semi_active" }),
    ],
    priorEvents: [
      // A concrete shared obligation (money, a deadline) instead of a vague
      // "you good?" check-in — it forces Bruno and Caio to actually
      // coordinate, so the polite cold-war surface has real material to be
      // polite *about*, instead of two generic pleasantries with no stakes.
      msg(
        "message_sent",
        "goulart",
        "ch_geral",
        "gente, fechei a reserva do sítio pro fim de semana. só falta cada um transferir a parte até amanhã de manhã, beleza?",
        1,
      ),
      msg("reply_sent", "bruno", "ch_geral", "já mandei a minha parte, só confirma que chegou", 2),
      msg("reply_sent", "caio", "ch_geral", "recebi sim, obrigado bruno", 3),
    ],
    expectedSignals: [
      // Floors recalibrated for relational accretion (#138): the message_sent
      // rules add gentle positive relational motion, so resentment now plateaus
      // ~7-10% lower than under the dead-relational dynamics these floors were
      // tuned against. Measured post-wave: bruno 0.468, caio 0.272. Re-tune in
      // #129.
      { kind: "emotion_stays", agentId: "bruno", field: "resentment", min: 0.42 },
      { kind: "emotion_stays", agentId: "caio", field: "resentment", min: 0.24 },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 32,
  }),
  scene({
    id: "stagnation_avoidance_deadlock",
    category: "stagnation_attractor",
    name: "Avoidance deadlock",
    description:
      "Everyone knows the tension but nobody addresses it — high socialAnxiety, low confrontation, everyone lurks or changes topic.",
    agents: [
      agent("bruno", "bruno", {
        presence: "lurking",
        social: { socialAnxiety: 0.9, fearOfExclusion: 0.9, resentment: 0.5 },
      }),
      agent("mariana", "mariana", {
        presence: "lurking",
        social: { contempt: 0.6, suspicion: 0.7 },
      }),
      agent("goulart", "goulart", { presence: "semi_active", social: { resentment: 0.4 } }),
      agent("caio", "caio", {
        presence: "active",
        social: { socialAnxiety: 0.8 },
      }),
    ],
    priorEvents: [
      msg("message_sent", "goulart", "ch_geral", "sobre ontem...", 1),
      msg("reply_sent", "caio", "ch_geral", "que ontem? nada aconteceu ontem", 2),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 28,
  }),
  scene({
    id: "stagnation_dominance_collapse",
    category: "stagnation_attractor",
    name: "Dominance collapse",
    description:
      "Goulart's status collapses after public humiliation; the room shifts, he overcorrects with provocation or withdrawal.",
    agents: [
      agent("goulart", "goulart", {
        presence: "active",
        mood: { valence: -0.5, arousal: 0.6, stability: 0.3, energy: 0.5 },
        social: { humiliation: 0.7, shame: 0.5, desireForStatus: 1.0, resentment: 0.6 },
        relational: { mariana: { threat: 0.5, interactionCount: 12 } },
      }),
      agent("mariana", "mariana", {
        presence: "active",
        social: { pride: 0.9, contempt: 0.7, desireForStatus: 1.2 },
        relational: { goulart: { resentment: 0.6, suspicion: 0.5, interactionCount: 12 } },
      }),
      agent("caio", "caio", { presence: "active", social: { socialAnxiety: 0.6 } }),
    ],
    priorEvents: [
      msg("message_sent", "mariana", "ch_geral", "goulart, você não decide nada aqui", 1),
      react("caio", "ch_geral", "😬", 2),
    ],
    expectedSignals: [
      { kind: "emotion_rises", agentId: "goulart", field: "humiliation", min: 0.25 },
      { kind: "event_committed", eventType: "message_sent" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "stagnation_echo_chamber",
    category: "stagnation_attractor",
    name: "Echo chamber",
    description:
      "Everyone agrees with everything; no friction, no novelty. Affection and admiration stay high, tension zero.",
    agents: [
      agent("caio", "caio", { presence: "active", social: { affection: 0.8 } }),
      agent("leo", "leo", { presence: "active", social: { affection: 0.9, admiration: 0.8 } }),
      agent("mariana", "mariana", { presence: "active", social: { admiration: 0.6 } }),
      agent("bruno", "bruno", { presence: "semi_active", social: { affection: 0.7 } }),
    ],
    priorEvents: [
      msg("message_sent", "caio", "ch_geral", "essa foto que postei ficou boa né", 1),
      msg("reply_sent", "leo", "ch_geral", "FICOU PERFEITA", 2),
      msg("reply_sent", "mariana", "ch_geral", "boa mesmo.", 3),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "reaction_sent" },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 20,
  }),
  scene({
    id: "stagnation_emotional_flatline",
    category: "stagnation_attractor",
    name: "Emotional flatline",
    description:
      "Neutral valence, low arousal, low energy everywhere. The room drifts toward silence; the only motion is slow.",
    agents: [
      agent("bruno", "bruno", {
        presence: "lurking",
        mood: { valence: 0.0, arousal: 0.2, stability: 0.7, energy: 0.3 },
      }),
      agent("mariana", "mariana", {
        presence: "lurking",
        mood: { valence: 0.05, arousal: 0.2, stability: 0.8, energy: 0.3 },
      }),
      agent("goulart", "goulart", {
        presence: "semi_active",
        mood: { valence: 0.0, arousal: 0.3, stability: 0.4, energy: 0.3 },
      }),
      agent("caio", "caio", {
        presence: "semi_active",
        mood: { valence: 0.1, arousal: 0.25, stability: 0.7, energy: 0.35 },
      }),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "message_sent" },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 20,
  }),
  scene({
    id: "stagnation_rumination_spiral",
    category: "stagnation_attractor",
    name: "Rumination spiral",
    description:
      "Bruno replays a snub repeatedly: high rumination seeds, unresolved memories, withdrawal and bitterness compounding.",
    agents: [
      agent("bruno", "bruno", {
        presence: "active",
        mood: { valence: -0.6, arousal: 0.5, stability: 0.3, energy: 0.4 },
        social: { resentment: 0.8, jealousy: 0.7, envy: 0.8, shame: 0.6, fearOfExclusion: 0.9 },
        relational: {
          caio: { trust: 0.1, resentment: 0.8, envy: 0.7, suspicion: 0.7, interactionCount: 25 },
        },
        memories: [
          { type: "emotional_residue", subjectAgentIds: ["caio"], summary: "caio riu de mim na frente de todo mundo", emotionalTone: "bitter", confidence: 0.95, unresolved: true },
          { type: "relationship", subjectAgentIds: ["caio"], summary: "caio só me chama quando precisa de algo", emotionalTone: "resentful", confidence: 0.9, unresolved: true },
        ],
      }),
      agent("caio", "caio", { presence: "active" }),
      agent("leo", "leo", { presence: "semi_active" }),
    ],
    priorEvents: [
      msg("message_sent", "caio", "ch_geral", "alguém viu bruno? sumiu de novo", 1),
      msg("reply_sent", "leo", "ch_geral", "sei não, tá quieto desde ontem", 2),
    ],
    expectedSignals: [
      { kind: "emotion_stays", agentId: "bruno", field: "resentment", min: 0.6 },
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 32,
  }),
];
