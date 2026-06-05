/**
 * ScenarioConfig type and preset library.
 *
 * Scenarios are social starting conditions, not technical architecture.
 * They answer: "What kind of situation are these personas entering?"
 * The persona answers: "Given who I am, how do I behave in that situation?"
 */
import type { RelationalState } from "@perfectman/shared";

// ── Types ────────────────────────────────────────────────────────────────────

export type PairFamiliarity = "close_friends" | "friends" | "acquaintances" | "strangers";
export type RelationshipMode = "established_friends" | "strangers" | "mixed";
export type VisibleIntroPolicy = "none" | "system_intro" | "agent_intros" | "host_prompt";
export type AgentIntroBehavior =
  | "do_not_introduce_yourself_formally"
  | "introduce_yourself"
  | "introduce_only_to_unknowns";

export type ScenarioConfig = {
  id: string;
  name: string;
  relationshipMode: RelationshipMode;
  /** Narrative description injected into every agent's system prompt. */
  roomContext: string;
  /** E.g. "silencioso, casual, levemente vazio" */
  startingMood: string;
  visibleIntro: VisibleIntroPolicy;
  agentIntroBehavior: AgentIntroBehavior;
  /** Hint for who should speak first and how. */
  firstMoveGuidance?: string;
  /** "agentA:agentB" → familiarity level (symmetric key, sorted alphabetically). */
  pairFamiliarity?: Record<string, PairFamiliarity>;
  /** Injected as bullet-point constraints in the system prompt. */
  customNotes?: string[];
  /** If set, displayed to all agents as an initial host message in their scenario context. */
  hostStartingMessage?: string;
};

// ── Relationship seeding helpers ─────────────────────────────────────────────

const FAMILIARITY_OVERRIDES: Record<PairFamiliarity, Partial<RelationalState>> = {
  close_friends: {
    trust: 0.85, affection: 0.75, comfort: 0.90, suspicion: 0.05,
    threat: 0.02, desireForCloseness: 0.80, desireForDistance: 0.05, resentment: 0.03,
  },
  friends: {
    trust: 0.65, affection: 0.50, comfort: 0.65, suspicion: 0.10,
    threat: 0.05, desireForCloseness: 0.55, desireForDistance: 0.10,
  },
  acquaintances: {
    trust: 0.35, affection: 0.20, comfort: 0.35, suspicion: 0.20,
    threat: 0.10, desireForCloseness: 0.25, desireForDistance: 0.15,
  },
  strangers: {
    trust: 0.10, affection: 0.00, comfort: 0.10, suspicion: 0.30,
    threat: 0.20, desireForCloseness: 0.15, desireForDistance: 0.25,
  },
};

export function relationalStateFromFamiliarity(
  targetAgentId: string,
  familiarity: PairFamiliarity,
): RelationalState {
  return {
    targetAgentId,
    trust: 0.5, affection: 0.3, resentment: 0, attraction: 0.2,
    suspicion: 0.1, admiration: 0.2, envy: 0, comfort: 0.5, threat: 0,
    curiosity: 0.3, desireForCloseness: 0.3, desireForDistance: 0.1,
    interactionCount: 0, lastInteractionAt: null, lastPositiveAt: null, lastNegativeAt: null,
    ...FAMILIARITY_OVERRIDES[familiarity],
  };
}

/**
 * Builds the initial RelationalState map for one agent, given scenario pairFamiliarity.
 * Looks up symmetric keys in both "a:b" and "b:a" form; defaults to "acquaintances".
 */
export function buildRelationalStates(
  agentId: string,
  allAgentIds: string[],
  pairFamiliarity: Record<string, PairFamiliarity>,
): Record<string, RelationalState> {
  const result: Record<string, RelationalState> = {};
  for (const otherId of allAgentIds) {
    if (otherId === agentId) continue;
    const familiarity =
      pairFamiliarity[`${agentId}:${otherId}`] ??
      pairFamiliarity[`${otherId}:${agentId}`] ??
      "acquaintances";
    result[otherId] = relationalStateFromFamiliarity(otherId, familiarity);
  }
  return result;
}

