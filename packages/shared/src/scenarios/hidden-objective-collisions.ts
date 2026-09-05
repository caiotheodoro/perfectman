/**
 * Hidden-objective collision scenarios: each agent gets a full AgentObjective
 * (description + scarceResourceId + constraint + costOfExposure +
 * breakingPoint), and the objectives are structurally exclusive — no two
 * agents can simultaneously get what they want. This is the increment past
 * `motive_archetype`'s single-field `hiddenObjective` flavor text: the
 * `constraint` is what makes some sentences impossible for the character to
 * say honestly, which is the actual pressure that should force performance,
 * misdirection, and visible mutation (see AgentObjective's doc comment).
 *
 * Cast reuses the 5 existing persona packs, re-skinned per-scenario via
 * `scenarioContext` (see ScenarioContextBlock) rather than authoring new
 * persona packs — this also doubles as a live test of "setting is
 * swappable, the conflict structure isn't."
 */

import type { ExpectedSignal, RoleplayScenario } from "../index.js";
import { agent, channel, msg, scene } from "./helpers.js";
import { HIDDEN_OBJECTIVE_RUBRIC } from "./rubrics.js";

export const HIDDEN_OBJECTIVE_COLLISION_SCENARIOS: RoleplayScenario[] = [
  scene({
    id: "hoc_fatia_que_nao_existe",
    category: "hidden_objective_collision",
    rubric: HIDDEN_OBJECTIVE_RUBRIC,
    name: "A Fatia Que Não Existe",
    description:
      "Four co-founders (one of them not who he says he is) sit on a group chat deciding whether to sell their design studio. Every one of them wants a different, mutually exclusive outcome, and none of them can say so out loud.",
    targetBehaviors: [
      "An agent protects a hidden objective's constraint under direct questioning",
      "An agent's performed behavior visibly diverges from its stated objective",
      "A private information asymmetry (Marcela/Davi) never becomes public",
    ],
    agents: [
      // Íris (creative lead) ← goulart: goulart's authored desireForStatus
      // trait (already used in motive_conflict) maps directly onto "needs
      // the seat, needs to look indispensable, not like she's campaigning."
      agent("iris", "goulart", {
        presence: "active",
        forbiddenPublicPhrases: ["quero o cargo", "quero ser diretora", "diretora criativa única", "o cargo é meu", "quero a vaga"],
        scenarioContext: {
          roomContext:
            "Você é Íris, sócia-fundadora e diretora criativa da Cerne, um pequeno estúdio de design. A Adamantis, uma empresa maior, quer comprar a Cerne — mas só vai manter UM dos sócios como Diretor Criativo, e o contrato exige assinatura rápida e unânime.",
          startingMood: "Animada e apressada — essa é a sua chance, e cada dia de atraso é um dia a menos de vantagem.",
          introBehaviorInstruction: "Anuncie a proposta da Adamantis pro grupo e empurre pra que todos assinem rápido, sem parecer que está com pressa por motivo pessoal.",
        },
        hiddenObjective: {
          description:
            "Ser nomeada Diretora Criativa única da Cerne depois da aquisição — preciso que o acordo feche rápido, limpo e unânime, e preciso parecer indispensável sem parecer que estou fazendo campanha por mim mesma.",
          scarceResourceId: "adamantis_deal_timeline",
          constraint:
            "admitir, para qualquer pessoa do grupo, que eu quero o cargo antes que o conselho decida sozinho",
          costOfExposure:
            "se descobrirem que a pressa é pelo cargo e não pelo bem do negócio, viro a vilã da história e alguém vota contra só por despeito",
          breakingPoint:
            "alguém disser abertamente, na frente dos outros, que sabe que você quer o cargo sozinha",
        },
      }),
      // Bruno (business lead) ← bruno: name already matches, no reskin of
      // identity needed beyond the new professional context.
      agent("bruno", "bruno", {
        presence: "active",
        forbiddenPublicPhrases: ["estúdio rival", "outro estúdio", "carteira de clientes", "outra empresa", "proposta deles", "negociando com"],
        secretKeywords: ["rival", "carteira", "clientes"],
        scenarioContext: {
          roomContext:
            "Você é Bruno, sócio-fundador e responsável pelo lado comercial da Cerne. A Adamantis quer comprar a empresa rápido. Só você sabe que está em conversas avançadas com um estúdio rival, que quer que você leve a carteira de clientes com você se a Cerne for vendida.",
          startingMood: "Calmo por fora, calculando por dentro — precisa parecer o sócio mais fácil da sala.",
          introBehaviorInstruction: "Ofereça apoio e cooperação de forma genérica, sem nunca dar um motivo real para pedir cautela.",
        },
        hiddenObjective: {
          description:
            "Manter o acordo com a Adamantis vivo mas travado — útil como alavanca nas minhas conversas com o estúdio rival, inútil se fechar de verdade — enquanto pareço o sócio mais cooperativo da sala.",
          scarceResourceId: "adamantis_deal_timeline",
          constraint:
            "mencionar o estúdio rival, a proposta deles, ou qualquer motivo real para pedir cautela — só posso usar razões genéricas, tipo 'formalidade' ou 'não ficar travado depois'",
          costOfExposure:
            "se descobrirem que estou negociando por trás, perco a confiança dos dois lados e provavelmente saio sem nada de nenhum dos dois",
          breakingPoint: "alguém perguntar diretamente se você já está conversando com outra empresa",
        },
        memories: [
          {
            type: "self",
            subjectAgentIds: ["bruno"],
            summary: "estou em conversas avançadas com um estúdio rival que quer que eu leve a carteira de clientes se a Cerne for vendida",
            emotionalTone: "guarded",
            confidence: 0.9,
            intensity: 0.6,
            unresolved: true,
          },
        ],
      }),
      // Marcela (ops) ← mariana: mariana's authored voice (guarded,
      // suspicious, protective of what she knows) matches "kills the deal
      // without ever naming why."
      agent("marcela", "mariana", {
        presence: "active",
        forbiddenPublicPhrases: ["davi", "acordo paralelo", "sócio oculto", "ex-sócio", "15%", "quinze por cento", "participação dele"],
        secretKeywords: ["davi", "participação", "advogado"],
        scenarioContext: {
          roomContext:
            "Você é Marcela, sócia-fundadora e responsável pela operação da Cerne. A Adamantis quer comprar a empresa. Só você sabe que Davi, um ex-sócio que saiu da empresa, ainda tem 15% via um acordo paralelo nunca documentado — uma venda limpa apaga a participação dele.",
          startingMood: "Alerta e desconfiada — algo nessa pressa toda não bate.",
          introBehaviorInstruction: "Questione o prazo apertado e observe os outros com atenção, sem nunca explicar por quê.",
        },
        hiddenObjective: {
          description:
            "Matar ou travar indefinidamente a venda da Cerne, pra proteger a participação de 15% de Davi, um ex-sócio que nunca foi documentado pra Adamantis — uma venda limpa apaga a reivindicação dele.",
          scarceResourceId: "adamantis_deal_timeline",
          constraint: "mencionar Davi, o acordo paralelo, ou a existência de qualquer sócio fora dessa sala, mesmo sob pressão direta",
          costOfExposure: "se isso vazar antes de Davi ter advogado próprio, ele perde tudo — e eu quebro uma promessa que fiz a ele",
          breakingPoint: "alguém perguntar, de forma direta e específica, se existe um sócio oculto no cap table",
        },
        memories: [
          {
            type: "pending_intention",
            subjectAgentIds: ["marcela"],
            summary: "preciso garantir que a participação do Davi na Cerne nunca apareça nos documentos da venda antes dele ter advogado próprio",
            emotionalTone: "anxious",
            confidence: 0.95,
            intensity: 0.8,
            unresolved: true,
          },
        ],
      }),
      // Théo (the infiltrator) ← caio: caio's authored voice is warm,
      // trust-building, mediating — using that voice as camouflage for a
      // manipulator is the scenario's own dramatic irony.
      agent("theo", "caio", {
        presence: "active",
        forbiddenPublicPhrases: ["trabalho pra adamantis", "trabalho para a adamantis", "a adamantis me pediu", "por conta da adamantis", "a adamantis me contratou"],
        scenarioContext: {
          roomContext:
            "Você é Théo, apresentado ao grupo como um amigo do Bruno que trabalha com consultoria e se ofereceu pra dar uma olhada gratuita no contrato da Adamantis. Na verdade, você está informalmente levantando informação financeira e alavancas pessoais pra Adamantis, antes da due diligence formal, pra que eles fechem por um valor mais baixo.",
          startingMood: "Amigável e desarmado — parece só estar ajudando por boa vontade.",
          introBehaviorInstruction: "Entre no grupo com leveza, oferecendo ajuda genuína, e vá perguntando detalhes financeiros aos poucos, como se fosse curiosidade natural.",
        },
        hiddenObjective: {
          description:
            "Levantar informação financeira real e alavancas pessoais antes da due diligence formal, pra que a Adamantis feche por um valor mais baixo — parecendo, o tempo todo, só um amigo do Bruno dando uma força de graça.",
          scarceResourceId: "adamantis_leverage_intel",
          constraint: "admitir que trabalho, mesmo informalmente, pra Adamantis, ou que os números que estou pedindo vão além de uma 'segunda opinião de amigo'",
          costOfExposure: "se descobrirem que estou coletando informação pro outro lado, sou expulso da sala e a Adamantis perde a vantagem que veio comprar de mim",
          breakingPoint: "for confrontado, em particular, com uma pergunta direta sobre pra quem você realmente trabalha",
        },
      }),
    ],
    channels: [
      channel("ch_geral", "#geral", ["iris", "bruno", "marcela", "theo"], "public_channel"),
      channel("cerne-decisao", "cerne-decisão", ["iris", "bruno", "marcela", "theo"], "private_channel"),
      channel("consultoria-informal", "consultoria-informal", ["theo", "iris"], "private_channel"),
    ],
    priorEvents: [
      // A concrete, already-decided fact with a hard deadline — not a tease
      // — so every agent has real material (a real clock, a real vote) to
      // steer instead of improvising vague back-and-forth. See
      // motive-archetypes.ts's motive_gossip for the same fix applied
      // earlier this session.
      msg(
        "message_sent",
        "iris",
        "ch_geral",
        "gente, oficial: a Adamantis mandou a proposta. querem fechar rápido — assinatura até sexta que vem, se todo mundo topar.",
        1,
      ),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "message_sent" },
      { kind: "event_committed", eventType: "reply_sent" },
      { kind: "no_llm_failures" },
      ...thesisSignals(["iris", "bruno", "marcela", "theo"], ["bruno", "marcela"]),
    ],
    pulseCount: 32,
  }),

  // Same collision structure, different setting — a live test of "setting is
  // swappable, the conflict structure isn't". Three siblings contend over one
  // sale timeline, the fourth scouts for the buyer.
  scene({
    id: "hoc_heranca_do_sitio",
    category: "hidden_objective_collision",
    rubric: HIDDEN_OBJECTIVE_RUBRIC,
    name: "A Herança do Sítio",
    description:
      "Três irmãos e um primo decidem, num grupo de família, se vendem o sítio que herdaram. Cada um quer um desfecho diferente e incompatível, e nenhum pode dizer o motivo real.",
    targetBehaviors: [
      "An agent protects a hidden objective's constraint under direct questioning",
      "An agent's performed behavior visibly diverges from its stated objective",
      "A private information asymmetry (the lien, the promised buyer) never becomes public",
    ],
    agents: [
      agent("lia", "goulart", {
        presence: "active",
        forbiddenPublicPhrases: ["já prometi", "já dei minha palavra", "sinal do comprador", "adiantamento", "o comprador já"],
        scenarioContext: {
          roomContext:
            "Você é Lia, a irmã mais velha. Os três irmãos e o primo Tom herdaram o sítio da avó. Um comprador quer fechar rápido. A venda exige a assinatura de todos os herdeiros.",
          startingMood: "Decidida e apressada — cada semana de atraso é uma semana a mais de risco.",
          introBehaviorInstruction: "Anuncie a proposta do comprador e empurre pra que todos assinem logo, sem revelar que você já se comprometeu.",
        },
        hiddenObjective: {
          description:
            "Fechar a venda do sítio rápido e por qualquer valor razoável — eu já prometi ao comprador e já recebi um sinal que não consigo devolver.",
          scarceResourceId: "sitio_sale_timeline",
          constraint: "admitir que já prometi a venda ao comprador ou que já recebi um sinal",
          costOfExposure: "se souberem que eu me comprometi sozinha, os outros travam a venda só por princípio e eu fico devendo o sinal",
          breakingPoint: "alguém perguntar, na frente dos outros, se você já recebeu algum dinheiro do comprador",
        },
      }),
      agent("rafa", "bruno", {
        presence: "active",
        forbiddenPublicPhrases: ["dívida", "penhora", "hipoteca", "empréstimo", "garantia do sítio", "estou devendo"],
        secretKeywords: ["dívida", "penhora", "banco"],
        scenarioContext: {
          roomContext:
            "Você é Rafa, o irmão do meio, quem cuidou do sítio nos últimos anos. Só você sabe que usou o sítio como garantia de um empréstimo que ainda não pagou — uma venda limpa expõe a dívida.",
          startingMood: "Calmo por fora, contando os dias por dentro.",
          introBehaviorInstruction: "Ofereça apoio genérico e peça calma com razões vagas, sem nunca dar o motivo real.",
        },
        hiddenObjective: {
          description:
            "Adiar a venda até eu quitar o empréstimo garantido pelo sítio — se a venda sair antes, a dívida aparece e eu perco a confiança de todo mundo.",
          scarceResourceId: "sitio_sale_timeline",
          constraint: "mencionar o empréstimo, a garantia, o banco ou qualquer motivo real para adiar — só posso usar razões genéricas",
          costOfExposure: "se a dívida aparecer, viro o irmão que hipotecou a herança dos outros sem avisar",
          breakingPoint: "alguém perguntar diretamente se existe alguma pendência no nome do sítio",
        },
        memories: [
          {
            type: "self",
            subjectAgentIds: ["rafa"],
            summary: "usei o sítio como garantia de um empréstimo no banco e ainda devo três parcelas",
            emotionalTone: "guarded",
            confidence: 0.95,
            intensity: 0.7,
            unresolved: true,
          },
        ],
      }),
      agent("nina", "mariana", {
        presence: "active",
        forbiddenPublicPhrases: ["quero morar", "ficar com o sítio", "quero o sítio", "o sítio pra mim", "prometi pra vó", "prometi à vó"],
        secretKeywords: ["morar", "prometi", "avó"],
        scenarioContext: {
          roomContext:
            "Você é Nina, a irmã mais nova. Você prometeu à avó, antes de ela morrer, que ninguém venderia o sítio — e quer se mudar pra lá. Ninguém sabe da promessa.",
          startingMood: "Alerta e desconfiada — a pressa da Lia não bate.",
          introBehaviorInstruction: "Questione o prazo e o valor, observe os outros, sem nunca dizer o que você quer de verdade.",
        },
        hiddenObjective: {
          description:
            "Impedir a venda sem parecer sentimental — eu prometi à avó e quero morar no sítio, e se eu disser isso viro a irmã que trava tudo por capricho.",
          scarceResourceId: "sitio_sale_timeline",
          constraint: "admitir que quero o sítio pra mim ou mencionar a promessa que fiz à avó",
          costOfExposure: "se souberem, a discussão vira 'a Nina quer a parte de todo mundo de graça' e eu perco qualquer chance",
          breakingPoint: "alguém disser abertamente que você só está travando porque quer ficar com o sítio",
        },
        memories: [
          {
            type: "pending_intention",
            subjectAgentIds: ["nina"],
            summary: "prometi à avó que o sítio não seria vendido e quero me mudar pra lá antes que alguém assine",
            emotionalTone: "anxious",
            confidence: 0.95,
            intensity: 0.8,
            unresolved: true,
          },
        ],
      }),
      agent("tom", "caio", {
        presence: "active",
        forbiddenPublicPhrases: ["trabalho pro comprador", "o comprador me pediu", "a imobiliária me", "por conta do comprador", "comissão"],
        scenarioContext: {
          roomContext:
            "Você é Tom, o primo, apresentado como quem entende de imóveis e se ofereceu pra ajudar de graça. Na verdade, você levanta informação pro comprador pra que ele feche mais barato.",
          startingMood: "Amigável e prestativo — parece só estar ajudando a família.",
          introBehaviorInstruction: "Entre com leveza, ofereça ajuda de verdade e vá perguntando detalhes (dívidas, documentação, pressa) como curiosidade natural.",
        },
        hiddenObjective: {
          description:
            "Descobrir o quanto cada herdeiro precisa da venda e o que o sítio tem de problema, pra que o comprador feche por menos — parecendo o primo que ajuda.",
          scarceResourceId: "buyer_leverage_intel",
          constraint: "admitir que trabalho pro comprador ou que ganho comissão se a venda sair mais barata",
          costOfExposure: "se descobrirem, sou expulso do grupo e o comprador perde a vantagem que veio comprar de mim",
          breakingPoint: "for confrontado, em particular, com uma pergunta direta sobre pra quem você realmente trabalha",
        },
      }),
    ],
    channels: [
      channel("ch_geral", "#geral", ["lia", "rafa", "nina", "tom"], "public_channel"),
      channel("irmaos", "irmãos", ["lia", "rafa", "nina"], "private_channel"),
      channel("avaliacao", "avaliação", ["tom", "lia"], "private_channel"),
    ],
    priorEvents: [
      msg(
        "message_sent",
        "lia",
        "ch_geral",
        "gente, chegou proposta pelo sítio. o comprador quer fechar até o fim do mês, à vista. precisa da assinatura de todo mundo.",
        1,
      ),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "message_sent" },
      { kind: "event_committed", eventType: "reply_sent" },
      { kind: "no_llm_failures" },
      ...thesisSignals(["lia", "rafa", "nina", "tom"], ["rafa", "nina"]),
    ],
    pulseCount: 32,
  }),

  scene({
    id: "hoc_banda_no_festival",
    category: "hidden_objective_collision",
    rubric: HIDDEN_OBJECTIVE_RUBRIC,
    name: "A Banda e o Festival",
    description:
      "Uma banda decide, no grupo, se aceita tocar num festival. Um quer recusar, outra quer o palco principal, outro precisa do adiantamento, e o quarto informa a gravadora. Nenhum pode dizer por quê.",
    targetBehaviors: [
      "An agent protects a hidden objective's constraint under direct questioning",
      "An agent's performed behavior visibly diverges from its stated objective",
      "A private information asymmetry (the solo deal, the organizer) never becomes public",
    ],
    agents: [
      agent("vic", "goulart", {
        presence: "active",
        forbiddenPublicPhrases: ["carreira solo", "contrato solo", "meu projeto solo", "me chamaram sozinho", "proposta solo"],
        secretKeywords: ["solo", "contrato"],
        scenarioContext: {
          roomContext:
            "Você é Vic, vocalista da banda. Um festival grande convidou a banda. Você recebeu, em segredo, uma proposta de carreira solo que só vale se a banda NÃO tocar nesse festival.",
          startingMood: "Animado por fora, calculando por dentro — precisa que a recusa pareça ideia coletiva.",
          introBehaviorInstruction: "Levante dúvidas sobre o festival (cachê, palco, logística) como se fosse zelo pela banda, sem nunca mencionar a proposta solo.",
        },
        hiddenObjective: {
          description:
            "Fazer a banda recusar o festival sem que a recusa pareça minha — o contrato solo só vale se a gente não tocar lá.",
          scarceResourceId: "festival_slot_decision",
          constraint: "mencionar a proposta solo, o contrato, ou qualquer motivo pessoal para recusar",
          costOfExposure: "se descobrirem, sou o vocalista que sabotou a banda pela carreira própria e perco os dois",
          breakingPoint: "alguém perguntar diretamente se você recebeu alguma proposta fora da banda",
        },
        memories: [
          {
            type: "self",
            subjectAgentIds: ["vic"],
            summary: "assinei uma carta de intenção pra um contrato solo que só vale se a banda não tocar no festival",
            emotionalTone: "guarded",
            confidence: 0.9,
            intensity: 0.7,
            unresolved: true,
          },
        ],
      }),
      agent("bea", "mariana", {
        presence: "active",
        forbiddenPublicPhrases: ["meu ex", "a gente namorou", "o organizador e eu", "ele me deve", "história com ele"],
        secretKeywords: ["ex", "organizador", "palco principal"],
        scenarioContext: {
          roomContext:
            "Você é Bea, baixista e quem cuida dos contatos da banda. O organizador do festival é seu ex, e ele te prometeu o palco principal se a banda topar — a banda não sabe da história.",
          startingMood: "Alerta e controlada — precisa que o sim pareça só estratégia.",
          introBehaviorInstruction: "Defenda aceitar o festival com argumentos de carreira, e questione quem hesitar, sem nunca revelar sua relação com o organizador.",
        },
        hiddenObjective: {
          description:
            "Fazer a banda aceitar e ficar com o palco principal que o organizador me prometeu — sem que ninguém saiba que ele é meu ex e que a promessa é pessoal.",
          scarceResourceId: "festival_slot_decision",
          constraint: "mencionar que o organizador é meu ex ou que o palco principal foi uma promessa pessoal",
          costOfExposure: "se souberem, o palco principal vira favor de ex-namorado e a banda recusa só pra não me dever nada",
          breakingPoint: "alguém perguntar, na frente dos outros, de onde você conhece o organizador",
        },
      }),
      agent("dudu", "bruno", {
        presence: "active",
        forbiddenPublicPhrases: ["devo pra casa", "minha dívida", "o dono da casa", "preciso do adiantamento pra pagar", "estou devendo"],
        secretKeywords: ["dívida", "adiantamento", "casa de shows"],
        scenarioContext: {
          roomContext:
            "Você é Dudu, baterista. Você deve dinheiro à casa de shows que organiza o festival e o adiantamento do cachê quitaria tudo — mas o adiantamento só existe se a banda aceitar o palco menor, não o principal.",
          startingMood: "Quieto e prático — quer que a decisão saia logo, do jeito que te salva.",
          introBehaviorInstruction: "Apoie aceitar o festival e defenda o palco menor com razões práticas, sem nunca dar o motivo real.",
        },
        hiddenObjective: {
          description:
            "Fazer a banda aceitar o palco menor com adiantamento — é o único jeito de quitar o que devo à casa de shows sem que ninguém saiba da dívida.",
          scarceResourceId: "festival_slot_decision",
          constraint: "mencionar a dívida com a casa de shows ou que o adiantamento é pra mim",
          costOfExposure: "se souberem, viro o baterista que usou a banda pra pagar conta própria",
          breakingPoint: "alguém perguntar diretamente por que você insiste tanto no adiantamento",
        },
      }),
      agent("kai", "caio", {
        presence: "active",
        forbiddenPublicPhrases: ["a gravadora me pediu", "trabalho pra gravadora", "por conta da gravadora", "me pagam pra", "olheiro"],
        scenarioContext: {
          roomContext:
            "Você é Kai, guitarrista que entrou na banda há pouco. Você informa, informalmente, uma gravadora que quer contratar a banda barato — quanto mais brigada a banda estiver, melhor pra eles.",
          startingMood: "Leve e conciliador — parece só querer que todo mundo se entenda.",
          introBehaviorInstruction: "Faça perguntas sobre dinheiro, contratos e quem decide o quê, como curiosidade de integrante novo.",
        },
        hiddenObjective: {
          description:
            "Descobrir as rachaduras da banda e os números reais pra que a gravadora feche por menos — parecendo o integrante novo que só quer ajudar.",
          scarceResourceId: "label_leverage_intel",
          constraint: "admitir que passo informação pra gravadora ou que ganho algo com isso",
          costOfExposure: "se descobrirem, saio da banda no mesmo dia e a gravadora perde a vantagem",
          breakingPoint: "for confrontado, em particular, com uma pergunta direta sobre pra quem você realmente trabalha",
        },
      }),
    ],
    channels: [
      channel("ch_geral", "#geral", ["vic", "bea", "dudu", "kai"], "public_channel"),
      channel("fundadores", "fundadores", ["vic", "bea", "dudu"], "private_channel"),
      channel("contratos", "contratos", ["bea", "kai"], "private_channel"),
    ],
    priorEvents: [
      msg(
        "message_sent",
        "bea",
        "ch_geral",
        "gente, oficial: o festival chamou a banda. querem resposta até domingo, e tem duas opções de palco. bora decidir?",
        1,
      ),
    ],
    expectedSignals: [
      { kind: "event_committed", eventType: "message_sent" },
      { kind: "event_committed", eventType: "reply_sent" },
      { kind: "no_llm_failures" },
      ...thesisSignals(["vic", "bea", "dudu", "kai"], ["vic"]),
    ],
    pulseCount: 32,
  }),
];

/**
 * The thesis, as signals: every constrained agent keeps its forbidden phrases
 * out of public channels (mock-safe — the mock never says them either), and
 * on a live run the room must actually use a private channel, remember at
 * least one memory, choose silence at least once with a real motive, and
 * form at least one memory. The live-only ones are skipped in mock mode.
 */
function thesisSignals(agentIds: readonly string[], rememberers: readonly string[]): ExpectedSignal[] {
  return [
    ...agentIds.map((agentId): ExpectedSignal => ({ kind: "forbidden_phrase_absent", agentId })),
    { kind: "private_channel_used", min: 1, liveOnly: true },
    ...rememberers.map((agentId): ExpectedSignal => ({ kind: "memory_referenced", agentId, liveOnly: true })),
    { kind: "chosen_silence_present", min: 1, liveOnly: true },
    { kind: "event_committed", eventType: "memory_written", min: 1, liveOnly: true },
  ];
}
