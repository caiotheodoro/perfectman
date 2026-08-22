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
import { chatCompletion } from "../llm/chat-completion.js";


export type Narration = {
  title: string;
  recap: string;
  hiddenShift: string;
  narrator: "llm" | "rule";
  model?: string;
};

const NARRATOR_SYSTEM = `Você é o narrador-espectador de um estranho servidor de chat por socket que lentamente vira uma novela.
Você vê o que a sala vê E o que ela não vê. Escreve com um tom caloroso, levemente irônico, como um humano observando amigos pela janela. Você nunca revela ser uma IA.

REGRAS:
- Escreva SEMPRE em português brasileiro. Títulos e tudo. Nunca em inglês.
- Retorne JSON estrito com três chaves:
  - "title": um título curto de capítulo (3-8 palavras, em português).
  - "recap": 2-4 frases narrando o que aconteceu publicamente (em português).
  - "hiddenShift": 1-2 frases sobre o motivo privado / corrente emocional que a sala NÃO viu (em português).
Nada de prosa fora do JSON.`;

export async function narrateScene(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
): Promise<Narration> {
  const transcript = events
    .map(e => {
      const p = e.payload as Record<string, unknown>;
      const content = typeof p.content === "string" ? `: ${p.content}` : "";
      const motive = typeof p.privateMotiveSummary === "string" ? ` [internally: ${p.privateMotiveSummary}]` : "";
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

  if (!apiKey && !isDeepseek) {
    return ruleNarrationFromTranscript(transcript, name);
  }

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
      maxTokens: 350,
      responseFormatJson: true,
      timeoutMs: 90000,
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
  const motives = [...transcript.matchAll(/\[internally: ([^\]]+)\]/g)].map(m => m[1]!).filter(m => m.length > 8);

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
    .filter((m): m is string => typeof m === "string" && m.length > 8);

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