// ── Preset: introBehavior → pt-BR instruction string ─────────────────────────

export const INTRO_BEHAVIOR_INSTRUCTION: Record<AgentIntroBehavior, string> = {
  do_not_introduce_yourself_formally:
    "Não se apresente formalmente. Você já conhece todos neste grupo.",
  introduce_yourself:
    "Uma breve apresentação é natural neste contexto. Mantenha o tom casual e curto.",
  introduce_only_to_unknowns:
    "Apresente-se apenas a pessoas que você não conhece. Com quem já conhece, aja com familiaridade.",
};

// ── Presets ───────────────────────────────────────────────────────────────────

export const FRIENDS_COLD_OPEN: ScenarioConfig = {
  id: "friends_cold_open",
  name: "Amigos — Chat Quieto",
  relationshipMode: "established_friends",
  roomContext:
    "Este é um grupo privado de amigos que já se conhecem há algum tempo. O chat está quieto. Ninguém falou nada recentemente.",
  startingMood: "silencioso, casual, levemente vazio",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  firstMoveGuidance:
    "Se você falar primeiro, aja como alguém revivendo um grupo familiar — não se apresente.",
  customNotes: [
    "Você já conhece todos aqui. Não há necessidade de se apresentar.",
    "O silêncio é normal neste grupo. Ninguém precisa explicar por que sumiu.",
    "Canais privados são comuns entre subgrupos e podem gerar suspeita nos de fora.",
    "Quando falar, diga ALGO CONCRETO — uma pergunta real, uma observação sobre o que aconteceu, uma reação ao que alguém disse. Nunca mande uma mensagem vaga só para 'marcar presença'.",
  ],
  hostStartingMessage: "alguém mais tá pensando no que aconteceu no sábado?",
};

export const STRANGERS_FIRST_MEETING: ScenarioConfig = {
  id: "strangers_first_meeting",
  name: "Estranhos — Primeiro Encontro",
  relationshipMode: "strangers",
  roomContext:
    "Um novo grupo foi criado com pessoas que não se conhecem. Este é o primeiro contato entre todos.",
  startingMood: "incerto, cauteloso, levemente formal",
  visibleIntro: "agent_intros",
  agentIntroBehavior: "introduce_yourself",
  firstMoveGuidance:
    "Uma breve apresentação é natural. Mantenha o tom casual e curto.",
  customNotes: [
    "Você não conhece ninguém aqui. Não invente histórico compartilhado.",
    "Uma apresentação curta é esperada, mas não obrigatória.",
  ],
};

export const MIXED_ACQUAINTANCES: ScenarioConfig = {
  id: "mixed_acquaintances",
  name: "Misto — Alguns se Conhecem",
  relationshipMode: "mixed",
  roomContext:
    "Alguns membros do grupo já se conhecem; outros são novos para parte do grupo. A familiaridade é assimétrica.",
  startingMood: "polido mas incerto",
  visibleIntro: "agent_intros",
  agentIntroBehavior: "introduce_only_to_unknowns",
  firstMoveGuidance:
    "Apresente-se apenas a quem você não conhece. Com conhecidos, aja com naturalidade.",
  customNotes: [
    "Apresente-se somente a pessoas que você não conhece.",
    "Com quem você já conhece, aja com naturalidade — não precisa de apresentação formal.",
  ],
};

