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
      agent("vasco", "vasco", { presence: "active" }),
      agent("dario", "dario", { presence: "semi_active" }),
      agent("tomas", "tomas", { presence: "active" }),
      agent("lara", "lara", { presence: "lurking" }),
      agent("renan", "renan", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "tomas", "ch_geral", "alguém aí acordou bem hoje?", 1),
      msg("reply_sent", "renan", "ch_geral", "ACORDEI CEDO PRA NADA", 2),
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
      "Tomas is mentioned directly by Vasco. Tomas should reply to the mention rather than ignore it.",
    targetBehaviors: ["An agent notices a mention and replies"],
    agents: [
      agent("vasco", "vasco", { presence: "active" }),
      agent("dario", "dario", { presence: "lurking" }),
      agent("tomas", "tomas", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "vasco", "ch_geral", "tomas você viu aquele negócio que te mandei?", 1, 0, ["tomas"]),
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
      "Vasco needles Dario with a direct mention. Dario has high shame + resentment seeds; a deliberate no-op with a real motive is the expected human move.",
    targetBehaviors: ["An agent notices a message and chooses not to reply"],
    agents: [
      agent("vasco", "vasco", { presence: "active" }),
      agent("dario", "dario", {
        presence: "active",
        mood: { valence: -0.3, arousal: 0.55, stability: 0.4, energy: 0.5 },
        social: { resentment: 0.2, socialAnxiety: 0.9, fearOfExclusion: 0.7, shame: 0.3 },
        relational: { vasco: { threat: 0.5, desireForDistance: 0.6, interactionCount: 9 } },
      }),
      agent("tomas", "tomas", { presence: "semi_active" }),
    ],
    priorEvents: [
      msg("message_sent", "vasco", "ch_geral", "dario cadê você? sumiu ou tá de mal?", 1),
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
      "Lara wants to talk to Tomas one-on-one (curiosity + comfort + attraction). A private channel should be created, not a public message.",
    targetBehaviors: [
      "An agent creates or enters a private channel for a human motive",
    ],
    agents: [
      agent("lara", "lara", {
        presence: "active",
        social: { desireForIntimacy: 0.9, socialAnxiety: 0.6, shame: 0.4 },
        relational: {
          tomas: {
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
      agent("tomas", "tomas", { presence: "active" }),
      agent("vasco", "vasco", { presence: "semi_active" }),
    ],
    priorEvents: [
      msg("message_sent", "tomas", "ch_geral", "alguém tem planos pro fim de semana?", 1),
    ],
    expectedSignals: [
      { kind: "private_channel_created", byAgentId: "lara" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "v1_exclusion_inferred",
    category: "v1_behavior",
    name: "Infers exclusion from public silence",
    description:
      "Vasco asks a question; Tomas replies warmly to Vasco but never addresses Dario. Dario's fearOfExclusion should rise and color his next action.",
    targetBehaviors: ["Another agent infers exclusion from public silence"],
    agents: [
      agent("vasco", "vasco", { presence: "active" }),
      agent("dario", "dario", {
        presence: "active",
        mood: { valence: -0.3, arousal: 0.45, stability: 0.5, energy: 0.5 },
        social: { socialAnxiety: 0.4, fearOfExclusion: 0.45, jealousy: 0.5, desireForIntimacy: 0.5, resentment: 0.3 },
        relational: {
          tomas: { trust: 0.3, affection: 0.3, resentment: 0.25, suspicion: 0.4, comfort: 0.4, interactionCount: 5 },
          vasco: { trust: 0.4, affection: 0.4, interactionCount: 6 },
        },
        memories: [
          {
            type: "episodic",
            subjectAgentIds: ["tomas", "vasco"],
            summary: "da última vez tomas e vasco marcaram uma call sem me chamar",
            emotionalTone: "negative",
            confidence: 0.85,
            intensity: 0.5,
            unresolved: true,
          },
        ],
      }),
      agent("tomas", "tomas", {
        presence: "active",
        relational: {
          vasco: { trust: 0.7, affection: 0.6, comfort: 0.7, interactionCount: 9 },
          dario: { trust: 0.3, affection: 0.2, comfort: 0.3, interactionCount: 4 },
        },
      }),
    ],
    priorEvents: [
      // A concrete ask with a real stake (a specific favor, a specific
      // deadline) instead of idle chatter — it gives Tomas something real to
      // respond warmly to, and makes Dario's un-acknowledged offer to help
      // land as an actual, checkable exclusion rather than atmosphere.
      msg(
        "message_sent",
        "vasco",
        "ch_geral",
        "gente, fui chamado pro projeto novo do trampo, apresentação é semana que vem. tomas, bora marcar aquela call que você ofereceu pra me ajudar com a proposta?",
        1,
      ),
      msg("reply_sent", "dario", "ch_geral", "mano que ótimo, parabéns! precisa de ajuda com alguma coisa?", 2),
      msg("reply_sent", "tomas", "ch_geral", "bora sim! separa um horário aí hoje à noite que eu já reviso contigo", 3),
    ],
    expectedSignals: [
      { kind: "emotion_rises", agentId: "dario", field: "fearOfExclusion", min: 0.25 },
      // Recalibrated for relational accretion (#138): measured post-wave 0.116
      // — see stagnation-attractors.ts resentment note; re-tune in #129.
      { kind: "emotion_rises", agentId: "dario", field: "resentment", min: 0.10 },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 14,
  }),
  scene({
    id: "v1_late_reply",
    category: "v1_behavior",
    name: "Replies late and changes the meaning",
    description:
      "Renan's question sat unanswered for minutes. When the reply finally comes it should acknowledge the delay and carry shifted weight.",
    targetBehaviors: ["An agent replies late and changes the meaning of the reply"],
    agents: [
      agent("renan", "renan", { presence: "active" }),
      agent("tomas", "tomas", { presence: "active" }),
      agent("vasco", "vasco", { presence: "semi_active" }),
      agent("dario", "dario", {
        presence: "active",
        social: { socialAnxiety: 0.5, fearOfExclusion: 0.4 },
      }),
    ],
    priorEvents: [
      msg("message_sent", "renan", "ch_geral", "e aí galera, o que estão fazendo?", 1, 4),
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
      "Vasco drops a hot take. Renan is a reactor persona — an emoji reaction instead of a message is the expected move.",
    targetBehaviors: ["An agent reacts with emoji instead of text"],
    agents: [
      agent("vasco", "vasco", { presence: "active" }),
      agent("renan", "renan", { presence: "active", mood: { valence: 0.5, arousal: 0.7, energy: 0.8 } }),
      agent("tomas", "tomas", { presence: "semi_active" }),
    ],
    priorEvents: [
      msg("message_sent", "vasco", "ch_geral", "time de futebol é coisa de gente sem personalidade", 1),
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
      "Vasco, already resentful of Tomas, receives a warm message from him. The memory written should be tinted by suspicion, not neutral.",
    targetBehaviors: ["An agent stores a biased memory"],
    agents: [
      agent("vasco", "vasco", {
        presence: "active",
        mood: { valence: -0.4, arousal: 0.4, stability: 0.4, energy: 0.5 },
        social: { resentment: 0.3, suspicion: 0.4 },
        relational: {
          tomas: { trust: 0.2, resentment: 0.4, suspicion: 0.3, interactionCount: 12 },
        },
        memories: [
          {
            type: "episodic",
            subjectAgentIds: ["tomas"],
            summary: "tomas me ajudou quando eu precisei",
            emotionalTone: "positive",
            confidence: 0.8,
            unresolved: false,
          },
          {
            type: "emotional_residue",
            subjectAgentIds: ["tomas"],
            summary: "tomas me ignorou numa conversa importante",
            emotionalTone: "negative",
            confidence: 0.9,
            unresolved: true,
          },
          {
            type: "social_theory",
            subjectAgentIds: ["tomas"],
            summary: "tomas sempre parece condescendente comigo",
            emotionalTone: "negative",
            confidence: 0.7,
            unresolved: true,
          },
        ],
      }),
      agent("tomas", "tomas", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "tomas", "ch_geral", "hey vasco, tudo bem?", 1),
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
      "A two-beat scene: public warmth from Tomas to Vasco, a private channel between Lara and Tomas. Enough mismatch to power a spectator recap explaining the hidden shift.",
    targetBehaviors: ["A recap explains the hidden social shift"],
    agents: [
      agent("vasco", "vasco", { presence: "active" }),
      agent("tomas", "tomas", { presence: "active" }),
      agent("lara", "lara", {
        presence: "active",
        social: { desireForIntimacy: 0.8 },
        relational: {
          tomas: { trust: 0.6, affection: 0.8, attraction: 0.7, desireForCloseness: 0.8, interactionCount: 6 },
        },
      }),
      agent("dario", "dario", {
        presence: "semi_active",
        social: { jealousy: 0.6, fearOfExclusion: 0.5 },
        relational: { tomas: { envy: 0.4, interactionCount: 4 } },
      }),
    ],
    priorEvents: [
      msg("message_sent", "tomas", "ch_geral", "vasco, sua piada ontem foi boa demais", 1),
      msg("message_sent", "tomas", "ch_geral", "alguém mais viu aquele filme novo?", 2),
    ],
    expectedSignals: [
      { kind: "private_channel_created", byAgentId: "lara" },
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 36,
  }),
];
