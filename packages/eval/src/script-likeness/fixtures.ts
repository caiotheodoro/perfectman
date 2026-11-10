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
  {
    id: "run60-transcript",
    language: "pt",
    source:
      "2026-11-10 production hotel run 60 (pt-BR, 3 bot actors Heloísa, Otávio and Renato), exported transcript of the actors' lines with run-clock seconds as atMs/1000. Players' chat is not in this fixture.",
    notes:
      "The run's actor lines only, as exported (38 of the 41 turns the owner counted; the export dropped 3). The 9 lines of 'Ué.', 'Hm.', 'Tá.' and 'Ah.' are the guard's reactions and are marked filler: true (the metric reads them as one by text as well). Lines the log cut at 200 characters end in an ellipsis, so lengths are lower bounds. Human verdict: terrible.",
    turns: [
      { speaker: "Heloísa", text: "Otávio, querido, sente-se. A noite está fria e o senhor chegou bufando. Aceita um vinho antes de dizer o que veio dizer?", atMs: 10000, kind: "say" },
      { speaker: "Otávio", text: "Heloísa. Senta, minha cara. Essa carta eu li três vezes antes de vir.", atMs: 18000, kind: "say" },
      { speaker: "Otávio", text: "Vinho eu tomo depois, minha cara. Primeiro o rapaz ali me conta o que viu na assinatura.", atMs: 24000, kind: "say" },
      { speaker: "Heloísa", text: "Três vezes, querido? Então o senhor já sabe de cor o que o meu Henrique escreveu. Me diga uma coisa só: quem foi que assinou embaixo, no seu entender?", atMs: 31000, kind: "say" },
      { speaker: "Heloísa", text: "O rapaz? O rapaz é meu irmão, Otávio, e irmão não depõe contra irmã. O senhor não tem nada melhor que a boca do Caio?", atMs: 42000, kind: "say" },
      { speaker: "Renato", text: "Irmão não depõe, né? Pô, Heloísa, então tá. Só me diz quanto é que vale um irmão calado hoje em dia. Ahahah. O cofre tá ali, mano, é só abrir. Olho pra ela, sorriso atravessado.", atMs: 52000, kind: "say" },
      { speaker: "Otávio", text: "Tá.", atMs: 65000, kind: "say", filler: true },
      { speaker: "Renato", text: "Otávio, mano, tá bom, senta aí, quanto é que o senhor quer pra ficar quieto? Ahahah.", atMs: 68000, kind: "say" },
      { speaker: "Otávio", text: "Rapaz, baixa esse sorriso. Fala o que você viu na assinatura, alto, agora. Cofre a gente abre às nove. E aí você põe o preço, não ela. Boto um copo na mão dele e olho fixo.", atMs: 77000, kind: "say" },
      { speaker: "Heloísa", text: "O cofre abre amanhã, Renato, meu bem. Hoje ninguém põe preço em ninguém nesta mesa, está ouvindo?", atMs: 90000, kind: "say" },
      { speaker: "Renato", text: "Ué.", atMs: 97000, kind: "say", filler: true },
      { speaker: "Renato", text: "Amanhã, mano? Tá bom. Então eu conto o que eu vi hoje, pra todo mundo ouvir.", atMs: 100000, kind: "say" },
      { speaker: "Renato", text: "Hm.", atMs: 132000, kind: "say", filler: true },
      { speaker: "Otávio", text: "Quieto eu fico de graça, rapaz. O que tem preço é o que você viu. Fala.", atMs: 135000, kind: "say" },
      { speaker: "Heloísa", text: "Um irmão calado não vale nada, Renato, meu bem. Irmão que fala vale menos. Você entendeu isso, não entendeu?", atMs: 142000, kind: "say" },
      { speaker: "Heloísa", text: "Vale pudim, Renato, e você já comeu demais. Otávio, segunda-feira de manhã, cofre aberto, os dois juntos. O senhor não sai desta casa sem nada que é seu, palavra é isso?", atMs: 180000, kind: "say" },
      { speaker: "Otávio", text: "Rapaz, o que você viu não é preço. É o meu pedaço, e eu quero ele agora.", atMs: 192000, kind: "say" },
      { speaker: "Heloísa", text: "O seu pedaço, Otávio, meu bem, está guardado desde sempre. Mas o rapaz não assina papel nenhum esta noite, não é?", atMs: 199000, kind: "say" },
      { speaker: "Otávio", text: "Palavra sua, minha cara, não vale mais que a letra daquela carta. E eu não durmo aqui. Rapaz, me dá o nome de quem te pagou pra ver essa assinatura.", atMs: 207000, kind: "say" },
      { speaker: "Heloísa", text: "Otávio, querido, o senhor quer o pedaço agora, na mesa, com o rapaz olhando. E se o pedaço vier com um café quentinho, o senhor ainda desce a serra hoje?", atMs: 219000, kind: "say" },
      { speaker: "Otávio", text: "Rapaz, chega aqui. Ela te chamou de irmão e de burro na mesma frase. Eu te ofereço o copo e um lugar na mesa.", atMs: 230000, kind: "say" },
      { speaker: "Renato", text: "Ué.", atMs: 239000, kind: "say", filler: true },
      { speaker: "Heloísa", text: "Ah.", atMs: 243000, kind: "say", filler: true },
      { speaker: "Renato", text: "Ahahah, tá bom. Mas eu vi a caneta na sua mão, Heloísa. Cofre aberto e eu esqueço a assinatura.", atMs: 251000, kind: "say" },
      { speaker: "Heloísa", text: "Ah.", atMs: 259000, kind: "say", filler: true },
      { speaker: "Otávio", text: "Rapaz, chega de ser burro de carga. Ela te chamou de nada aqui. Eu te ponho na firma, com nome no papel.", atMs: 263000, kind: "say" },
      { speaker: "Otávio", text: "Café eu tomo, minha cara, efatigável a senhora. Mas assinatura é como bala: tem que entrar no tamanho certo. Renato, venha pra mesa. Eu pago o que você viu hoje, adiantado, e segunda a gente entra jun", atMs: 271000, kind: "say" },
      { speaker: "Heloísa", text: "Renato, meu bem, a caneta era do meu Henrique. E caneta de morto não paga dívida de vivo, não é?", atMs: 285000, kind: "say" },
      { speaker: "Otávio", text: "Rapaz, caneta de morto não paga, mas boca de vivo cobra. Você viu a assinatura. Diz o preço, e eu pago hoje.", atMs: 293000, kind: "say" },
      { speaker: "Renato", text: "Hm.", atMs: 301000, kind: "say", filler: true },
      { speaker: "Renato", text: "Otávio, mano, o senhor tá pagando adiantado e a minha irmã tá pagando de amanhã. Ahahah. Heloísa, cofre hoje, senão eu conto pra mesa quem segurou a caneta.", atMs: 306000, kind: "say" },
      { speaker: "Renato", text: "Otávio, mano, se eu falo o preço aqui a minha irmã me mata. Ahahah. Heloísa, cofre ou eu abro a boca — e não é amanhã, é agora.", atMs: 342000, kind: "say" },
      { speaker: "Otávio", text: "Tá.", atMs: 353000, kind: "say", filler: true },
      { speaker: "Renato", text: "A caneta era do Henrique, mas a mão que apertou era sua, irmã. Ahahah.", atMs: 367000, kind: "say" },
      { speaker: "Otávio", text: "Rapaz, abaixa esse dedo. Eu cubro o que ela cobrir e mais um tanto. Diz o que viu, e o preço é meu.", atMs: 373000, kind: "say" },
      { speaker: "Heloísa", text: "Ué.", atMs: 382000, kind: "say", filler: true },
      { speaker: "Renato", text: "Otávio, mano, o senhor tá oferecendo, mas quem abre o cofre é ela. Ahahah. Heloísa, ouve: cofre hoje, dinheiro na minha mão, e eu pego o primeiro avião. Escândalo não interessa a ninguém aqui, né?", atMs: 386000, kind: "say" },
      { speaker: "Renato", text: "Tá, Otávio, te ouvi. Mas escuta, Heloísa: eu fecho essa boca por menos do que ele tá oferecendo — o que tiver no cofre hoje, aqui, agora, e o irmão vira mobília.", atMs: 406000, kind: "say" },
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
  {
    id: "run60-summary",
    language: "pt",
    source:
      "The owner's measurements of production run 60 (pt-BR, 3 actors, 41 say turns), judged terrible by a human: median 19 words per turn (real pt plays: median 7, p75 15, 12.6% over 25 words), 26% of turns over 25 words, lexical novelty 0.67 (plays 0.88), about 10 filler reactions ('Ué.', 'Hm.', 'Tá.', 'Ah.', 'Sei.') made by the guard, one actor repeating the same demand about 5 times in 90 s, no climax.",
    notes:
      "Aggregates only, no lines: scored through scoreMetrics with the metrics the owner gave (length, novelty, and the 10 reactions as a share of the 41 turns). The loop and arc facts are described in words and not measured here, so they are not scored; run60-transcript is the line-level fixture.",
    sayTurns: 41,
    metrics: { medianWords: 19, over25: 0.26, noveltyMean: 0.67, reactionShare: 10 / 41 },
  },
];
