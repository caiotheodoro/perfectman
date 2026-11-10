import type { AgentRuntimeInput, PerceptionPacket } from "@perfectman/shared";
import { answersFirst, lengthTargetFor, nameKeysOf, owedQuestion, roomNames } from "@perfectman/shared";
import type { LengthTarget, MessageLength, OwedLine, OwedQuestion } from "@perfectman/shared";
import { whisperedBy } from "./whisper-note.js";

/**
 * The script checks of a hotel actor's turn (length, novelty, motif, question debt): what the prompt says about them, the notes a retry
 * carries, and the room as they read it. The numbers come from `@perfectman/shared` (norms measured on real plays); this file is the
 * wording and the plumbing. Deterministic and pure: the same packet renders the same notes, so a replayed run builds the same prompts.
 *
 * Everything here is on only when the hotel run's runtime policy says `script: true`. Without it no prompt changes by a byte.
 */

type Lang = "pt-BR" | "en";
export const scriptLang = (language: Lang): "pt" | "en" => (language === "pt-BR" ? "pt" : "en");

/** The length target a persona's `presence.messageLength` maps to (`short` when it says nothing). */
export function lengthTargetOf(messageLength: MessageLength | undefined, language: Lang): LengthTarget {
  return lengthTargetFor(messageLength, scriptLang(language));
}

/** The prompt's length line, in numbers, in the persona's language. */
export function lengthLine(t: LengthTarget, language: Lang): string {
  const [lo, hi] = t.aim;
  const sentences = t.sentences === 1 ? 1 : t.sentences;
  return language === "pt-BR"
    ? `Tamanho da fala: de ${lo} a ${hi} palavras, no máximo ${sentences === 1 ? "uma frase" : `${sentences} frases`}, nunca mais de ${t.cap} palavras. Fale como numa cena: uma jogada por vez, sem discurso.`
    : `Length of a line: ${lo} to ${hi} words, at most ${sentences === 1 ? "one sentence" : `${sentences} sentences`}, never more than ${t.cap} words. Talk the way people do on stage: one move at a time, no speeches.`;
}

// ---- the room, as the checks read it ---------------------------------------------------------------------------------

/** The public speech in view, oldest first, the actor's own lines marked. A guest's or a whispered line is not left out: it is part of what was said. */
export function spokenLines(packet: Pick<PerceptionPacket, "agentId" | "triggeringEvent" | "visibleContextEvents">): Array<OwedLine & { own: boolean }> {
  const seen = new Set<string>();
  const out: Array<OwedLine & { own: boolean }> = [];
  for (const e of [...packet.visibleContextEvents, ...(packet.triggeringEvent ? [packet.triggeringEvent] : [])]) {
    if (e.type !== "message_sent" && e.type !== "reply_sent") continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const p = e.payload as Record<string, unknown> | undefined;
    const text = p?.["content"];
    if (typeof text !== "string" || text.trim() === "") continue;
    if (p?.["mode"] === "whisper" || p?.["channelType"] === "private_channel" || e.visibility.visibilityReason.includes("private")) continue;
    const name = p?.["senderName"];
    const aimed = [p?.["addresseeIds"], p?.["mentionedAgentIds"]].flatMap((ids) => (Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : []));
    out.push({ speaker: typeof name === "string" && name !== "" ? name : e.actorId, text, own: e.actorId === packet.agentId, ...(aimed.length > 0 ? { aimedAt: aimed } : {}) });
  }
  return out;
}

/** The names people in this room go by (speakers in view, the people near, the actor's own): a name said in three lines is address, not a motif. */
export function roomNameKeys(input: AgentRuntimeInput, displayName: string): Set<string> {
  const names = new Set<string>([displayName]);
  for (const l of spokenLines(input.perceptionPacket)) names.add(l.speaker);
  for (const p of input.perceptionPacket.body?.people ?? []) names.add(p.name);
  return roomNames(names);
}

/** Turns of others after a direct question before its addressee is owed a nudge: two, so the one who is next in line is not nagged. */
export const OWED_MIN_AGE = 2;

/** The newest direct question put to this actor that two or more turns of others have passed without an answer from it. */
export function owedFor(input: AgentRuntimeInput, displayName: string): OwedQuestion | undefined {
  const lines = spokenLines(input.perceptionPacket);
  return owedQuestion(lines, (l) => l.own === true, nameKeysOf([displayName]), input.agentId, OWED_MIN_AGE);
}

