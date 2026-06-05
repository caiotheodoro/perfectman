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