export const RETURNING_AFTER_SILENCE: ScenarioConfig = {
  id: "returning_after_silence",
  name: "Retorno Após Silêncio",
  relationshipMode: "established_friends",
  roomContext:
    "O grupo existe, mas ninguém falou nada por um bom tempo. Há uma estranheza silenciosa no ar.",
  startingMood: "levemente estranho, nostálgico, incerto sobre como retomar",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  firstMoveGuidance:
    "Quem falar primeiro está quebrando o gelo depois de uma ausência. Pode soar levemente desajeitado.",
  customNotes: [
    "Você conhece os outros, mas o grupo ficou quieto por um tempo.",
    "Ninguém precisa se apresentar — o silêncio foi acidental.",
    "A tensão de 'quem fala primeiro' está presente.",
  ],
};

export const POST_CONFLICT_QUIET: ScenarioConfig = {
  id: "post_conflict_quiet",
  name: "Pós-Conflito — Sala Tensa",
  relationshipMode: "established_friends",
  roomContext:
    "Algo menor aconteceu antes do início da simulação. Ninguém abordou diretamente. Há um subtexto não resolvido no ar.",
  startingMood: "tenso, reservado, levemente pós-conflito",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  firstMoveGuidance:
    "O que você disser carrega o peso do que aconteceu antes. Escolha as palavras com cuidado.",
  customNotes: [
    "Algo aconteceu antes do início desta simulação. Ninguém sabe exatamente o que o outro está sentindo sobre isso.",
    "Evite abordar o conflito diretamente a não ser que se sinta confortável.",
    "O subtexto é o ponto central desta cena.",
  ],
};

export const INTRODUCED_BY_HOST: ScenarioConfig = {
  id: "introduced_by_host",
  name: "Apresentado por Anfitrião",
  relationshipMode: "mixed",
  roomContext:
    "Um anfitrião abriu o grupo e apresentou o espaço. As pessoas ainda estão chegando e se acomodando.",
  startingMood: "receptivo, curioso, levemente formal",
  visibleIntro: "host_prompt",
  agentIntroBehavior: "introduce_yourself",
  firstMoveGuidance:
    "O anfitrião já apresentou o contexto. Você pode responder ao convite ou se apresentar brevemente.",
  hostStartingMessage: "Bem-vindos ao grupo. Fiquem à vontade para conversar.",
  customNotes: [
    "Um anfitrião abriu o espaço — o contexto de chegada é compartilhado.",
  ],
};

export const PRIVATE_CHANNEL_SEED: ScenarioConfig = {
  id: "private_channel_seed",
  name: "Canal Privado desde o Início",
  relationshipMode: "mixed",
  roomContext:
    "Alguns membros do grupo têm acesso a canais privados desde o início, criando uma assimetria informacional visível.",
  startingMood: "ambíguo, levemente competitivo",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  customNotes: [
    "Canais privados existem desde o início. Nem todos sabem quem está em qual canal.",
    "A assimetria de informação é parte da dinâmica desta cena.",
    "Suspeita sobre alianças é natural neste contexto.",
  ],
};

// ── 10 pre-determined scenario presets ───────────────────────────────────────

export const CHURRASCO_DO_SABADO: ScenarioConfig = {
  id: "churrasco_do_sabado",
  name: "O Churrasco do Sábado",
  relationshipMode: "established_friends",
  roomContext:
    "Este é um grupo de amigos que se viu no último sábado num churrasco. O evento terminou de forma tensa — algo foi dito que não deveria ter sido. O grupo reabre agora.",
  startingMood: "casual mas levemente tenso, como depois de uma briga não resolvida",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  firstMoveGuidance:
    "Abra com algo neutro — não mencione o conflito diretamente a menos que alguém mais abra.",
  customNotes: [
    "Você sabe o que aconteceu no sábado. Não explique para o leitor — apenas reaja.",
    "Não mencione o conflito diretamente até que alguém abra o assunto.",
    "Mensagens curtas e vagas são válidas aqui — silêncio relativo é realista.",
    "Quando falar, diga ALGO CONCRETO — uma pergunta real, uma observação, uma reação. Nunca mande uma mensagem vaga só para 'marcar presença'.",
  ],
  hostStartingMessage: "oi gente. todo mundo bem?",
};