// ---- prompt notes and retry notes -------------------------------------------------------------------------------------

const said = (text: string, max: number): string => text.replace(/["\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** In the decision of the actor who owes an answer: answer first, short. Never on a whisper (its own note) or a line a person aimed at the actor (the prompt already answers it). */
export function owedNote(q: OwedQuestion, language: Lang): string {
  const quote = said(q.text, 90);
  return language === "pt-BR"
    ? `${q.asker} te fez uma pergunta direta e você ainda não respondeu ("${quote}"). Responda primeiro, em poucas palavras; só depois, se quiser, pergunte algo. Não faça uma pergunta nova antes de responder.`
    : `${q.asker} asked you a direct question and you have not answered ("${quote}"). Answer first, in a few words; only then, if you like, ask something. Do not ask a new question before you answer.`;
}

/** The owed-answer note for this actor's decision, or undefined. */
export function owedNoteFor(input: AgentRuntimeInput, displayName: string, language: Lang): string | undefined {
  if (whisperedBy(input)) return undefined;
  const p = input.perceptionPacket.triggeringEvent?.payload as Record<string, unknown> | undefined;
  if (p?.["untrusted"] === true && [p["addresseeIds"], p["mentionedAgentIds"]].some((ids) => Array.isArray(ids) && ids.includes(input.agentId))) return undefined;
  const q = owedFor(input, displayName);
  return q ? owedNote(q, language) : undefined;
}

/** Retry: the line is over the cap. Names the count and asks for the first sentence only. */
export function lengthRetryNote(words: number, cap: number, language: Lang): string {
  return language === "pt-BR"
    ? `IMPORTANTE: sua última tentativa tinha ${words} palavras e o limite é ${cap}. Diga só a primeira frase: uma jogada, curta, como se fala numa cena.`
    : `IMPORTANT: your last attempt had ${words} words and the limit is ${cap}. Say only the first sentence: one move, short, the way people talk in a scene.`;
}

/** Retry: the line brings back a phrase or simile the room already used. Names it and asks for one new thing. */
export function motifRetryNote(motif: string, language: Lang): string {
  const m = said(motif, 60);
  return language === "pt-BR"
    ? `IMPORTANTE: a expressão "${m}" já apareceu em duas das últimas falas da sala. Não use essa expressão nem outra parecida. Traga uma coisa nova: um fato, um objeto, uma acusação ou uma decisão. Se não tiver nada novo, diga uma reação curta.`
    : `IMPORTANT: the phrase "${m}" is already in two of the room's last lines. Do not use it or a variation of it. Bring one new thing: a fact, an object, an accusation or a decision. If you have nothing new, give a short reaction.`;
}

/** Retry: the line says nothing the room has not just heard. */
export function noveltyRetryNote(language: Lang): string {
  return language === "pt-BR"
    ? "IMPORTANTE: sua última tentativa só repete o que a sala acabou de ouvir. Traga uma coisa nova: um fato, um objeto, uma acusação ou uma decisão. Se não tiver nada novo, diga uma reação curta."
    : "IMPORTANT: your last attempt only gives the room back what it just heard. Bring one new thing: a fact, an object, an accusation or a decision. If you have nothing new, give a short reaction.";
}

/** Retry: the actor asked while it owed an answer. */
export function owedRetryNote(q: OwedQuestion, language: Lang): string {
  const quote = said(q.text, 90);
  return language === "pt-BR"
    ? `IMPORTANTE: ${q.asker} te perguntou ("${quote}") e a sua última tentativa fez outra pergunta sem responder. Responda a ${q.asker} primeiro, numa frase; não pergunte nada nesta fala.`
    : `IMPORTANT: ${q.asker} asked you ("${quote}") and your last attempt asked something else without answering. Answer ${q.asker} first, in one sentence; ask nothing in this line.`;
}

const REACTIONS: Record<Lang, readonly string[]> = {
  "pt-BR": ["Ah.", "Hm.", "Ué.", "Sei.", "Tá."],
  en: ["Ah.", "Hm.", "Huh.", "Right.", "Okay."],
};

/** A short reaction in place of a line the room has already heard, picked by a hash of the turn so a replayed run says the same. */
export function reactionFor(seed: string, language: Lang): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  const list = REACTIONS[language];
  return list[h % list.length]!;
}

export { answersFirst };
