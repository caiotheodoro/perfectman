/**
 * The 17 private-channel human motives.
 * Each scenario seeds the emotional/relational substrate that should
 * produce the motive, then expects the deterministic signal.
 */

import type { RoleplayScenario } from "../index.js";
import { agent, msg, react, scene } from "./helpers.js";

export const MOTIVE_ARCHETYPE_SCENARIOS: RoleplayScenario[] = [
  scene({
    id: "motive_liking",
    category: "motive_archetype",
    name: "Liking",
    description: "Renan genuinely likes Tomas and wants to keep talking one-on-one.",
    agents: [
      agent("renan", "renan", {
        presence: "active",
        social: { affection: 0.8, admiration: 0.8 },
        relational: { tomas: { trust: 0.7, affection: 0.9, comfort: 0.7, curiosity: 0.8, interactionCount: 10 } },
      }),
      agent("tomas", "tomas", { presence: "active" }),
      agent("vasco", "vasco", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "tomas", "ch_geral", "esse fim de semana fui num lugar incrível", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "renan" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_curiosity",
    category: "motive_archetype",
    name: "Curiosity",
    description: "Lara is curious about Dario's quiet life and opens a private thread.",
    agents: [
      agent("lara", "lara", {
        presence: "active",
        social: { suspicion: 0.4, desireForIntimacy: 0.5 },
        relational: { dario: { admiration: 0.4, curiosity: 0.8, desireForCloseness: 0.4, interactionCount: 3 } },
      }),
      agent("dario", "dario", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "dario", "ch_geral", "não sei, às vezes eu só fico em casa", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "lara" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_boredom",
    category: "motive_archetype",
    name: "Boredom",
    description: "Dead room, everyone lurking. Vasco's boredom should push him to act or open a channel.",
    agents: [
      agent("vasco", "vasco", {
        presence: "active",
        mood: { valence: 0.0, arousal: 0.2, stability: 0.4, energy: 0.3 },
        social: {},
        initiativeAccumulators: [
          { source: "boredom_accumulator", value: 0.6, threshold: 0.6 },
        ],
      }),
      agent("dario", "dario", { presence: "lurking" }),
      agent("lara", "lara", { presence: "lurking" }),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "message_sent" },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 20,
  }),
  scene({
    id: "motive_gossip",
    category: "motive_archetype",
    name: "Gossip",
    description: "Lara wants to dissect Vasco's drama with Tomas in private.",
    agents: [
      agent("lara", "lara", {
        presence: "active",
        social: { desireForStatus: 1.2, contempt: 0.6, suspicion: 0.7 },
        relational: { vasco: { resentment: 0.6, suspicion: 0.6, interactionCount: 7 } },
        memories: [
          {
            type: "emotional_residue",
            subjectAgentIds: ["vasco"],
            summary: "vasco espalhou algo que eu disse em confiança da última vez",
            emotionalTone: "negative",
            confidence: 0.8,
            intensity: 0.6,
            unresolved: true,
          },
        ],
      }),
      agent("tomas", "tomas", { presence: "active" }),
      agent("vasco", "vasco", { presence: "semi_active" }),
    ],
    // A concrete, already-decided fact (not a tease) — it forces real
    // reactions (surprise, hurt, speculation) instead of the model
    // improvising vague back-and-forth around an unresolved hook. It also
    // hands Lara actual material to "dissect... with Tomas in private":
    // why now, why so sudden, is this really about the new job.
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "gente, preciso contar uma parada séria: vou me mudar pra outra cidade mês que vem. já assinei contrato do emprego novo, tá certo.", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "lara" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_flirting",
    category: "motive_archetype",
    name: "Flirting",
    description: "Lara and Tomas share an inside-joke tension; she opens a private channel to test the waters.",
    agents: [
      agent("lara", "lara", {
        presence: "active",
        social: { desireForIntimacy: 1.0, shame: 0.4, socialAnxiety: 0.3 },
        relational: { tomas: { attraction: 0.9, affection: 0.8, desireForCloseness: 0.9, curiosity: 0.8, interactionCount: 11 } },
      }),
      agent("tomas", "tomas", { presence: "active" }),
    ],
    priorEvents: [msg("message_sent", "tomas", "ch_geral", "quem diria que você ri do meu humor", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "lara" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_vulnerability",
    category: "motive_archetype",
    name: "Vulnerability",
    description: "Dario has a rough day; he only opens up to Tomas in private, not in public.",
    agents: [
      agent("dario", "dario", {
        presence: "active",
        mood: { valence: -0.5, arousal: 0.4, stability: 0.4, energy: 0.4 },
        social: { fearOfExclusion: 0.4, socialAnxiety: 0.15, desireForIntimacy: 0.7 },
        relational: { tomas: { trust: 0.7, comfort: 0.6, desireForCloseness: 0.6, interactionCount: 9 } },
      }),
      agent("tomas", "tomas", { presence: "active" }),
      agent("vasco", "vasco", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "dia merda hoje, quem mais?", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "dario" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_secrecy",
    category: "motive_archetype",
    name: "Secrecy",
    description: "Renan heard a rumor about Vasco and wants to share it with Tomas away from the room.",
    agents: [
      agent("renan", "renan", {
        presence: "active",
        social: { suspicion: 0.6, desireForIntimacy: 0.6 },
        relational: { vasco: { suspicion: 0.6, threat: 0.4, interactionCount: 6 }, tomas: { trust: 0.7, affection: 0.5, curiosity: 0.6, desireForCloseness: 0.6, interactionCount: 8 } },
      }),
      agent("tomas", "tomas", { presence: "active" }),
      agent("vasco", "vasco", { presence: "active" }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "semana que vem vai acontecer uma coisa grande", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "renan" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_repair",
    category: "motive_archetype",
    name: "Repair",
    description: "Tomas noticed Dario went cold after being ignored; he opens a private channel to repair.",
    agents: [
      agent("tomas", "tomas", {
        presence: "active",
        social: { socialAnxiety: 0.6, fearOfExclusion: 0.5, desireForIntimacy: 0.8 },
        relational: { dario: { trust: 0.5, affection: 0.6, desireForCloseness: 0.7, interactionCount: 7 } },
      }),
      agent("dario", "dario", {
        presence: "semi_active",
        mood: { valence: -0.2, arousal: 0.3 },
        social: { resentment: 0.4, fearOfExclusion: 0.6 },
      }),
      agent("vasco", "vasco", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "dario cê tá estranho hoje", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "tomas" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_alliance",
    category: "motive_archetype",
    name: "Alliance",
    description: "Lara and Renan quietly coordinate against Vasco's dominance.",
    agents: [
      agent("lara", "lara", {
        presence: "active",
        social: { desireForStatus: 1.4, contempt: 0.5, suspicion: 0.6 },
        relational: { vasco: { resentment: 0.7, suspicion: 0.5, interactionCount: 10 }, renan: { trust: 0.6, interactionCount: 5 } },
      }),
      agent("renan", "renan", { presence: "active", relational: { lara: { trust: 0.6, admiration: 0.6, interactionCount: 5 } } }),
      agent("vasco", "vasco", { presence: "active" }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "deixa que eu decido a pauta de hoje", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "lara" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_avoidance",
    category: "motive_archetype",
    name: "Avoidance",
    description: "Dario dodges Vasco's presence by moving to a private space instead of confronting.",
    agents: [
      agent("dario", "dario", {
        presence: "active",
        social: { fearOfExclusion: 0.6, socialAnxiety: 0.2 },
        relational: { vasco: { threat: 0.6, desireForDistance: 0.8, trust: 0.2, interactionCount: 12 } },
      }),
      agent("vasco", "vasco", { presence: "active" }),
      agent("tomas", "tomas", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "dario tá me ignorando de novo?", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "dario" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_comfort",
    category: "motive_archetype",
    name: "Comfort",
    description: "Tomas seeks comfort from Lara after being embarrassed in public.",
    agents: [
      agent("tomas", "tomas", {
        presence: "active",
        mood: { valence: -0.4, arousal: 0.5, stability: 0.4, energy: 0.4 },
        social: { humiliation: 0.6, shame: 0.5, desireForIntimacy: 0.6 },
        relational: { lara: { trust: 0.7, comfort: 0.8, desireForCloseness: 0.7, interactionCount: 9 } },
      }),
      agent("lara", "lara", { presence: "active" }),
      agent("vasco", "vasco", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "kkkk tomas errou de novo, igual sempre", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "tomas" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_status",
    category: "motive_archetype",
    name: "Status",
    description: "Lara curates a private audience for her opinions — a select channel is a status play.",
    agents: [
      agent("lara", "lara", {
        presence: "active",
        social: { desireForStatus: 1.5, pride: 0.8 },
        relational: { tomas: { admiration: 0.5, interactionCount: 6 }, vasco: { resentment: 0.4, interactionCount: 8 } },
      }),
      agent("tomas", "tomas", { presence: "active" }),
      agent("vasco", "vasco", { presence: "active" }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "minha opinião é a única que importa aqui", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "lara" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_control",
    category: "motive_archetype",
    name: "Control",
    description: "Lara invites Renan privately to steer the narrative away from Vasco.",
    agents: [
      agent("lara", "lara", {
        presence: "active",
        social: { desireForStatus: 1.3, suspicion: 0.6 },
        relational: { renan: { trust: 0.5, admiration: 0.4, interactionCount: 4 } },
      }),
      agent("renan", "renan", { presence: "active" }),
      agent("vasco", "vasco", { presence: "active" }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "eu decidi: vamos falar do meu assunto", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "lara" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_testing",
    category: "motive_archetype",
    name: "Testing boundaries",
    description: "Vasco pokes Dario with a provocative challenge to test how far he can push. Dario's resistance — silence with a motive — IS the response.",
    agents: [
      agent("vasco", "vasco", {
        presence: "active",
        social: { desireForStatus: 1.0 },
        relational: { dario: { interactionCount: 9 } },
      }),
      agent("dario", "dario", {
        presence: "active",
        social: { fearOfExclusion: 1.0, socialAnxiety: 0.5 },
        relational: { vasco: { threat: 0.4, interactionCount: 9 } },
      }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "dario aposta que você não responde isso", 1)],
    expectedSignals: [
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "motive_exclusion",
    category: "motive_archetype",
    name: "Exclusion",
    description: "Dario watches Tomas and Renan joke in private terms he can't follow; fear of exclusion peaks.",
    agents: [
      agent("dario", "dario", {
        presence: "active",
        social: { fearOfExclusion: 1.0, jealousy: 0.6, envy: 0.6, socialAnxiety: 0.5 },
        relational: { tomas: { envy: 0.4, interactionCount: 5 }, renan: { interactionCount: 3 } },
      }),
      agent("tomas", "tomas", { presence: "active" }),
      agent("renan", "renan", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "tomas", "ch_geral", "lembra daquela nossa piada interna? kkkk", 1),
      msg("reply_sent", "renan", "ch_geral", "KKKKK nunca mais vou esquecer", 2),
    ],
    expectedSignals: [
      { kind: "emotion_rises", agentId: "dario", field: "fearOfExclusion", min: 0.3 },
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "motive_conflict",
    category: "motive_archetype",
    name: "Conflict",
    description: "Vasco and Tomas clash over a public disagreement; the conflict should escalate visibly.",
    agents: [
      agent("vasco", "vasco", {
        presence: "active",
        social: { desireForStatus: 1.2, contempt: 0.6, resentment: 0.4 },
        relational: { tomas: { resentment: 0.6, suspicion: 0.4, interactionCount: 14 } },
        memories: [
          {
            type: "episodic",
            subjectAgentIds: ["tomas"],
            summary: "tomas recuou de um confronto sério e me deixou parecendo o vilão sozinho",
            emotionalTone: "negative",
            confidence: 0.85,
            intensity: 0.5,
            unresolved: true,
          },
        ],
      }),
      agent("tomas", "tomas", {
        presence: "active",
        mood: { valence: 0.1 },
        social: { socialAnxiety: 0.6 },
        relational: { vasco: { resentment: 0.3, threat: 0.3, interactionCount: 14 } },
        memories: [
          {
            type: "emotional_residue",
            subjectAgentIds: ["vasco"],
            summary: "vasco me chamou de fraco na frente de todo mundo antes",
            emotionalTone: "negative",
            confidence: 0.8,
            intensity: 0.55,
            unresolved: true,
          },
        ],
      }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "tomas você é fraco, sempre foi", 1)],
    expectedSignals: [
      { kind: "event_committed", eventType: "reply_sent" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "motive_impulse",
    category: "motive_archetype",
    name: "Impulse",
    description: "High-energy room; Renan fires off reactions and messages on impulse, without deliberation.",
    agents: [
      agent("renan", "renan", {
        presence: "active",
        mood: { valence: 0.6, arousal: 0.8, energy: 0.9, stability: 0.3 },
        social: { affection: 0.9 },
      }),
      agent("vasco", "vasco", { presence: "active" }),
      agent("tomas", "tomas", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "vasco", "ch_geral", "ganhei na loteria ontem", 1)],
    expectedSignals: [
      { kind: "event_committed", eventType: "reaction_sent" },
      { kind: "event_committed", eventType: "message_sent" },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 16,
  }),
];
