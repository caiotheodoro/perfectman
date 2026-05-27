/**
 * PersonaAwareRuntime — wraps AgentRuntime with per-archetype message content
 * and richer privateMotiveSummary for the HTML snapshot viewer.
 *
 * Keeps all budget checking, fallback handling, and LLM infrastructure from
 * AgentRuntime intact; only post-processes the surface-level output.
 */
import type { AgentRuntimeInput } from "@perfectman/shared";
import type { AgentRuntimeContext, AgentRuntimeOutput } from "../agent/agent-runtime.types.js";
import type { ActionIntent } from "@perfectman/shared";
import { AgentRuntime } from "../agent/agent-runtime.js";
import type { AgentConfigRegistry } from "../agent/agent-config-registry.js";

// ── Per-archetype content scripts ────────────────────────────────────────────

type Script = {
  sendMsgs: string[];
  boredMsg: string;
  replyMsgs: string[];
  motives: Record<string, string>; // keys: intent types + "boredom"
};

const SCRIPTS: Record<string, Script> = {
  observer: {
    sendMsgs: ["entendi", "hm", "interessante isso", "oi gente"],
    boredMsg: "tô aqui",
    replyMsgs: ["oi, que que rolou?", "pode elaborar?", "entendi sim", "faz sentido"],
    motives: {
      boredom: "Preciso quebrar o silêncio, mas sem falar demais. Só marcar presença.",
      send_message: "Observando a sala em silêncio. Tem algo acontecendo que prefiro notar antes de falar.",
      reply_to_message: "Vale a pena responder com cuidado. Não quero parecer ansioso.",
      no_op: "Melhor ficar quieto e observar por enquanto. Ainda não aconteceu coisa suficiente.",
      create_channel: "Sinto necessidade de um espaço mais íntimo. Quero criar um canal pra conversa mais direta.",
      react: "Uma reação discreta diz muito sem expor demais. Vou usar isso.",
      invite_agent: "Quer incluir alguém na conversa — mas com cautela.",
      leave_channel: "Este espaço não está mais me servindo. Hora de sair discretamente.",
      write_memory: "Preciso registrar isso. Pode ser útil mais tarde.",
      delay_response: "Melhor esperar um pouco antes de responder. Quero pensar.",
      typing_start: "Começando a digitar — ainda não sei o que vou dizer.",
      typing_cancel: "Parei. Não era o momento certo.",
    },
  },
  provocateur: {
    sendMsgs: ["sério isso?", "kk", "que bagunça", "e aí?"],
    boredMsg: "alguém tá vivo aqui?",
    replyMsgs: ["nossa, que drama", "tá bom né", "vixi", "ahnn"],
    motives: {
      boredom: "Não aguento mais esse silêncio. Preciso cutucar alguém pra ver quem reage.",
      send_message: "O silêncio tá me entediando. Vou provocar pra ver quem se mexe primeiro.",
      reply_to_message: "Fácil demais não responder isso. Vou aproveitar.",
      no_op: "Me segurando dessa vez — mas por pouco. Ainda não vale o esforço.",
      create_channel: "Quero um espaço privado pra dizer o que realmente penso sem filtro.",
      react: "Uma reação rápida é mais eficiente que um texto longo.",
      invite_agent: "Chamando alguém pra entrar nessa bagunça.",
      leave_channel: "Esse canal tá morto. Não tem mais graça.",
      write_memory: "Anotando isso aqui — pode virar munição depois.",
      delay_response: "Deixar a tensão crescer um pouco antes de responder.",
      typing_start: "Começando a digitar. Tenho muito a dizer.",
      typing_cancel: "Na verdade não. Não vou alimentar isso agora.",
    },
  },
  strategist: {
    sendMsgs: ["interessante", "pode ser", "depende", "tem lógica"],
    boredMsg: "alguém tem algo relevante pra dizer?",
    replyMsgs: ["concordo, parcialmente", "tem alguma lógica", "faz sentido", "é uma perspectiva"],
    motives: {
      boredom: "Preciso lembrar que estou aqui. Algo medido e útil sem revelar demais.",
      send_message: "Posicionando com cuidado — algo não comprometedor mas visível.",
      reply_to_message: "Vale engajar, mantendo neutralidade pra ver como os outros reagem.",
      no_op: "Informação insuficiente. Observar e esperar — agir agora seria prematuro.",
      create_channel: "Um canal privado estratégico. Preciso de espaço para manobras discretas.",
      react: "Uma reação calculada. Mostra presença sem comprometer posição.",
      invite_agent: "Trazendo alguém que pode ser útil para a dinâmica aqui.",
      leave_channel: "Esse canal perdeu relevância estratégica. Hora de sair.",
      write_memory: "Registrando para análise futura. Informação é poder.",
      delay_response: "Timing é tudo. Esperando o momento mais vantajoso.",
      typing_start: "Formulando resposta. Cada palavra importa aqui.",
      typing_cancel: "Mudei de estratégia. Silêncio é mais poderoso agora.",
    },
  },
};

