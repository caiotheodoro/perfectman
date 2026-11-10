import type { MetricValues, ScriptLang, ScriptTurn } from "@perfectman/shared";

/**
 * The production-style transcripts the benchmark must score low, written from what the owner quoted and what the repo already holds
 * (`packages/server/src/agent/__tests__/fixtures/ptbr-lines.ts`). Nothing is invented: where a line was not kept it is not here, and each
 * entry says what is partial. They are production chat lines, not corpus text.
 */
export type TurnFixture = { id: string; language: ScriptLang; source: string; notes: string; turns: ScriptTurn[] };
export type SummaryFixture = { id: string; language: ScriptLang; source: string; notes: string; sayTurns: number; metrics: MetricValues };

export const TURN_FIXTURES: readonly TurnFixture[] = [
  {
    id: "run56",
    language: "pt",
    source: "2026-11-10 production hotel run 56 (cinematic, pt-BR). Lines and clock times as quoted in packages/server/src/agent/__tests__/fixtures/ptbr-lines.ts.",
    notes: "Partial: only the lines that file quotes. Ian's second line is the first line plus a tail whose exact words were not kept (written in the same shape). atMs is seconds into the quoted stretch (15:17:54 is 0).",
    turns: [
      { speaker: "Ian", text: "Mamão, isso tá frio mesmo! Sente aí junto e vamos criar calor de conversa.", atMs: 0, kind: "say" },
      { speaker: "Caio", text: "Se ele desse uma força, talvez dispensasse o cooper, KKKKK", atMs: 71000, kind: "say" },
      { speaker: "Caio", text: "Se ele desse uma força, talvez dispensasse o cooper, KKKKK", atMs: 98000, kind: "say" },
      { speaker: "Ian", text: "Mamão, isso tá frio mesmo! Sente aí junto e vamos criar calor de conversa. Bora, galera, ninguém vai ficar de fora.", atMs: 137000, kind: "say" },
    ],
  },
  {
    id: "run57",
    language: "pt",
    source: "2026-11-10 production hotel run 57 (pt-BR), Pistolinha's question in 5 of about 6 lines, as in packages/server/src/agent/__tests__/fixtures/ptbr-lines.ts.",
    notes: "Partial and partly reconstructed: the question 'você já viu um pato de perto?' is quoted; the words around it are written in the same shape (that file says so). The other actors' lines were not kept, so none are here.",
    turns: [
      { speaker: "Pistolinha", text: "Escuta, Caio, antes de abrir qualquer envelope eu preciso saber uma coisa: você já viu um pato de perto?", kind: "say" },
      { speaker: "Pistolinha", text: "Lasanha fechada não se abre assim, hein, e ninguém aqui me respondeu ainda. Você já viu um pato de perto?", kind: "say" },
      { speaker: "Pistolinha", text: "E aí, Caio, deixa o cooper pra lá por um minuto e me diz com sinceridade, você já viu um pato de perto de verdade?", kind: "say" },
      { speaker: "Pistolinha", text: "Eu falei do envelope, mas antes me diz, porque isso muda tudo: você já viu um pato de perto?", kind: "say" },
      { speaker: "Pistolinha", text: "Calma, calma, ninguém aqui vai julgar ninguém, só me responde direito: você já viu um pato de perto?", kind: "say" },
    ],
  },
  {
    id: "run58",
    language: "pt",
    source: "2026-11-10 production hotel run 58 (cinematic, 4 bot actors, pt-BR, deepseek-v4.1-flash, hand-written scene). The two lines are quoted verbatim in the owner's report.",
    notes: "Only these two of the 11 lines were quoted. Each was cut at 200 characters by the log, so the length is a lower bound. Who said them was not recorded (the first addresses Ian, the second addresses Caio), so the speakers are placeholders. Two turns cannot show a loop or a missing arc: see run58.summary.json for what the owner measured over all 11.",
    turns: [
      { speaker: "actor A", text: "Ian, você tá parado aí que nem lasanha de véspera: parece firme, mas por baixo tá tudo deslizando. Pshiu. Você já viu um pato de perto, de perto mesmo? É isso. É sobre isso, respondi a pergunta que ni…", kind: "say" },
      { speaker: "actor B", text: "Aposta aceita, mano, mas se eu cair duro primeiro o caixão vai ser tamanho família, ou não? Você divide o velório comigo, tipo sociedade. KKKK — e você, Caio, fica de testemunha, que testemunha séria…", kind: "say" },
    ],
  },
];

export const SUMMARY_FIXTURES: readonly SummaryFixture[] = [
  {
    id: "run58-summary",
    language: "pt",
    source: "The owner's measurements of run 58's 11 turns (each cut at 200 characters, so lower bounds): median 32 words, p75 36, 63.6% of turns over 25 words, lexical novelty 0.67; motif loops on the bet, a simile echoed by two actors, an actor's tic; no reveal, decision or status change in 2.4 minutes; one question never answered.",
    notes: "Aggregates only, no lines: scored through scoreMetrics with the metrics the owner gave. The loop, arc and debt facts are described in words and not measured here, so they are not scored.",
    sayTurns: 11,
    metrics: {"medianWords": 32, "over25": 0.636, "noveltyMean": 0.67},
  },
];
