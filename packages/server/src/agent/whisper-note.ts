import type { AgentRuntimeInput } from "@perfectman/shared";
import { quoteUntrusted, safeDisplayName } from "./untrusted-text.js";

type Lang = "pt-BR" | "en";

/**
 * The person who just whispered to this agent: the trigger is a whisper only it heard clearly (hotel, D44).
 * Returns the quoted display name, safe to put in a prompt.
 */
export function whisperedBy(input: AgentRuntimeInput): string | undefined {
  const trigger = input.perceptionPacket.triggeringEvent;
  const p = trigger?.payload as Record<string, unknown> | undefined;
  if (!trigger || !p || trigger.actorId === input.agentId || p["mode"] !== "whisper" || p["untrusted"] !== true) return undefined;
  const hearing = p["hearing"];
  const level = typeof hearing === "object" && hearing !== null ? (hearing as Record<string, unknown>)[input.agentId] : undefined;
  if (level !== "clear") return undefined;
  return quoteUntrusted(safeDisplayName(typeof p["senderName"] === "string" ? p["senderName"] : undefined, "?"));
}

/** What the model is told at the decision moment when somebody whispered to it. */
export function whisperNote(name: string, lang: Lang): string {
  return lang === "pt-BR"
    ? `${name} cochichou só pra você, mais ninguém ouviu. Responda ${name} baixinho, em uma ou duas frases, direto ao que foi dito: é uma conversa entre vocês dois, não fale com o resto da sala nem mude de assunto.`
    : `${name} whispered to you and nobody else heard. Answer ${name} quietly, in a line or two, about what was said: it is between the two of you, so do not talk to the rest of the room or change the subject.`;
}

/** The mark on a whisper in the event list, so the line reads as private and aimed at the reader. */
export function whisperMark(lang: Lang, to?: string): string {
  if (to) return lang === "pt-BR" ? ` (cochichando com ${to})` : ` (whispering to ${to})`;
  return lang === "pt-BR" ? " (cochichando só pra você)" : " (whispering to you)";
}