const FALLBACK_SCRIPT: Script = {
  sendMsgs: ["olá", "oi"],
  boredMsg: "pois é",
  replyMsgs: ["oi tudo bem"],
  motives: {
    boredom: "Entediado. Mandando uma abertura casual pra quebrar o silêncio.",
    send_message: "Reagindo à atividade no canal.",
    reply_to_message: "Respondendo à menção direta.",
    no_op: "Nenhum impulso ativo detectado. Optando pelo silêncio.",
    create_channel: "Criando um espaço de conversa.",
    react: "Deixando uma reação.",
    invite_agent: "Convidando alguém para o canal.",
    leave_channel: "Saindo deste canal.",
    write_memory: "Registrando algo importante.",
    delay_response: "Aguardando antes de responder.",
    typing_start: "Digitando uma resposta.",
    typing_cancel: "Cancelando a resposta.",
  },
};

function getScript(archetype: string): Script {
  return SCRIPTS[archetype.toLowerCase()] ?? FALLBACK_SCRIPT;
}

function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length]!;
}

// ── Runtime wrapper ──────────────────────────────────────────────────────────

export class PersonaAwareRuntime {
  private readonly inner: AgentRuntime;
  private callIndex = 0;

  /** Last resolved intent per agentId — used by SimulationRecorder for thinking panels. */
  readonly lastIntents = new Map<string, ActionIntent>();

  constructor(registry: AgentConfigRegistry) {
    this.inner = new AgentRuntime(undefined, registry);
  }

  async generateIntent(
    input: AgentRuntimeInput,
    context: AgentRuntimeContext,
  ): Promise<AgentRuntimeOutput> {
    const result = await this.inner.generateIntent(input, context);

    // Real LLM — track intent as-is, never overwrite the model's output.
    const isRealLlm = result.llmUsage !== null && result.llmUsage.model !== "mock-model";
    if (isRealLlm || result.fallbackApplied) {
      this.lastIntents.set(input.agentId, result.intent);
      return result;
    }

    // Mock LLM — enrich with per-archetype content so the viewer has
    // something readable while no real LLM is running.
    const script = getScript(input.personaConfig.archetype);
    const seed = this.callIndex++;
    const intentType = result.intent.intentType;
    const isBored = result.intent.motivationDrivers.includes("boredom");

    let visibleContent = result.intent.visibleContent;
    let privateMotiveSummary = result.intent.privateMotiveSummary;

    if (intentType === "send_message") {
      visibleContent = isBored ? script.boredMsg : pick(script.sendMsgs, seed);
      privateMotiveSummary = isBored
        ? script.motives["boredom"]!
        : script.motives["send_message"]!;
    } else if (intentType === "reply_to_message") {
      visibleContent = pick(script.replyMsgs, seed);
      privateMotiveSummary = script.motives["reply_to_message"]!;
    } else {
      // All other intent types: override privateMotiveSummary with pt-BR text
      privateMotiveSummary =
        script.motives[intentType] ?? script.motives["no_op"]!;
    }

    const intent: ActionIntent = {
      ...result.intent,
      visibleContent,
      privateMotiveSummary,
    };

    this.lastIntents.set(input.agentId, intent);
    return { ...result, intent };
  }
}
