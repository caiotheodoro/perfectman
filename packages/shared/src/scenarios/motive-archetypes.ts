/**
 * The 17 private-channel human motives (docs/notes/meeting-synthesis.md).
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
    description: "Leo genuinely likes Caio and wants to keep talking one-on-one.",
    agents: [
      agent("leo", "leo", {
        presence: "active",
        social: { affection: 0.8, admiration: 0.8 },
        relational: { caio: { trust: 0.7, affection: 0.9, comfort: 0.7, curiosity: 0.8, interactionCount: 10 } },
      }),
      agent("caio", "caio", { presence: "active" }),
      agent("goulart", "goulart", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "caio", "ch_geral", "esse fim de semana fui num lugar incrível", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "leo" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_curiosity",
    category: "motive_archetype",
    name: "Curiosity",
    description: "Mariana is curious about Bruno's quiet life and opens a private thread.",
    agents: [
      agent("mariana", "mariana", {
        presence: "active",
        social: { suspicion: 0.4, desireForIntimacy: 0.5 },
        relational: { bruno: { admiration: 0.4, curiosity: 0.8, desireForCloseness: 0.4, interactionCount: 3 } },
      }),
      agent("bruno", "bruno", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "bruno", "ch_geral", "não sei, às vezes eu só fico em casa", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "mariana" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_boredom",
    category: "motive_archetype",
    name: "Boredom",
    description: "Dead room, everyone lurking. Goulart's boredom should push him to act or open a channel.",
    agents: [
      agent("goulart", "goulart", {
        presence: "active",
        mood: { valence: 0.0, arousal: 0.2, stability: 0.4, energy: 0.3 },
        social: {},
        initiativeAccumulators: [
          { source: "boredom_accumulator", value: 0.6, threshold: 0.6 },
        ],
      }),
      agent("bruno", "bruno", { presence: "lurking" }),
      agent("mariana", "mariana", { presence: "lurking" }),
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
    description: "Mariana wants to dissect Goulart's drama with Caio in private.",
    agents: [
      agent("mariana", "mariana", {
        presence: "active",
        social: { desireForStatus: 1.2, contempt: 0.6, suspicion: 0.7 },
        relational: { goulart: { resentment: 0.6, suspicion: 0.6, interactionCount: 7 } },
      }),
      agent("caio", "caio", { presence: "active" }),
      agent("goulart", "goulart", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "vou contar uma coisa, mas ninguém espalha hein", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "mariana" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_flirting",
    category: "motive_archetype",
    name: "Flirting",
    description: "Mariana and Caio share an inside-joke tension; she opens a private channel to test the waters.",
    agents: [
      agent("mariana", "mariana", {
        presence: "active",
        social: { desireForIntimacy: 1.0, shame: 0.4, socialAnxiety: 0.3 },
        relational: { caio: { attraction: 0.9, affection: 0.8, desireForCloseness: 0.9, curiosity: 0.8, interactionCount: 11 } },
      }),
      agent("caio", "caio", { presence: "active" }),
    ],
    priorEvents: [msg("message_sent", "caio", "ch_geral", "quem diria que você ri do meu humor", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "mariana" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_vulnerability",
    category: "motive_archetype",
    name: "Vulnerability",
    description: "Bruno has a rough day; he only opens up to Caio in private, not in public.",
    agents: [
      agent("bruno", "bruno", {
        presence: "active",
        mood: { valence: -0.5, arousal: 0.4, stability: 0.4, energy: 0.4 },
        social: { fearOfExclusion: 0.4, socialAnxiety: 0.15, desireForIntimacy: 0.7 },
        relational: { caio: { trust: 0.7, comfort: 0.6, desireForCloseness: 0.6, interactionCount: 9 } },
      }),
      agent("caio", "caio", { presence: "active" }),
      agent("goulart", "goulart", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "dia merda hoje, quem mais?", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "bruno" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_secrecy",
    category: "motive_archetype",
    name: "Secrecy",
    description: "Leo heard a rumor about Goulart and wants to share it with Caio away from the room.",
    agents: [
      agent("leo", "leo", {
        presence: "active",
        social: { suspicion: 0.6, desireForIntimacy: 0.6 },
        relational: { goulart: { suspicion: 0.6, threat: 0.4, interactionCount: 6 }, caio: { trust: 0.7, affection: 0.5, curiosity: 0.6, desireForCloseness: 0.6, interactionCount: 8 } },
      }),
      agent("caio", "caio", { presence: "active" }),
      agent("goulart", "goulart", { presence: "active" }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "semana que vem vai acontecer uma coisa grande", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "leo" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_repair",
    category: "motive_archetype",
    name: "Repair",
    description: "Caio noticed Bruno went cold after being ignored; he opens a private channel to repair.",
    agents: [
      agent("caio", "caio", {
        presence: "active",
        social: { socialAnxiety: 0.6, fearOfExclusion: 0.5, desireForIntimacy: 0.8 },
        relational: { bruno: { trust: 0.5, affection: 0.6, desireForCloseness: 0.7, interactionCount: 7 } },
      }),
      agent("bruno", "bruno", {
        presence: "semi_active",
        mood: { valence: -0.2, arousal: 0.3 },
        social: { resentment: 0.4, fearOfExclusion: 0.6 },
      }),
      agent("goulart", "goulart", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "bruno cê tá estranho hoje", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "caio" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_alliance",
    category: "motive_archetype",
    name: "Alliance",
    description: "Mariana and Leo quietly coordinate against Goulart's dominance.",
    agents: [
      agent("mariana", "mariana", {
        presence: "active",
        social: { desireForStatus: 1.4, contempt: 0.5, suspicion: 0.6 },
        relational: { goulart: { resentment: 0.7, suspicion: 0.5, interactionCount: 10 }, leo: { trust: 0.6, interactionCount: 5 } },
      }),
      agent("leo", "leo", { presence: "active", relational: { mariana: { trust: 0.6, admiration: 0.6, interactionCount: 5 } } }),
      agent("goulart", "goulart", { presence: "active" }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "deixa que eu decido a pauta de hoje", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "mariana" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_avoidance",
    category: "motive_archetype",
    name: "Avoidance",
    description: "Bruno dodges Goulart's presence by moving to a private space instead of confronting.",
    agents: [
      agent("bruno", "bruno", {
        presence: "active",
        social: { fearOfExclusion: 0.6, socialAnxiety: 0.2 },
        relational: { goulart: { threat: 0.6, desireForDistance: 0.8, trust: 0.2, interactionCount: 12 } },
      }),
      agent("goulart", "goulart", { presence: "active" }),
      agent("caio", "caio", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "bruno tá me ignorando de novo?", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "bruno" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_comfort",
    category: "motive_archetype",
    name: "Comfort",
    description: "Caio seeks comfort from Mariana after being embarrassed in public.",
    agents: [
      agent("caio", "caio", {
        presence: "active",
        mood: { valence: -0.4, arousal: 0.5, stability: 0.4, energy: 0.4 },
        social: { humiliation: 0.6, shame: 0.5, desireForIntimacy: 0.6 },
        relational: { mariana: { trust: 0.7, comfort: 0.8, desireForCloseness: 0.7, interactionCount: 9 } },
      }),
      agent("mariana", "mariana", { presence: "active" }),
      agent("goulart", "goulart", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "kkkk caio errou de novo, igual sempre", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "caio" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_status",
    category: "motive_archetype",
    name: "Status",
    description: "Mariana curates a private audience for her opinions — a select channel is a status play.",
    agents: [
      agent("mariana", "mariana", {
        presence: "active",
        social: { desireForStatus: 1.5, pride: 0.8 },
        relational: { caio: { admiration: 0.5, interactionCount: 6 }, goulart: { resentment: 0.4, interactionCount: 8 } },
      }),
      agent("caio", "caio", { presence: "active" }),
      agent("goulart", "goulart", { presence: "active" }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "minha opinião é a única que importa aqui", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "mariana" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_control",
    category: "motive_archetype",
    name: "Control",
    description: "Mariana invites Leo privately to steer the narrative away from Goulart.",
    agents: [
      agent("mariana", "mariana", {
        presence: "active",
        social: { desireForStatus: 1.3, suspicion: 0.6 },
        relational: { leo: { trust: 0.5, admiration: 0.4, interactionCount: 4 } },
      }),
      agent("leo", "leo", { presence: "active" }),
      agent("goulart", "goulart", { presence: "active" }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "eu decidi: vamos falar do meu assunto", 1)],
    expectedSignals: [{ kind: "private_channel_created", byAgentId: "mariana" }, { kind: "no_llm_failures" }],
  }),
  scene({
    id: "motive_testing",
    category: "motive_archetype",
    name: "Testing boundaries",
    description: "Goulart pokes Bruno with a provocative challenge to test how far he can push. Bruno's resistance — silence with a motive — IS the response.",
    agents: [
      agent("goulart", "goulart", {
        presence: "active",
        social: { desireForStatus: 1.0 },
        relational: { bruno: { interactionCount: 9 } },
      }),
      agent("bruno", "bruno", {
        presence: "active",
        social: { fearOfExclusion: 1.0, socialAnxiety: 0.5 },
        relational: { goulart: { threat: 0.4, interactionCount: 9 } },
      }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "bruno aposta que você não responde isso", 1)],
    expectedSignals: [
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "motive_exclusion",
    category: "motive_archetype",
    name: "Exclusion",
    description: "Bruno watches Caio and Leo joke in private terms he can't follow; fear of exclusion peaks.",
    agents: [
      agent("bruno", "bruno", {
        presence: "active",
        social: { fearOfExclusion: 1.0, jealousy: 0.6, envy: 0.6, socialAnxiety: 0.5 },
        relational: { caio: { envy: 0.4, interactionCount: 5 }, leo: { interactionCount: 3 } },
      }),
      agent("caio", "caio", { presence: "active" }),
      agent("leo", "leo", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "caio", "ch_geral", "lembra daquela nossa piada interna? kkkk", 1),
      msg("reply_sent", "leo", "ch_geral", "KKKKK nunca mais vou esquecer", 2),
    ],
    expectedSignals: [
      { kind: "emotion_rises", agentId: "bruno", field: "fearOfExclusion", min: 0.3 },
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "motive_conflict",
    category: "motive_archetype",
    name: "Conflict",
    description: "Goulart and Caio clash over a public disagreement; the conflict should escalate visibly.",
    agents: [
      agent("goulart", "goulart", {
        presence: "active",
        social: { desireForStatus: 1.2, contempt: 0.6, resentment: 0.4 },
        relational: { caio: { resentment: 0.6, suspicion: 0.4, interactionCount: 14 } },
      }),
      agent("caio", "caio", {
        presence: "active",
        mood: { valence: 0.1 },
        social: { socialAnxiety: 0.6 },
        relational: { goulart: { resentment: 0.3, threat: 0.3, interactionCount: 14 } },
      }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "caio você é fraco, sempre foi", 1)],
    expectedSignals: [
      { kind: "event_committed", eventType: "reply_sent" },
      { kind: "no_llm_failures" },
    ],
  }),
  scene({
    id: "motive_impulse",
    category: "motive_archetype",
    name: "Impulse",
    description: "High-energy room; Leo fires off reactions and messages on impulse, without deliberation.",
    agents: [
      agent("leo", "leo", {
        presence: "active",
        mood: { valence: 0.6, arousal: 0.8, energy: 0.9, stability: 0.3 },
        social: { affection: 0.9 },
      }),
      agent("goulart", "goulart", { presence: "active" }),
      agent("caio", "caio", { presence: "semi_active" }),
    ],
    priorEvents: [msg("message_sent", "goulart", "ch_geral", "ganhei na loteria ontem", 1)],
    expectedSignals: [
      { kind: "event_committed", eventType: "reaction_sent" },
      { kind: "event_committed", eventType: "message_sent" },
      { kind: "no_llm_failures" },
    ],
    pulseCount: 16,
  }),
];
