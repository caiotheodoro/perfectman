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
  boredMsgs: string[];                   // was: boredMsg: string
  replyMsgs: string[];
  motives: Record<string, string[]>;     // was: Record<string, string>
};

// ── Deterministic seed helper (no global counter) ────────────────────────────

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
  }
  return Math.abs(h);
}

function pickFor<T>(arr: T[], agentId: string, pulseIndex: number, intentType: string): T {
  return arr[hashStr(agentId + String(pulseIndex) + intentType) % arr.length]!;
}

// ── Scripts ───────────────────────────────────────────────────────────────────

const SCRIPTS: Record<string, Script> = {
  observer: {
    sendMsgs: ["entendi", "hm", "interessante isso", "oi gente", "ok", "certo", "pois é", "sei"],
    boredMsgs: ["tô aqui", "oi", "e aí", "alô?", "alguma novidade?", "olá pessoal"],
    replyMsgs: [
      "oi, que que rolou?", "pode elaborar?", "entendi sim", "faz sentido",
      "hm, interessante", "e daí?", "não entendi bem", "me conta mais",
    ],
    motives: {
      boredom: [
        "Preciso quebrar o silêncio, mas sem falar demais. Só marcar presença.",
        "O silêncio está pesando. Uma palavra basta — não quero chamar atenção.",
        "Ninguém fala nada. Só um sinal de que ainda estou aqui.",
        "Tensão no ar, mas prefiro uma abertura neutra. Observar antes de agir.",
        "Preciso aparecer sem me expor. Um 'oi' serve por agora.",
      ],
      send_message: [
        "Observando a sala em silêncio. Tem algo acontecendo que prefiro notar antes de falar.",
        "Tem algo me incomodando, mas não sei ao certo o quê. Melhor dizer algo neutro.",
        "Preciso marcar presença sem chamar atenção. Uma fala pequena basta.",
        "A tensão aqui está pesando. Melhor dizer algo antes que piore.",
        "Sinto que se eu não falar agora, vou ser ignorado. Hora de aparecer.",
        "Há uma abertura na conversa. Vou aproveitar sem me comprometer demais.",
      ],
      reply_to_message: [
        "Vale a pena responder com cuidado. Não quero parecer ansioso.",
        "Algo me chamou atenção nessa mensagem. Vou responder com parcimônia.",
        "Preciso responder, mas sem revelar o que estou pensando de verdade.",
        "Uma resposta breve aqui — suficiente para mostrar que estou engajado.",
        "Interessante. Vou responder de forma que abra espaço para mais.",
      ],
      no_op: [
        "Melhor ficar quieto e observar por enquanto. Ainda não aconteceu coisa suficiente.",
        "Nada que justifique falar agora. O silêncio também comunica.",
        "Observando. Há dinâmicas que prefiro entender antes de agir.",
        "Por enquanto, escutar. Falar cedo demais pode custar caro.",
      ],
      create_channel: [
        "Sinto necessidade de um espaço mais íntimo. Quero criar um canal pra conversa mais direta.",
        "Preciso de um lugar onde possa falar sem todos ouvindo.",
        "Criar um canal separado pode mudar a dinâmica aqui.",
        "Um espaço privado resolve o que não consigo dizer em aberto.",
      ],
      react: [
        "Uma reação discreta diz muito sem expor demais. Vou usar isso.",
        "Não preciso de palavras — uma reação basta por agora.",
        "Deixar um sinal sem ter que explicar nada. Eficiente.",
        "Mostrar que vi, sem ter que comentar. Isso serve.",
      ],
      invite_agent: [
        "Quer incluir alguém na conversa — mas com cautela.",
        "Trazer alguém pode mudar o equilíbrio. Vou tentar.",
        "Essa pessoa precisa estar aqui. Faz falta na conversa.",
        "Chamar alguém de confiança. Não quero ficar sozinho nessa.",
      ],
      leave_channel: [
        "Este espaço não está mais me servindo. Hora de sair discretamente.",
        "Fica difícil estar aqui com essa energia. Melhor me afastar.",
        "Já ouvi o suficiente. Sair sem fazer barulho.",
        "Esse canal perdeu o ponto. Vou embora.",
      ],
      write_memory: [
        "Preciso registrar isso. Pode ser útil mais tarde.",
        "Não quero esquecer essa troca. Vou guardar.",
        "Algo aqui vale a pena registrar antes que se perca.",
        "Memória falha. Melhor anotar enquanto ainda está fresco.",
      ],
      delay_response: [
        "Melhor esperar um pouco antes de responder. Quero pensar.",
        "Não tenho certeza do que dizer. Preciso de mais um segundo.",
        "Respirar fundo. Responder impulsivamente vai sair errado.",
        "Vou deixar assentar antes de responder. Paciência.",
      ],
      typing_start: [
        "Começando a digitar — ainda não sei o que vou dizer.",
        "Vou tentar formular. Pode ser que eu não mande.",
        "Digitando. Uma palavra de cada vez.",
        "Preciso ver o que vai sair daqui.",
      ],
      typing_cancel: [
        "Parei. Não era o momento certo.",
        "Apaguei tudo. Melhor assim.",
        "Ia dizer algo mas mudei de ideia.",
        "O momento passou. Não adianta mais.",
      ],
    },
  },

  provocateur: {
    sendMsgs: ["sério isso?", "kk", "que bagunça", "e aí?", "oi??", "alguém?", "uau", "nossa"],
    boredMsgs: [
      "alguém tá vivo aqui?", "oi gente, tô aqui", "e aí, sumiu todo mundo?",
      "que silêncio chato", "cadê vocês?", "oi?", "tô me sentindo sozinha aqui",
    ],
    replyMsgs: [
      "nossa, que drama", "tá bom né", "vixi", "ahnn",
      "sério?", "esperava isso", "hm, interessante", "exagerou",
    ],
    motives: {
      boredom: [
        "Não aguento mais esse silêncio. Preciso cutucar alguém pra ver quem reage.",
        "Tá morto aqui. Alguém precisa sacudir o coreto.",
        "Quanto tempo sem ninguém falar nada. Isso me irrita.",
        "Boredom total. Vou soltar uma isca e ver quem morde.",
        "Preciso de estímulo. O silêncio é insuportável. Vou provocar.",
      ],
      send_message: [
        "O silêncio tá me entediando. Vou provocar pra ver quem se mexe primeiro.",
        "Tenho algo a dizer e não vou esperar o momento perfeito.",
        "Hora de agitar. Se eu não falar, ninguém fala.",
        "Sinto que posso mudar o tom aqui se falar certo.",
        "Vou lançar algo e ver como todo mundo reage. Sempre revela muito.",
        "Cansei de esperar. Vou falar o que penso antes que a chance passe.",
      ],
      reply_to_message: [
        "Fácil demais não responder isso. Vou aproveitar.",
        "Essa abertura foi servida na bandeja. Não vou deixar passar.",
        "Responder aqui com força. Pode mexer com a dinâmica.",
        "Isso me deu vontade de responder com tudo. Vou.",
        "Me chamou atenção. Responder vai revelar o que essa pessoa realmente quer.",
      ],
      no_op: [
        "Me segurando dessa vez — mas por pouco. Ainda não vale o esforço.",
        "Deixar passar. Por enquanto. Mas tô de olho.",
        "Não vou reagir a isso agora. Não me interessa o suficiente.",
        "Às vezes o silêncio pesa mais que qualquer coisa que eu pudesse dizer.",
      ],
      create_channel: [
        "Quero um espaço privado pra dizer o que realmente penso sem filtro.",
        "Esse canal tá cheio de gente que não precisa ouvir o que tenho a dizer.",
        "Canal privado. Menos plateia, mais conversa real.",
        "Preciso de um lugar sem censura. Vou criar.",
      ],
      react: [
        "Uma reação rápida é mais eficiente que um texto longo.",
        "Deixar uma reação diz tudo que preciso sem ter que explicar.",
        "Reação rápida. Economiza palavras e faz o mesmo efeito.",
        "Não preciso elaborar — a reação já diz o suficiente.",
      ],
      invite_agent: [
        "Chamando alguém pra entrar nessa bagunça.",
        "Preciso de reforço aqui. Ou de mais caos. Os dois servem.",
        "Trazer alguém vai mudar o jogo. Vamos ver.",
        "Essa pessoa vai agitar as coisas. É o que precisa aqui.",
      ],
      leave_channel: [
        "Esse canal tá morto. Não tem mais graça.",
        "Cansada desse lugar. Tem coisa mais interessante em outro canto.",
        "Já vi o que precisava ver. Vou embora.",
        "Ficou entediante. Próximo.",
      ],
      write_memory: [
        "Anotando isso aqui — pode virar munição depois.",
        "Guardando esse momento. Vai ser útil quando precisar.",
        "Registro. Nunca se sabe quando isso vai servir.",
        "Não quero esquecer o que aconteceu aqui.",
      ],
      delay_response: [
        "Deixar a tensão crescer um pouco antes de responder.",
        "Esperar o momento certo. Responder agora seria desperdício.",
        "Construir suspense. Minha resposta vai pesar mais se eu esperar.",
        "Não vou responder agora. Deixar todo mundo ansioso primeiro.",
      ],
      typing_start: [
        "Começando a digitar. Tenho muito a dizer.",
        "Vou mandar agora. Chega de esperar.",
        "Digitando. Esse texto vai ser certeiro.",
        "Já sei o que dizer. Só preciso escrever.",
      ],
      typing_cancel: [
        "Na verdade não. Não vou alimentar isso agora.",
        "Apaguei. Melhor guardar para o momento certo.",
        "Mudei de ideia. Isso merecia mais do que eu estava escrevendo.",
        "Deletei tudo. Silêncio calculado.",
      ],
    },
  },

  strategist: {
    sendMsgs: ["interessante", "pode ser", "depende", "tem lógica", "hm", "talvez", "considerando", "faz sentido isso"],
    boredMsgs: [
      "alguém tem algo relevante pra dizer?", "e aí, o que acontece?",
      "estou aqui", "como vai isso?", "alguma atualização?", "tá rolando algo?",
    ],
    replyMsgs: [
      "concordo, parcialmente", "tem alguma lógica", "faz sentido", "é uma perspectiva",
      "considerando o contexto...", "pode ser, mas depende", "há outra leitura possível", "isso tem implicações",
    ],
    motives: {
      boredom: [
        "Preciso lembrar que estou aqui. Algo medido e útil sem revelar demais.",
        "O silêncio está me apagando. Uma fala neutra reafirma presença.",
        "Ninguém está prestando atenção em mim. Hora de mudar isso com cuidado.",
        "Estou fora do radar. Uma linha breve resolve isso sem comprometer a posição.",
        "Preciso reaparecer. Mas sem parecer que estava sumido.",
      ],
      send_message: [
        "Posicionando com cuidado — algo não comprometedor mas visível.",
        "Uma fala que abre espaço sem revelar intenção. Perfeito.",
        "Vou falar algo que todos possam interpretar à sua maneira. Útil.",
        "Hora de marcar território de forma sutil. Uma frase basta.",
        "Escolhendo as palavras com cuidado. Cada uma conta.",
        "Algo que mantenha todos na dúvida sobre o que realmente penso.",
      ],
      reply_to_message: [
        "Vale engajar, mantendo neutralidade pra ver como os outros reagem.",
        "Responder aqui consolida minha posição sem me expor.",
        "Uma resposta que pareça acordo sem realmente ser. Essencial.",
        "Engajar de forma que pareça receptivo mas não comprometido.",
        "Minha resposta vai dizer algo, mas não tudo.",
      ],
      no_op: [
        "Informação insuficiente. Observar e esperar — agir agora seria prematuro.",
        "Silêncio estratégico. Observar quem se move primeiro revela intenção.",
        "Nada a ganhar falando agora. Deixar os outros mostrarem as cartas.",
        "Timing errado. Esperar o momento certo vale mais do que qualquer fala.",
      ],
      create_channel: [
        "Um canal privado estratégico. Preciso de espaço para manobras discretas.",
        "Criar um espaço onde posso conversar sem audiência.",
        "Canal separado para alinhar o que não pode ser dito em aberto.",
        "Um espaço para conversas que não cabem no canal principal.",
      ],
      react: [
        "Uma reação calculada. Mostra presença sem comprometer posição.",
        "Deixar um sinal ambíguo. Pode ser interpretado de várias formas.",
        "Reação que sinaliza interesse sem revelar opinião.",
        "Minha reação vai fazer a pessoa pensar sem saber o que penso.",
      ],
      invite_agent: [
        "Trazendo alguém que pode ser útil para a dinâmica aqui.",
        "Essa pessoa muda o balanço de forças. Vale trazer.",
        "Chamando quem pode fortalecer minha posição.",
        "Uma peça nova no tabuleiro pode mudar tudo.",
      ],
      leave_channel: [
        "Esse canal perdeu relevância estratégica. Hora de sair.",
        "Não há mais o que ganhar aqui. Reposicionar.",
        "Saindo antes que o canal esgote qualquer utilidade.",
        "Canal sem mais valor. Meu tempo vale mais em outro lugar.",
      ],
      write_memory: [
        "Registrando para análise futura. Informação é poder.",
        "Guardar isso. Pode mudar o jogo mais tarde.",
        "Anotando. Padrões aqui revelam muito sobre a dinâmica.",
        "Isso vai ser útil. Registrar agora.",
      ],
      delay_response: [
        "Timing é tudo. Esperando o momento mais vantajoso.",
        "Responder agora seria fraco. Deixar marinar.",
        "O silêncio temporário aumenta o peso da resposta.",
        "Vou deixar a conversa evoluir antes de entrar. Mais informação, melhor decisão.",
      ],
      typing_start: [
        "Formulando resposta. Cada palavra importa aqui.",
        "Rascunhando. Precisa estar preciso antes de enviar.",
        "Pensando no que dizer. Não vou apressar.",
        "Digitando com cuidado. O impacto depende da escolha certa.",
      ],
      typing_cancel: [
        "Mudei de estratégia. Silêncio é mais poderoso agora.",
        "Apaguei. Não era suficientemente estratégico.",
        "Cancelado. O momento passou, ou melhorou.",
        "Decidi não enviar. Esse silêncio comunica mais.",
      ],
    },
  },
};

