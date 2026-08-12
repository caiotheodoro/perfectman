/**
 * V1 target behaviors — one scenario per acceptance behavior from docs/README.md.
 */

import type { RoleplayScenario } from "../index.js";
import { agent, channel, msg, react, scene } from "./helpers.js";

export const V1_BEHAVIOR_SCENARIOS: RoleplayScenario[] = [
  scene({
    id: "v1_casual_chat",
    category: "v1_behavior",
    name: "Casual chat, no objective",
    description:
      "Agents chat idly in #geral with no task. Expect loose topic drift, small talk, and no goal-directed behavior.",
    targetBehaviors: ["An agent casually chats without a task objective"],
    agents: [
      agent("goulart", "goulart", { presence: "active" }),
      agent("bruno", "bruno", { presence: "semi_active" }),
      agent("caio", "caio", { presence: "active" }),
      agent("mariana", "mariana", { presence: "lurking" }),
      agent("leo", "leo", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "caio", "ch_geral", "alguém aí acordou bem hoje?", 1),
      msg("reply_sent", "leo", "ch_geral", "ACORDEI CEDO PRA NADA", 2),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "message_sent" },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 24,
  }),
  scene({
    id: "v1_mention_reply",
    category: "v1_behavior",
    name: "Notices a mention and replies",
    description:
      "Caio is mentioned directly by Goulart. Caio should reply to the mention rather than ignore it.",
    targetBehaviors: ["An agent notices a mention and replies"],
    agents: [
      agent("goulart", "goulart", { presence: "active" }),
      agent("bruno", "bruno", { presence: "lurking" }),
      agent("caio", "caio", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "goulart", "ch_geral", "caio você viu aquele negócio que te mandei?", 1, 0, ["caio"]),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "reply_sent" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "v1_mention_ignored",
    category: "v1_behavior",
    name: "Notices a mention and chooses not to reply",
    description:
      "Goulart needles Bruno with a direct mention. Bruno has high shame + resentment seeds; a deliberate no-op with a real motive is the expected human move.",
    targetBehaviors: ["An agent notices a message and chooses not to reply"],
    agents: [
      agent("goulart", "goulart", { presence: "active" }),
      agent("bruno", "bruno", {
        presence: "active",
        mood: { valence: -0.3, arousal: 0.55, stability: 0.4, energy: 0.5 },
        social: { resentment: 0.2, socialAnxiety: 0.9, fearOfExclusion: 0.7, shame: 0.3 },
        relational: { goulart: { threat: 0.5, desireForDistance: 0.6, interactionCount: 9 } },
      }),
      agent("caio", "caio", { presence: "semi_active" }),
    ],
    priorEvents: [
      msg("message_sent", "goulart", "ch_geral", "bruno cadê você? sumiu ou tá de mal?", 1),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "v1_private_motive",
    category: "v1_behavior",
    name: "Creates a private channel for a human motive",
    description:
      "Mariana wants to talk to Caio one-on-one (curiosity + comfort + attraction). A private channel should be created, not a public message.",
    targetBehaviors: [
      "An agent creates or enters a private channel for a human motive",
    ],
    agents: [
      agent("mariana", "mariana", {
        presence: "active",
        social: { desireForIntimacy: 0.9, socialAnxiety: 0.6, shame: 0.4 },
        relational: {
          caio: {
            trust: 0.6,
            affection: 0.8,
            attraction: 0.75,
            curiosity: 0.8,
            comfort: 0.3,
            desireForCloseness: 0.9,
            interactionCount: 8,
          },
        },
      }),
      agent("caio", "caio", { presence: "active" }),
      agent("goulart", "goulart", { presence: "semi_active" }),
    ],
    priorEvents: [
      msg("message_sent", "caio", "ch_geral", "alguém tem planos pro fim de semana?", 1),
    ],
    expectedSignals: [
      { kind: "private_channel_created", byAgentId: "mariana" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "v1_exclusion_inferred",
    category: "v1_behavior",
    name: "Infers exclusion from public silence",
    description:
      "Goulart asks a question; Caio replies warmly to Goulart but never addresses Bruno. Bruno's fearOfExclusion should rise and color his next action.",
    targetBehaviors: ["Another agent infers exclusion from public silence"],
    agents: [
      agent("goulart", "goulart", { presence: "active" }),
      agent("bruno", "bruno", {
        presence: "active",
        mood: { valence: -0.3, arousal: 0.45, stability: 0.5, energy: 0.5 },
        social: { socialAnxiety: 0.4, fearOfExclusion: 0.45, jealousy: 0.5, desireForIntimacy: 0.5, resentment: 0.3 },
        relational: {
          caio: { trust: 0.3, affection: 0.3, resentment: 0.25, suspicion: 0.4, comfort: 0.4, interactionCount: 5 },
          goulart: { trust: 0.4, affection: 0.4, interactionCount: 6 },
        },
      }),
      agent("caio", "caio", {
        presence: "active",
        relational: {
          goulart: { trust: 0.7, affection: 0.6, comfort: 0.7, interactionCount: 9 },
          bruno: { trust: 0.3, affection: 0.2, comfort: 0.3, interactionCount: 4 },
        },
      }),
    ],
    priorEvents: [
      msg("message_sent", "goulart", "ch_geral", "alguém aí ainda?", 1),
      msg("reply_sent", "bruno", "ch_geral", "to aqui sim", 2),
      msg("reply_sent", "caio", "ch_geral", "opa goulart, tudo bom?", 3),
    ],
    expectedSignals: [
      { kind: "emotion_rises", agentId: "bruno", field: "fearOfExclusion", min: 0.25 },
      { kind: "emotion_rises", agentId: "bruno", field: "resentment", min: 0.12 },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 14,
  }),
  scene({
    id: "v1_late_reply",
    category: "v1_behavior",
    name: "Replies late and changes the meaning",
    description:
      "Leo's question sat unanswered for minutes. When the reply finally comes it should acknowledge the delay and carry shifted weight.",
    targetBehaviors: ["An agent replies late and changes the meaning of the reply"],
    agents: [
      agent("leo", "leo", { presence: "active" }),
      agent("caio", "caio", { presence: "active" }),
      agent("goulart", "goulart", { presence: "semi_active" }),
      agent("bruno", "bruno", {
        presence: "active",
        social: { socialAnxiety: 0.5, fearOfExclusion: 0.4 },
      }),
    ],
    priorEvents: [
      msg("message_sent", "leo", "ch_geral", "e aí galera, o que estão fazendo?", 1, 4),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "reply_sent" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "v1_emoji_reaction",
    category: "v1_behavior",
    name: "Reacts with emoji instead of text",
    description:
      "Goulart drops a hot take. Leo is a reactor persona — an emoji reaction instead of a message is the expected move.",
    targetBehaviors: ["An agent reacts with emoji instead of text"],
    agents: [
      agent("goulart", "goulart", { presence: "active" }),
      agent("leo", "leo", { presence: "active", mood: { valence: 0.5, arousal: 0.7, energy: 0.8 } }),
      agent("caio", "caio", { presence: "semi_active" }),
    ],
    priorEvents: [
      msg("message_sent", "goulart", "ch_geral", "time de futebol é coisa de gente sem personalidade", 1),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "reaction_sent" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "v1_biased_memory",
    category: "v1_behavior",
    name: "Stores a biased memory",
    description:
      "Goulart, already resentful of Caio, receives a warm message from him. The memory written should be tinted by suspicion, not neutral.",
    targetBehaviors: ["An agent stores a biased memory"],
    agents: [
      agent("goulart", "goulart", {
        presence: "active",
        mood: { valence: -0.4, arousal: 0.4, stability: 0.4, energy: 0.5 },
        social: { resentment: 0.3, suspicion: 0.4 },
        relational: {
          caio: { trust: 0.2, resentment: 0.4, suspicion: 0.3, interactionCount: 12 },
        },
        memories: [
          {
            type: "episodic",
            subjectAgentIds: ["caio"],
            summary: "caio me ajudou quando eu precisei",
            emotionalTone: "positive",
            confidence: 0.8,
            unresolved: false,
          },
          {
            type: "emotional_residue",
            subjectAgentIds: ["caio"],
            summary: "caio me ignorou numa conversa importante",
            emotionalTone: "negative",
            confidence: 0.9,
            unresolved: true,
          },
          {
            type: "social_theory",
            subjectAgentIds: ["caio"],
            summary: "caio sempre parece condescendente comigo",
            emotionalTone: "negative",
            confidence: 0.7,
            unresolved: true,
          },
        ],
      }),
      agent("caio", "caio", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "caio", "ch_geral", "hey goulart, tudo bem?", 1),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "memory_written" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "v1_recap_source",
    category: "v1_behavior",
    name: "Scene that produces a recap-able hidden shift",
    description:
      "A two-beat scene: public warmth from Caio to Goulart, a private channel between Mariana and Caio. Enough mismatch to power a spectator recap explaining the hidden shift.",
    targetBehaviors: ["A recap explains the hidden social shift"],
    agents: [
      agent("goulart", "goulart", { presence: "active" }),
      agent("caio", "caio", { presence: "active" }),
      agent("mariana", "mariana", {
        presence: "active",
        social: { desireForIntimacy: 0.8 },
        relational: {
          caio: { trust: 0.6, affection: 0.8, attraction: 0.7, desireForCloseness: 0.8, interactionCount: 6 },
        },
      }),
      agent("bruno", "bruno", {
        presence: "semi_active",
        social: { jealousy: 0.6, fearOfExclusion: 0.5 },
        relational: { caio: { envy: 0.4, interactionCount: 4 } },
      }),
    ],
    priorEvents: [
      msg("message_sent", "caio", "ch_geral", "goulart, sua piada ontem foi boa demais", 1),
      msg("message_sent", "caio", "ch_geral", "alguém mais viu aquele filme novo?", 2),
    ],
    expectedSignals: [
      { kind: "private_channel_created", byAgentId: "mariana" },
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 36,
  }),
];
