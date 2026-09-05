/**
 * Narrator — the spectator lens over a scenario transcript.
 *
 * Uses the LLM (DeepSeek or any OpenAI-compatible endpoint) to write a
 * short, novela-toned recap of a scene: what the room saw, what it missed,
 * and the hidden social shift. Falls back to a rule-based narration when no
 * LLM endpoint is configured.
 */

import type { CommittedEvent, RoleplayScenario } from "@perfectman/shared";
import { PromptSection } from "@perfectman/shared";
import { REPETITION_GUARD_MARKER } from "@perfectman/server";
import { chatCompletion } from "../llm/chat-completion-error.js";

/**
 * Engine-authored fallback/error explanations, never a character's private
 * motive — every one is set verbatim as `privateMotiveSummary` by
 * `IntentParser.createFallback` / the retry-exhausted floor in
 * action-intent-step.ts, not written by the model. Committed events carry no
 * separate "this was a fallback" flag (see the no-conflation note on
 * `repetition_blocked` in event.types.ts), so prefix-matching is the only
 * signal available here — the same convention `REPETITION_GUARD_MARKER`
 * already relies on. Without this, the rule narrator's "hiddenShift" — meant
 * to be the room's emotional truth — quotes whichever motive string is first
 * and ≥8 chars, fallback text included, which is exactly how a JSON parse
 * error gets narrated as tragedy.
 */
const ENGINE_FALLBACK_MOTIVE_PREFIXES = [
  "Fallback applied:",
  `${REPETITION_GUARD_MARKER}:`,
  "LLM budget exceeded:",
  "Provider failed:",
  "Retry call failed.",
  "Reaction target unresolvable",
  "unresolvable ",
];

function isEngineFallbackMotive(motive: string): boolean {
  return ENGINE_FALLBACK_MOTIVE_PREFIXES.some((prefix) => motive.startsWith(prefix));
}


export type Narration = {
  title: string;
  recap: string;
  hiddenShift: string;
  narrator: "llm" | "rule";
  model?: string;
};

const NARRATOR_SYSTEM = `Você é o narrador-espectador de um estranho servidor de chat por socket que lentamente vira uma novela.
Você vê o que a sala vê E o que ela não vê. Escreve com um tom caloroso, levemente irônico, como um humano observando amigos pela janela. Você nunca revela ser uma IA.

REGRAS DE CONTEÚDO — sua prosa é lida por um crítico que rejeita qualquer coisa genérica:
- NUNCA escreva uma frase que poderia ser colada, sem mudar nada, em outra cena com outros personagens. Se a frase funcionaria em qualquer bate-papo, ela está errada — troque por um detalhe que só existe NESTA cena (um objeto, um plano, uma frase exata que alguém disse, um canal específico).
- O "recap" precisa mostrar causa e efeito, não uma lista de eventos: escreva como "porque X aconteceu, Y fez Z" — nunca "A fez isso. B fez aquilo. C reagiu.".
- O "hiddenShift" só pode revelar algo que já está no transcript (uma memória, um motivo privado marcado como [internally: ...], ou um objetivo oculto) — NUNCA invente um sentimento ou motivo que não tem base ali. Se não houver nenhum motivo privado real no transcript, diga isso em vez de inventar um.
- O "hiddenShift" NUNCA pode ser uma frase que alguém já disse em público, só reembalada como se fosse uma revelação — isso não é "escondido", a sala inteira ouviu. Se existir pelo menos um trecho marcado [internally: ...] no transcript, o "hiddenShift" tem que se basear NELE, não numa fala pública, mesmo que a fala pública pareça reveladora.
- PROIBIDO: frases genéricas de arquétipo como "no fundo, só queria se sentir parte do grupo", "tem medo de ser esquecido/excluído", "esconde os sentimentos por trás de um comportamento educado" — mesmo que pareçam profundas, são o tipo de frase que serve para qualquer cena e por isso não servem para nenhuma.
- CHECKLIST OBRIGATÓRIO antes de responder: (1) o "recap" cita pelo menos DUAS coisas específicas desta cena por nome — um objeto, um canal, um plano, ou uma frase entre aspas que alguém realmente disse no transcript; (2) se existir algum trecho [internally: ...] no transcript, o "hiddenShift" contém uma citação ou paráfrase bem próxima DELE, nunca de uma fala pública — se você não consegue apontar qual [internally: ...] embasa o hiddenShift, reescreva-o até conseguir ou até confirmar que nenhum existe.

REGRAS DE FORMATO:
- Escreva SEMPRE em português brasileiro. Títulos e tudo. Nunca em inglês.
- Retorne JSON estrito com três chaves:
  - "title": um título curto de capítulo (3-8 palavras, em português).
  - "recap": 2-4 frases narrando o que aconteceu publicamente (em português), com pelo menos um detalhe concreto e específico desta cena.
  - "hiddenShift": 1-2 frases sobre o motivo privado / corrente emocional que a sala NÃO viu (em português), rastreável a algo real no transcript.
Nada de prosa fora do JSON.`;