const FALLBACK_SCRIPT: Script = {
  sendMsgs: ["olá", "oi", "ok", "entendi"],
  boredMsgs: ["pois é", "tô aqui", "oi pessoal", "e aí?"],
  replyMsgs: ["oi tudo bem", "entendi sim", "ok", "faz sentido"],
  motives: {
    boredom: ["Entediado. Mandando uma abertura casual pra quebrar o silêncio.", "O silêncio pesou. Só marcar presença."],
    send_message: ["Reagindo à atividade no canal.", "Preciso dizer algo agora."],
    reply_to_message: ["Respondendo à menção direta.", "Faz sentido responder aqui."],
    no_op: ["Nenhum impulso ativo detectado. Optando pelo silêncio.", "Sem razão suficiente para agir agora."],
    create_channel: ["Criando um espaço de conversa.", "Canal novo para essa conversa."],
    react: ["Deixando uma reação.", "Uma reação breve basta aqui."],
    invite_agent: ["Convidando alguém para o canal.", "Trazendo alguém para essa conversa."],
    leave_channel: ["Saindo deste canal.", "Não preciso mais deste espaço."],
    write_memory: ["Registrando algo importante.", "Vale guardar esse momento."],
    delay_response: ["Aguardando antes de responder.", "Vou esperar um pouco."],
    typing_start: ["Digitando uma resposta.", "Vou tentar formular algo."],
    typing_cancel: ["Cancelando a resposta.", "Mudei de ideia."],
  },
};

