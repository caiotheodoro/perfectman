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

import type { RoleplayScenario } from "../index.js";
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
    ],
    pulseCount: 32,
  }),
];