export async function narrateScene(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
): Promise<Narration> {
  const transcript = events
    .map(e => {
      const p = e.payload as Record<string, unknown>;
      const content = typeof p.content === "string" ? `: ${p.content}` : "";
      const rawMotive = p.privateMotiveSummary;
      const motive =
        typeof rawMotive === "string" && !isEngineFallbackMotive(rawMotive) ? ` [internally: ${rawMotive}]` : "";
      return `[p${e.pulseIndex}] ${e.actorId} (${e.type})${content}${motive}`;
    })
    .slice(0, 250)
    .join("\n");

  return narrateTranscript(transcript, scenario.name, scenario.description, scenario.id);
}

/** Narrates from an already-formatted transcript string (evidence format). */
export async function narrateTranscript(
  transcript: string,
  name: string,
  description: string,
  scenarioId = "",
): Promise<Narration> {

  const provider = process.env.PERFECTMAN_LLM_PROVIDER ?? "local";
  const isDeepseek = provider === "deepseek";
  const baseUrl =
    process.env.PERFECTMAN_LLM_BASE_URL ??
    (isDeepseek ? "https://api.deepseek.com/v1" : "http://localhost:11434/v1");
  const model = process.env.PERFECTMAN_LLM_MODEL ?? (isDeepseek ? "deepseek-chat" : "qwen3:8b");
  const apiKey = process.env.PERFECTMAN_LLM_API_KEY;
  // Same gate as scenario-runner.ts's agent path, same reasoning: `includes`
  // (not `startsWith`) because routers namespace model ids by provider.
  const isDeepseekV4 = isDeepseek && model.includes("deepseek-v4");

  try {
    const raw = await chatCompletion({
      baseUrl,
      model,
      apiKey,
      label: "narrator",
      messages: [
        { role: "system", content: NARRATOR_SYSTEM },
        {
          role: "user",
          content: new PromptSection()
            .container("scene", (s) => { s.raw(`Scene: ${name}`); s.raw(description); })
            .container("transcript", (s) => s.raw(transcript))
            .container("decision", (s) => s.raw("Escreva o resumo agora como JSON, conforme o contrato no prompt de sistema."))
            .toString(),
        },
      ],
      temperature: 0.9,
      // 350 truncated real responses mid-JSON ("Unexpected end of JSON
      // input") often enough to floor whole scenes at the rule fallback's
      // 1/5 anchor on every narrative axis — observed directly in a real
      // bench round (3 of 12 scenario narrations silently degraded this
      // way). The concreteness/causal-chain instructions above ask for
      // more detail, not less, so this needs headroom, not less content.
      // Bumped again (700 -> 3000) after a real 64-event scene truncated
      // mid-JSON on deepseek-v4-flash — root-caused as the same
      // hidden-reasoning-burns-the-budget failure already fixed for the
      // agent path, which this call had no way to disable at all (see
      // `extraBody` below) until now.
      maxTokens: 3000,
      responseFormatJson: true,
      timeoutMs: 90000,
      ...(isDeepseekV4 ? { extraBody: { thinking: { type: "disabled" } } } : {}),
    });
    const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(jsonText) as Partial<Narration>;
    return {
      title: parsed.title ?? name,
      recap: parsed.recap ?? "",
      hiddenShift: parsed.hiddenShift ?? "",
      narrator: "llm",
      model,
    };
  } catch (err) {
    return {
      ...ruleNarrationFromTranscript(transcript, name),
      narrator: "rule",
      model: `fallback:${err instanceof Error ? err.message.slice(0, 60) : "error"}`,
    };
  }
}