export const PROMOCAO_DESIGUAL: ScenarioConfig = {
  id: "promocao_desigual",
  name: "A Promoção",
  relationshipMode: "established_friends",
  roomContext:
    "O grupo recebeu hoje a notícia de que Larissa foi promovida para uma vaga que ela e Tiago disputavam. O email foi enviado pela empresa. O grupo sabe.",
  startingMood: "levemente festivo para uns, tenso para outros",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  customNotes: [
    "Você sabe da promoção da Larissa. Tiago também concorria.",
    "Parabenizar alguém nessa situação é complicado. Reaja de acordo com quem você é.",
    "Quando falar, diga ALGO CONCRETO — não mande mensagem genérica.",
  ],
  hostStartingMessage: "ei larissa, soube da novidade 👀",
};

export const TERMINO_NO_GRUPO: ScenarioConfig = {
  id: "termino_no_grupo",
  name: "O Término",
  relationshipMode: "established_friends",
  roomContext:
    "Pedro e Clara terminaram há 3 dias depois de 2 anos juntos. Ambos ainda estão no grupo. Ninguém abordou o assunto diretamente.",
  startingMood: "neutro na superfície, carregado por baixo",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  customNotes: [
    "Pedro e Clara terminaram recentemente. Ambos estão no grupo.",
    "Ninguém falou sobre o assunto ainda. A tensão é latente.",
    "Escolha as palavras com cuidado — qualquer coisa pode ser lida de mais de uma forma.",
    "Quando falar, diga ALGO CONCRETO — não mande mensagem genérica.",
  ],
  hostStartingMessage: "boa tarde galera",
};

export const O_VAZAMENTO: ScenarioConfig = {
  id: "o_vazamento",
  name: "O Vazamento",
  relationshipMode: "established_friends",
  roomContext:
    "Um screenshot de uma conversa deste grupo privado foi parar em outro grupo. Todos sabem. Ninguém confessou. A suspeita recai sobre Marcos.",
  startingMood: "tenso, desconfiado, com a sensação de que algo foi violado",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  customNotes: [
    "Alguém neste grupo vazou um screenshot. Todos sabem. Ninguém confessou.",
    "A desconfiança está no ar. Cuidado com o que você diz — pode ser usado contra você.",
    "Accountability e lealdade estão em conflito direto aqui.",
    "Quando falar, diga ALGO CONCRETO — não mande mensagem genérica.",
  ],
  hostStartingMessage: "a gente precisa conversar sobre o que aconteceu",
};

export const CONVITE_PERDIDO: ScenarioConfig = {
  id: "convite_perdido",
  name: "O Convite Perdido",
  relationshipMode: "established_friends",
  roomContext:
    "Três membros do grupo foram num show na última sexta sem chamar o quarto. Postaram stories. Ele viu. Agora está de volta no grupo, em silêncio.",
  startingMood: "superficialmente normal, com uma mágoa latente",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  customNotes: [
    "Nando viu os stories do show. Não foi chamado. Não vai mencionar diretamente.",
    "Não faça drama explícito — a tensão é nas entrelinhas.",
    "Quando falar, diga ALGO CONCRETO — não mande mensagem genérica.",
  ],
  hostStartingMessage: "eai galera, fim de semana bom?",
};

export const CRUSH_REVELADO: ScenarioConfig = {
  id: "crush_revelado",
  name: "O Crush Revelado",
  relationshipMode: "established_friends",
  roomContext:
    "Kaue mandou uma mensagem pra um amigo em comum confessando sentimentos por Lina. O amigo fez screenshot e mandou pro grupo. Todo mundo viu. Kaue acabou de abrir o chat.",
  startingMood: "divertido para uns, constrangedor para outros",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  customNotes: [
    "Todo mundo viu o screenshot. Kaue sabe que viram.",
    "Lina ainda não se posicionou. Kaue está tentando gerenciar o dano.",
    "Quando falar, diga ALGO CONCRETO — não mande mensagem genérica.",
  ],
  hostStartingMessage: "então... alguém vai falar ou não?",
};