function getScript(archetype: string): Script {
  return SCRIPTS[archetype.toLowerCase()] ?? FALLBACK_SCRIPT;
}

// ── Runtime wrapper ──────────────────────────────────────────────────────────

export class PersonaAwareRuntime {
  private readonly inner: AgentRuntime;

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
    const isRealLLM = result.llmUsage !== null && result.llmUsage.model !== "mock-model";
    if (isRealLLM || result.fallbackApplied) {
      this.lastIntents.set(input.agentId, result.intent);
      return result;
    }

    // Mock LLM — enrich with per-archetype content so the viewer has
    // something readable while no real LLM is running.
    const script = getScript(input.personaConfig.archetype);
    const intentType = result.intent.intentType;
    const isBored = result.intent.motivationDrivers.includes("boredom");
    const pid = context.pulseIndex;
    const aid = input.agentId;

    let visibleContent = result.intent.visibleContent;
    let privateMotiveSummary = result.intent.privateMotiveSummary;

    if (intentType === "send_message") {
      visibleContent = isBored
        ? pickFor(script.boredMsgs, aid, pid, "boredom")
        : pickFor(script.sendMsgs, aid, pid, intentType);
      privateMotiveSummary = isBored
        ? pickFor(script.motives["boredom"]!, aid, pid, "boredom")
        : pickFor(script.motives["send_message"]!, aid, pid, intentType);
    } else if (intentType === "reply_to_message") {
      visibleContent = pickFor(script.replyMsgs, aid, pid, intentType);
      privateMotiveSummary = pickFor(script.motives["reply_to_message"]!, aid, pid, intentType);
    } else {
      // All other intent types: override privateMotiveSummary with pt-BR text
      const variants = script.motives[intentType] ?? script.motives["no_op"]!;
      privateMotiveSummary = pickFor(variants, aid, pid, intentType);
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
