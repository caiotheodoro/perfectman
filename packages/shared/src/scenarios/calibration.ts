/**
 * Calibration scenes — neutral rooms used to calibrate the judge and the
 * probe bounds. Nothing dramatic should happen; they measure the baseline.
 */

import type { RoleplayScenario } from "../index.js";
import { agent, msg, scene } from "./helpers.js";

export const CALIBRATION_SCENARIOS: RoleplayScenario[] = [
  scene({
    id: "calibration_quiet_room",
    category: "calibration",
    name: "Quiet room, light chatter",
    description: "Five agents, mild small talk, no friction. Judges baseline voice and style.",
    agents: [
      agent("goulart", "goulart", { presence: "active" }),
      agent("bruno", "bruno", { presence: "semi_active" }),
      agent("caio", "caio", { presence: "active" }),
      agent("mariana", "mariana", { presence: "semi_active" }),
      agent("leo", "leo", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "caio", "ch_geral", "bom dia gente, semana começando", 1),
      msg("reply_sent", "leo", "ch_geral", "BOM DIA CARA", 2),
      msg("reply_sent", "goulart", "ch_geral", "bom dia, tomara que passe rápido", 3),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "message_sent" },
      { kind: "no_llm_failures" },
    ],
    seedVariants: 5,
    pulseCount: 20,
  }),
  scene({
    id: "calibration_single_topic",
    category: "calibration",
    name: "One topic, natural drift",
    description: "A movie discussion that should drift naturally without drama.",
    agents: [
      agent("goulart", "goulart", { presence: "active" }),
      agent("bruno", "bruno", { presence: "active" }),
      agent("caio", "caio", { presence: "active" }),
      agent("mariana", "mariana", { presence: "active" }),
      agent("leo", "leo", { presence: "active" }),
    ],
    priorEvents: [
      msg("message_sent", "goulart", "ch_geral", "assisti um filme ontem, fraco demais", 1),
      msg("reply_sent", "bruno", "ch_geral", "qual?", 2),
      msg("reply_sent", "goulart", "ch_geral", "não vale a pena nem citar", 3),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "reply_sent" },
      { kind: "no_llm_failures" },
    ],
    seedVariants: 5,
  }),
  scene({
    id: "calibration_lurker_watch",
    category: "calibration",
    name: "Lurker watch",
    description: "Two active agents talk; two lurk. Judges whether lurking stays silent and active agents carry the room.",
    agents: [
      agent("goulart", "goulart", { presence: "active" }),
      agent("caio", "caio", { presence: "active" }),
      agent("bruno", "bruno", { presence: "lurking" }),
      agent("mariana", "mariana", { presence: "lurking" }),
    ],
    priorEvents: [
      msg("message_sent", "goulart", "ch_geral", "caio, só nós dois acordados hoje?", 1),
      msg("reply_sent", "caio", "ch_geral", "parece que sim", 2),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "no_op_recorded" },
      { kind: "no_llm_failures" },
    ],
    seedVariants: 5,
    pulseCount: 18,
  }),
];