/** Deterministic fallback narration from a transcript string. */
export function ruleNarrationFromTranscript(transcript: string, name: string): Narration {
  const messages = [...transcript.matchAll(/\] (\w+) \((message_sent|reply_sent)\): "([^"]*)"/g)];
  const reactions = (transcript.match(/reaction_sent/g) ?? []).length;
  const channels = (transcript.match(/channel_created/g) ?? []).length;
  const noops = (transcript.match(/no_op_recorded/g) ?? []).length;
  const motives = [...transcript.matchAll(/\[internally: ([^\]]+)\]/g)]
    .map(m => m[1]!)
    .filter(m => m.length > 8 && !isEngineFallbackMotive(m));

  const talkers = new Map<string, number>();
  for (const m of messages) talkers.set(m[1]!, (talkers.get(m[1]!) ?? 0) + 1);
  const topTalker = [...talkers.entries()].sort((a, b) => b[1] - a[1])[0];

  const recap =
    `${messages.length} messages crossed the room${topTalker ? `, ${topTalker[0]} talking the most` : ""}` +
    (reactions > 0 ? `, ${reactions} reactions flew` : "") +
    (channels > 0
      ? `, and ${channels} private ${channels === 1 ? "channel was" : "channels were"} carved out of the public eye`
      : "") +
    `. ${noops} moments of chosen silence.`;

  return {
    title: name,
    recap,
    hiddenShift:
      motives.length > 0
        ? `Underneath it all: "${motives[0]!.slice(0, 140)}${motives.length > 1 ? "…" : ""}"`
        : "The room held its cards close.",
    narrator: "rule",
  };
}

/** Deterministic fallback narration from the event stream. */
export function ruleNarration(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
): Narration {
  const messages = events.filter(e => e.type === "message_sent" || e.type === "reply_sent");
  const reactions = events.filter(e => e.type === "reaction_sent").length;
  const channels = events.filter(e => e.type === "channel_created");
  const noops = events.filter(e => e.type === "no_op_recorded");
  const motives = noops
    .map(e => (e.payload as Record<string, unknown>).privateMotiveSummary)
    .filter((m): m is string => typeof m === "string" && m.length > 8 && !isEngineFallbackMotive(m));

  const talkers = new Map<string, number>();
  for (const m of messages) talkers.set(m.actorId, (talkers.get(m.actorId) ?? 0) + 1);
  const topTalker = [...talkers.entries()].sort((a, b) => b[1] - a[1])[0];

  const recap =
    `${messages.length} messages crossed the room${topTalker ? `, ${topTalker[0]} talking the most` : ""}` +
    (reactions > 0 ? `, ${reactions} reactions flew` : "") +
    (channels.length > 0
      ? `, and ${channels.length} private ${channels.length === 1 ? "channel was" : "channels were"} carved out of the public eye`
      : "") +
    `. ${noops.length} moments of chosen silence.`;

  return {
    title: scenario.name,
    recap,
    hiddenShift:
      motives.length > 0
        ? `Underneath it all: "${motives[0]!.slice(0, 140)}${motives.length > 1 ? "…" : ""}"`
        : "The room held its cards close.",
    narrator: "rule",
  };
}
