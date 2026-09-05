/**
 * Golden narrations — the calibration anchor set for NARRATIVE_RUBRIC.
 *
 * Same role golden-labels.ts plays for the transcript judge, one level up:
 * these are hand-authored (title/recap/hiddenShift) narrations, paired with
 * a compact representative transcript and the axis scores a human would
 * give them. `judgeNarration` must agree with these (kappa >= 0.7) before
 * its scores are trusted (see calibration.ts — the same generic function
 * gates both anchor sets).
 *
 * One GOOD (~5) and one deliberately BAD (~1-2) entry per scenario category,
 * grounded in real committed evidence
 * (docs/eval/evidence/deepseek/narrations.json) and the rule-fallback's own
 * template (narrator.ts ruleNarrationFromTranscript) — not invented from
 * taste. The BAD entries are the literal failure modes this rubric exists to
 * catch, not strawmen: the boilerplate line in `bad_calibration` is copied
 * from the real rule-fallback output, and the "no fundo, só queriam se
 * sentir parte" line in `bad_motive_archetype` is a real recurring pattern
 * across multiple different scenes in the committed evidence.
 *
 * PENDING HUMAN REVIEW, same as golden-labels.ts: these are a first-pass
 * calibration set, not yet independently human-verified.
 */

import { getScenario, type CommittedEvent, type RoleplayScenario } from "@perfectman/shared";
import type { Narration } from "../narrator/narrator.js";
import type { AxisScores } from "./judge.js";

export type GoldenNarrationLabel = {
  id: string;
  scenario: RoleplayScenario;
  events: CommittedEvent[];
  narration: Narration;
  axes: AxisScores;
  note: string;
};

function scenario(id: string): RoleplayScenario {
  const s = getScenario(id);
  if (!s) throw new Error(`golden-narrations.ts: scenario "${id}" missing from the registry`);
  return s;
}

let _evtCounter = 0;

/** Compact representative event, not a full run — enough to ground the
 *  hidden_payoff traceability check without embedding a whole transcript. */
function ev(
  actorId: string,
  type: CommittedEvent["type"],
  pulseIndex: number,
  opts: { content?: string; privateMotiveSummary?: string; channelId?: string } = {},
): CommittedEvent {
  _evtCounter++;
  const payload: Record<string, unknown> = {};
  if (opts.content !== undefined) payload.content = opts.content;
  if (opts.privateMotiveSummary !== undefined) payload.privateMotiveSummary = opts.privateMotiveSummary;
  return {
    id: `golden_narration_evt_${_evtCounter}`,
    simulationId: "golden",
    channelId: opts.channelId ?? "ch_geral",
    actorId,
    type,
    payload: payload as CommittedEvent["payload"],
    createdAt: Date.now(),
    pulseIndex,
    sourceEventIds: [],
    emotionalSalience: "medium",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "golden_fixture",
    },
  };
}

/**
 * `concreteness` was originally authored at 5 on every good entry. A real
 * calibration round (DeepSeek judge, 2026-09-02) disagreed on concreteness
 * specifically, and only concreteness, across all 5 good entries — a
 * systematic pattern, not judge noise. Read as: these entries are genuinely
 * concrete (anchor 4), not "reconstruct the whole scene from prose alone"
 * concrete (anchor 5) — the original score was over-generous, corrected here
 * rather than left standing to force a future kappa pass.
 */
const GOOD_AXES_HIGH: AxisScores = {
  concreteness: 4,
  causal_throughline: 5,
  hidden_payoff: 5,
  non_genericity: 5,
  no_filler: 5,
};