export const PLANO_DIVIDIDO: ScenarioConfig = {
  id: "plano_dividido",
  name: "O Plano Dividido",
  relationshipMode: "established_friends",
  roomContext:
    "O grupo está planejando uma viagem de 4 dias. Há duas propostas na mesa há uma semana: praia (Mari + André) vs. serra (Cris + Felipe). Ambos fizeram reservas tentativas. O prazo é amanhã.",
  startingMood: "produtivo tentando ser, mas frustrado por baixo",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  customNotes: [
    "A viagem precisa ser decidida hoje. Duas opções incompatíveis na mesa.",
    "Mari e Cris têm posições firmes. André quer que todo mundo fique feliz. Felipe só quer que acabe.",
    "Quando falar, diga ALGO CONCRETO — não mande mensagem genérica.",
  ],
  hostStartingMessage: "amanhã é o prazo. precisamos decidir hoje.",
};

export const A_AUSENCIA: ScenarioConfig = {
  id: "a_ausencia",
  name: "A Ausência",
  relationshipMode: "established_friends",
  roomContext:
    "Renata sumiu do grupo por 3 semanas — sem responder nada, sem reagir, sem sinal de vida. Agora ela ficou online. Todo mundo pode ver. Ninguém mandou mensagem ainda.",
  startingMood: "aliviado mas contido, com perguntas não ditas",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  firstMoveGuidance:
    "Quem falar primeiro está quebrando 3 semanas de silêncio. Cada palavra vai ter peso.",
  customNotes: [
    "Renata sumiu por 3 semanas. Ela acabou de ficar online.",
    "Ninguém sabe o motivo. Não invente — apenas reaja de acordo com quem você é.",
    "Quando falar, diga ALGO CONCRETO — não mande mensagem genérica.",
  ],
  hostStartingMessage: "oi sumida 👀",
};

export const OPINIAO_POLEMICA: ScenarioConfig = {
  id: "opiniao_polemica",
  name: "A Opinião Polêmica",
  relationshipMode: "established_friends",
  roomContext:
    "Zé postou algo controverso no Twitter ontem — uma opinião sobre um tema que o grupo tem posições fortes. O screenshot está no grupo desde a noite passada. Zé não recuou.",
  startingMood: "tenso, com posições divergentes prestes a emergir",
  visibleIntro: "none",
  agentIntroBehavior: "do_not_introduce_yourself_formally",
  customNotes: [
    "Todos viram o post do Zé. Ninguém sabe exatamente como os outros reagiram.",
    "Esse é um debate de valores. Não tem resposta certa.",
    "Quando falar, diga ALGO CONCRETO — não mande mensagem genérica.",
  ],
  hostStartingMessage: "zé, vi o post. vai explicar?",
};

export const O_NOVO: ScenarioConfig = {
  id: "o_novo",
  name: "O Novo",
  relationshipMode: "mixed",
  roomContext:
    "Leo adicionou Edu no grupo — um amigo de amigo que só conhece o Leo. Os outros ainda estão conhecendo Edu agora.",
  startingMood: "receptivo mas avaliativo",
  visibleIntro: "host_prompt",
  agentIntroBehavior: "introduce_only_to_unknowns",
  firstMoveGuidance:
    "Edu acabou de entrar no grupo. Leo o está apresentando. Os outros estão formando uma primeira impressão.",
  customNotes: [
    "Edu é novo aqui. Só conhece o Leo.",
    "Os outros estão avaliando Edu — consciente ou inconscientemente.",
    "Quando falar, diga ALGO CONCRETO — não mande mensagem genérica.",
  ],
  hostStartingMessage: "gente, esse é o edu que falei. edu, seja bem-vindo 👋",
};