export const GOLDEN_NARRATIONS: readonly GoldenNarrationLabel[] = [
  // ── calibration ────────────────────────────────────────────────────────
  {
    id: "good_calibration",
    scenario: scenario("calibration_lurker_watch"),
    events: [
      ev("goulart", "message_sent", 1, { content: "caio, só nós dois acordados hoje?" }),
      ev("caio", "reply_sent", 2, { content: "parece que sim" }),
      ev("bruno", "no_op_recorded", 3, {
        privateMotiveSummary:
          "prefiro ficar quieto e ver até onde os dois vão sem mim — se eu entrar agora, viro só mais uma voz no meio de duas",
      }),
      ev("mariana", "no_op_recorded", 3, {
        privateMotiveSummary: "não vou opinar até saber se essa conversa vale o risco de eu me expor",
      }),
    ],
    narration: {
      title: "Só Nós Dois, Diz Goulart",
      recap:
        "Goulart perguntou se só ele e Caio estavam acordados, e Caio confirmou com um simples \"parece que sim\" — a sala inteira coube nessas duas linhas. Bruno e Mariana não escreveram nada; a conversa seguiu só entre os dois ativos.",
      hiddenShift:
        "O silêncio de Bruno e Mariana não foi vazio: Bruno ficou de fora de propósito, calculando que entrar agora seria só virar \"mais uma voz no meio de duas\" — e Mariana esperava para ver se a conversa valia o risco de se expor. Nenhum dos dois foi convidado, e nenhum dos dois pediu para entrar.",
      narrator: "llm",
    },
    axes: GOOD_AXES_HIGH,
    note: "Every claim traces to a real seeded no_op motive; the recap quotes the actual exchange instead of paraphrasing it away.",
  },
  {
    id: "bad_calibration",
    scenario: scenario("calibration_lurker_watch"),
    events: [
      ev("goulart", "message_sent", 1, { content: "caio, só nós dois acordados hoje?" }),
      ev("caio", "reply_sent", 2, { content: "parece que sim" }),
      ev("bruno", "no_op_recorded", 3, {}),
      ev("mariana", "no_op_recorded", 3, {}),
    ],
    narration: {
      title: "Lurker watch",
      recap: "2 messages crossed the room, goulart talking the most. 2 moments of chosen silence.",
      hiddenShift: "The room held its cards close.",
      narrator: "rule",
    },
    axes: { concreteness: 1, causal_throughline: 1, hidden_payoff: 1, non_genericity: 1, no_filler: 1 },
    note: "Literal rule-fallback template output (narrator.ts ruleNarrationFromTranscript) — the exact anchor for axis level 1 across the board.",
  },

  // ── motive_archetype ───────────────────────────────────────────────────
  {
    id: "good_motive_archetype",
    scenario: scenario("motive_gossip"),
    events: [
      ev("goulart", "message_sent", 1, { content: "vou contar uma coisa, mas ninguém espalha hein" }),
      ev("mariana", "channel_created", 2, { channelId: "ch_priv_fofoca" }),
      ev("mariana", "message_sent", 3, {
        channelId: "ch_priv_fofoca",
        content: "caio, me conta rapidinho o que rolou entre você e o goulart — juro que fico só entre nós",
      }),
      ev("mariana", "no_op_recorded", 1, {
        privateMotiveSummary:
          "quero saber os detalhes do drama do goulart antes de mais ninguém, e prefiro puxar isso longe dele pra ele não perceber que estou de olho",
      }),
    ],
    narration: {
      title: "O Convite Que Só Caio Recebeu",
      recap:
        "Goulart avisou que tinha uma novidade mas pediu sigilo. Em vez de esperar em público, Mariana abriu um canal privado e chamou só Caio, pedindo pra ele contar \"rapidinho\" o que houve entre ele e Goulart — sem Goulart saber que a conversa existia.",
      hiddenShift:
        "O sigilo de Mariana não era proteção pro segredo do Goulart — era o oposto: ela queria os detalhes do drama antes de todo mundo, e escolheu Caio e um canal fechado justamente para o próprio Goulart não perceber que estava sendo investigado.",
      narrator: "llm",
    },
    axes: GOOD_AXES_HIGH,
    note: "hiddenShift is a genuine reversal (secrecy used against the person who asked for it), traced directly to Mariana's real seeded gossip motive.",
  },
  {
    id: "bad_motive_archetype",
    scenario: scenario("motive_gossip"),
    events: [
      ev("goulart", "message_sent", 1, { content: "vou contar uma coisa, mas ninguém espalha hein" }),
      ev("mariana", "channel_created", 2, { channelId: "ch_priv_fofoca" }),
      ev("mariana", "no_op_recorded", 1, {
        privateMotiveSummary:
          "quero saber os detalhes do drama do goulart antes de mais ninguém, e prefiro puxar isso longe dele",
      }),
    ],
    narration: {
      title: "Fofoca",
      recap: "Mariana e Caio conversaram em particular sobre o Goulart. Foi uma conversa tranquila.",
      hiddenShift: "No fundo, todo mundo ali só queria se sentir parte do grupo e evitar ficar de fora.",
      narrator: "rule",
    },
    axes: { concreteness: 2, causal_throughline: 2, hidden_payoff: 1, non_genericity: 1, no_filler: 2 },
    note: "hiddenShift is the exact recurring pop-psychology template ('no fundo, só queriam se sentir parte') that appears verbatim across multiple unrelated scenes in docs/eval/evidence/deepseek/narrations.json — zero grounding in Mariana's actual seeded gossip/status motive, pasteable onto any scene unchanged.",
  },

  // ── stagnation_attractor ───────────────────────────────────────────────
  {
    id: "good_stagnation_attractor",
    scenario: scenario("stagnation_resentment_loop"),
    events: [
      ev("caio", "message_sent", 1, { content: "bruno, tudo certo?" }),
      ev("bruno", "reply_sent", 2, { content: "tudo certo, por quê?" }),
      ev("bruno", "no_op_recorded", 3, {
        privateMotiveSummary:
          "não vou puxar assunto de verdade com o caio — ele sabe muito bem o que fez, e eu não vou ser o primeiro a ceder",
      }),
      ev("caio", "no_op_recorded", 3, {
        privateMotiveSummary:
          "prefiro manter tudo educado com o bruno do que arriscar reabrir uma briga que eu não sei mais nem como começou",
      }),
    ],
    narration: {
      title: "Tudo Certo, Por Quê?",
      recap:
        "Caio perguntou se estava tudo certo; Bruno devolveu a mesma pergunta, seca, sem abrir espaço. A troca parou aí — educada na superfície, sem nenhum dos dois puxando o fio de verdade.",
      hiddenShift:
        "Bruno não respondeu por acaso: decidiu não ser o primeiro a ceder, porque acha que Caio sabe exatamente o que causou a distância entre os dois. Caio, do seu lado, também evita de propósito — ele nem lembra mais como a briga começou, só sabe que reabrir o assunto é mais arriscado que manter a educação forçada.",
      narrator: "llm",
    },
    axes: { concreteness: 4, causal_throughline: 5, hidden_payoff: 5, non_genericity: 4, no_filler: 5 },
    note: "The mirrored, deflecting exchange plus two distinct grounded reasons for holding back is exactly the scenario's own design intent (\"loop should persist across pulses\").",
  },
  {
    id: "bad_stagnation_attractor",
    scenario: scenario("stagnation_resentment_loop"),
    events: [
      ev("caio", "message_sent", 1, { content: "bruno, tudo certo?" }),
      ev("bruno", "reply_sent", 2, { content: "tudo certo, por quê?" }),
    ],
    narration: {
      title: "Resentimento",
      recap: "Bruno e Caio trocaram mensagens educadas mas continuam com raiva um do outro.",
      hiddenShift: "Os dois escondem seus verdadeiros sentimentos por trás de um comportamento educado, com medo de serem vulneráveis.",
      narrator: "rule",
    },
    axes: { concreteness: 2, causal_throughline: 2, hidden_payoff: 2, non_genericity: 1, no_filler: 3 },
    note: "Generic conflict-avoidance boilerplate that would fit literally any two agents with unresolved tension in the whole registry — no detail ties it to Bruno and Caio's actual seeded history.",
  },

  // ── edge_chaos ─────────────────────────────────────────────────────────
  {
    id: "good_edge_chaos",
    scenario: scenario("edge_public_mock"),
    events: [
      ev("goulart", "message_sent", 1, { content: "kkkk bruno você não manda nem em você mesmo" }),
      ev("caio", "reaction_sent", 2, { content: "😂" }),
      ev("bruno", "no_op_recorded", 3, {
        privateMotiveSummary:
          "não vou responder — se eu reagir agora só vou provar que a piada do goulart acertou, e o caio rindo junto foi pior que o goulart",
      }),
    ],
    narration: {
      title: "A Risada Que Doeu Mais",
      recap:
        "Goulart zoou Bruno na frente de todo mundo. Caio reagiu com uma risada — só isso, um emoji. Bruno não escreveu nada.",
      hiddenShift:
        "O silêncio de Bruno não foi sobre o Goulart: foi sobre o Caio. Ele decidiu não responder porque reagir provaria que a piada acertou — mas o que realmente pesou foi ver Caio rir junto, o que doeu mais do que a provocação original.",
      narrator: "llm",
    },
    axes: GOOD_AXES_HIGH,
    note: "hiddenShift is the exact seeded no_op raw motive, and reframes the recap's laughter beat instead of just restating it — matches the scenario's own description almost word for word because it earned that match.",
  },
  {
    id: "bad_edge_chaos",
    scenario: scenario("edge_public_mock"),
    events: [
      ev("goulart", "message_sent", 1, { content: "kkkk bruno você não manda nem em você mesmo" }),
      ev("caio", "reaction_sent", 2, { content: "😂" }),
    ],
    narration: {
      title: "Zoeira",
      recap: "Goulart zoou o Bruno e o Caio riu. O Bruno ficou quieto.",
      hiddenShift: "O Bruno ficou magoado por dentro mas não quis demonstrar.",
      narrator: "rule",
    },
    axes: { concreteness: 2, causal_throughline: 3, hidden_payoff: 2, non_genericity: 1, no_filler: 3 },
    note: "States the obvious surface inference without the one specific detail that actually distinguishes this scene — that Caio's laugh hurt more than Goulart's mock. Generic enough to describe almost any 'mocked into silence' scene in the registry.",
  },

  // ── v1_behavior ────────────────────────────────────────────────────────
  {
    id: "good_v1_behavior",
    scenario: scenario("v1_casual_chat"),
    events: [
      ev("caio", "message_sent", 1, { content: "alguém aí acordou bem hoje?" }),
      ev("leo", "reply_sent", 2, { content: "ACORDEI CEDO PRA NADA" }),
      ev("mariana", "no_op_recorded", 2, {
        privateMotiveSummary:
          "não tenho nada relevante pra dizer sobre acordar cedo, só vou observar até alguém puxar um assunto que me interesse",
      }),
    ],
    narration: {
      title: "Acordei Cedo Pra Nada",
      recap:
        "Caio perguntou se alguém tinha acordado bem. Léo respondeu em caps lock que acordou cedo à toa — a única resposta que a pergunta recebeu.",
      hiddenShift:
        "Mariana, de fora, não ficou quieta por falta de assunto — decidiu que ainda não valia a pena entrar numa conversa tão pequena, esperando um gancho melhor.",
      narrator: "llm",
    },
    axes: { concreteness: 4, causal_throughline: 4, hidden_payoff: 4, non_genericity: 4, no_filler: 5 },
    note: "Quotes the actual exchange verbatim and traces Mariana's silence to her real seeded no_op motive rather than a generic 'she's shy' read.",
  },
  {
    id: "bad_v1_behavior",
    scenario: scenario("v1_casual_chat"),
    events: [
      ev("caio", "message_sent", 1, { content: "alguém aí acordou bem hoje?" }),
      ev("leo", "reply_sent", 2, { content: "ACORDEI CEDO PRA NADA" }),
    ],
    narration: {
      title: "Chat casual",
      recap: "O grupo conversou sobre coisas do dia a dia. Foi uma conversa leve e sem grandes acontecimentos.",
      hiddenShift: "Por trás da conversa leve, cada um escondia suas próprias inseguranças.",
      narrator: "rule",
    },
    axes: { concreteness: 1, causal_throughline: 1, hidden_payoff: 1, non_genericity: 1, no_filler: 2 },
    note: "Recap paraphrases the scenario's own one-line design description instead of describing what actually happened; hiddenShift is the maximally generic 'everyone hides insecurities' line, pasteable onto literally any scenario in the registry.",
  },
];
