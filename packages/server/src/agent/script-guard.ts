import type { AgentRuntimeInput, PerceptionPacket } from "@perfectman/shared";
import { OUTPUT_GUARD_MARKER, answersFirst, lengthOf, lengthTargetFor, moveBefore, nameKeysOf, owedQuestion, roomNames } from "@perfectman/shared";
import type { LengthTarget, MessageLength, MoveKind, OwedLine, OwedMove, OwedQuestion, QuoteIssue } from "@perfectman/shared";
import { whisperedBy } from "./whisper-note.js";
import type { TicHit } from "./echo-guard.js";

/**
 * The script checks of a hotel actor's turn (length, novelty, motif, question debt, narration, quotes, a move made at the actor): what the
 * prompt says about them, the notes a retry carries, and the room as they read it. The numbers come from `@perfectman/shared` (norms measured on real plays); this file is the
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
    const aimed = [p?.["addresseeIds"], p?.["mentionedAgentIds"], p?.["replyToActorId"]].flatMap((ids) => (Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : typeof ids === "string" && ids !== "" ? [ids] : []));
    out.push({ speaker: typeof name === "string" && name !== "" ? name : e.actorId, text, own: e.actorId === packet.agentId, ...(p?.["untrusted"] === true ? { untrusted: true } : {}), ...(aimed.length > 0 ? { aimedAt: aimed } : {}) });
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

/** Share of the cap above which the actor's last line is pointed out to it in the next prompt: 17 words or more for a cap of 22. */
export const LENGTH_FEEDBACK_SHARE = 0.75;

/** The prompt line that tells an actor how long its last line ran, when it ran near the top of the allowance. */
export function lengthFeedbackNote(words: number, t: LengthTarget, language: Lang): string {
  const [lo, hi] = t.aim;
  return language === "pt-BR"
    ? `Sua última fala teve ${words} palavras (de ${lo} a ${hi}, no máximo ${t.cap}). Desta vez, mais curta.`
    : `Your last line had ${words} words (${lo} to ${hi}, at most ${t.cap}). Shorter this time.`;
}

/**
 * The length feedback for this actor's decision, or undefined: its newest line of its own had more than 75% of the cap's words. The guard cuts every committed
 * line to the cap, so a line is never over it; the note reads the lines that sit at the top of the allowance, the ones a model that ignores the target writes.
 */
export function lengthFeedbackFor(ownRecentUtterances: readonly string[], t: LengthTarget, language: Lang): string | undefined {
  const last = ownRecentUtterances[ownRecentUtterances.length - 1];
  if (last === undefined) return undefined;
  const words = lengthOf(last);
  return words > Math.floor(t.cap * LENGTH_FEEDBACK_SHARE) ? lengthFeedbackNote(words, t, language) : undefined;
}

/**
 * Retry: the actor keeps starting or ending its lines with the same word or form of address, or ends them with a tag question. Names it and asks to drop it
 * for this line ("não comece com rapaz"). A form of address that is still there after the retry is taken off the line without asking again.
 */
export function ticRetryNote(tics: readonly TicHit[], language: Lang): string {
  const parts = tics.map((t) => {
    if (t.kind === "tag") {
      return language === "pt-BR" ? `termina quase toda fala com uma pergunta de confirmação ("não é?", "não pode?"). Não termine assim desta vez.` : `ends almost every line with a tag question ("right?", "isn't it?"). Do not end that way this time.`;
    }
    const term = t.term.replace(/["\n\r]+/g, " ").trim();
    return language === "pt-BR" ? `usa "${term}" no começo ou no fim de quase toda fala (${t.count} das últimas 6). Não comece com "${term}" e não termine com ele nesta fala.` : `uses "${term}" at the start or the end of almost every line (${t.count} of the last 6). Do not start with "${term}" or end with it in this line.`;
  });
  return language === "pt-BR" ? `IMPORTANTE: você ${parts.join("; você ")}` : `IMPORTANT: you ${parts.join("; you ")}`;
}

/** Retry: the line brings back a phrase or simile the room already used. Names it and asks for one new thing. */
export function motifRetryNote(motif: string, language: Lang): string {
  const m = said(motif, 60);
  return language === "pt-BR"
    ? `IMPORTANTE: a expressão "${m}" já apareceu em duas das últimas falas da sala. Não use essa expressão nem outra parecida. Traga uma coisa nova: um fato, um objeto, uma acusação ou uma decisão.`
    : `IMPORTANT: the phrase "${m}" is already in two of the room's last lines. Do not use it or a variation of it. Bring one new thing: a fact, an object, an accusation or a decision.`;
}

/** Retry: the line says nothing the room has not just heard. */
export function noveltyRetryNote(language: Lang): string {
  return language === "pt-BR"
    ? "IMPORTANTE: sua última tentativa só repete o que a sala acabou de ouvir. Traga uma coisa nova: um fato, um objeto, uma acusação ou uma decisão."
    : "IMPORTANT: your last attempt only gives the room back what it just heard. Bring one new thing: a fact, an object, an accusation or a decision.";
}

/** Retry: the actor asked while it owed an answer. */
export function owedRetryNote(q: OwedQuestion, language: Lang): string {
  const quote = said(q.text, 90);
  return language === "pt-BR"
    ? `IMPORTANTE: ${q.asker} te perguntou ("${quote}") e a sua última tentativa fez outra pergunta sem responder. Responda a ${q.asker} primeiro, numa frase; não pergunte nada nesta fala.`
    : `IMPORTANT: ${q.asker} asked you ("${quote}") and your last attempt asked something else without answering. Answer ${q.asker} first, in one sentence; ask nothing in this line.`;
}

/** Retry: the line quotes or reports words nobody said in the room's last lines. Names the claim. */
export function quoteRetryNote(issues: readonly QuoteIssue[], language: Lang): string {
  const claim = said(issues[0]?.claim ?? "", 70);
  return language === "pt-BR"
    ? `IMPORTANTE: sua última tentativa atribui a alguém algo que não foi dito nas últimas falas ("${claim}"). Cite só o que está lá, com as palavras da própria pessoa; ou não atribua nada a ninguém.`
    : `IMPORTANT: your last attempt puts words in someone's mouth that the last lines do not hold ("${claim}"). Quote only what is there, in the person's own words; or attribute nothing to anyone.`;
}

/** Retry: the line was only stage business ("Olho pra ela, sorriso atravessado."), so nothing was left to say out loud. */
export function narrationRetryNote(removed: string, language: Lang): string {
  const quote = said(removed, 80);
  return language === "pt-BR"
    ? `IMPORTANTE: sua última tentativa só descrevia o que você faz ("${quote}"). Ações e expressões vão em "body.gesture" e "body.expression", nunca em "visibleContent": ali vai só o que a pessoa diz em voz alta. Diga uma fala de verdade.`
    : `IMPORTANT: your last attempt only described what you do ("${quote}"). Actions and expressions go in "body.gesture" and "body.expression", never in "visibleContent": that holds only what the person says out loud. Say a real line.`;
}

/**
 * One note for a retry that fixes several things: the notes of every rule the attempt broke (length, motif, novelty, debt, echo, quote, ...), numbered under one heading,
 * so the model is told once and gets one more call, not one call per rule. A single note goes out as it is.
 */
export function mergeRetryNotes(notes: readonly string[], language: Lang): string {
  if (notes.length <= 1) return notes[0] ?? "";
  const bare = (n: string): string => n.replace(/^(?:IMPORTANTE|IMPORTANT):\s*/u, "");
  const head = language === "pt-BR" ? "IMPORTANTE: sua última tentativa tem mais de um problema; corrija todos de uma vez." : "IMPORTANT: your last attempt has more than one problem; fix all of them at once.";
  return [head, ...notes.map((n, i) => `${i + 1}. ${bare(n)}`)].join("\n");
}

// ---- the contract line: speech is speech --------------------------------------------------------------------------------------------

/**
 * The contract line of a run with the script checks on: "visibleContent" holds only what the person says out loud. What the person does and how they look
 * ("olho pra ela", "I smile") goes in the body block (`body.gesture`, `body.expression`) when the run has bodies; a line that narrates is cut back to its speech.
 */
export function speechOnlyLine(language: Lang, withBody: boolean): string {
  if (language === "pt-BR") {
    return withBody
      ? '"visibleContent" é só o que a pessoa diz em voz alta. Ações, olhares e expressões ("olho pra ela", um sorriso, um suspiro) vão em "body.gesture" ou "body.expression", nunca dentro de "visibleContent".'
      : '"visibleContent" é só o que a pessoa diz em voz alta: nenhuma ação, olhar ou expressão descrita ("olho pra ela", "sorrio").';
  }
  return withBody
    ? '"visibleContent" is only what the person says out loud. Actions, looks and expressions ("I look at her", a smile, a sigh) go in "body.gesture" or "body.expression", never inside "visibleContent".'
    : '"visibleContent" is only what the person says out loud: no action, look or expression described in it ("I look at her", "I smile").';
}

// ---- a move made at this actor ------------------------------------------------------------------------------------------------------

const MOVE_VERB: Record<Lang, Record<MoveKind, string>> = {
  "pt-BR": { reveal: "revelar", accusation: "acusar", threat: "ameaçar", proposal: "propor" },
  en: { reveal: "revealed", accusation: "accused", threat: "threatened", proposal: "proposed" },
};

/** The first words of a line, for a note to quote: no quotation marks or line breaks, at most 12 words. */
const firstWords = (text: string, n: number): string => text.replace(/["“”«»\n\r]+/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ");

/** In the decision of the actor the last line was a move at: react to it first (deny, admit, counter, give in), do not walk past it. */
export function answerNote(m: OwedMove, language: Lang): string {
  const quote = firstWords(m.text, 12);
  return language === "pt-BR"
    ? `${m.speaker} acabou de ${MOVE_VERB["pt-BR"][m.kind]}: "${quote}". Reaja a isso primeiro: negar, admitir, contra-atacar ou ceder. Não ignore.`
    : `${m.speaker} just ${MOVE_VERB.en[m.kind]}: "${quote}". React to that first: deny, admit, counter or give in. Do not ignore it.`;
}

/**
 * The move note for this actor's decision, or undefined: the room's last line (not this actor's, not a guest's) revealed, accused, threatened or offered
 * something. A line that names someone, or is aimed at someone (an addressee, a reply target, a name of a person in the room), gives the note to that person
 * only; a line that names nobody gives it to everyone who hears it. Never on a whisper (its own note) or when a guest's line aimed at the actor is the trigger
 * (the prompt already answers it).
 */
export function answerNoteFor(input: AgentRuntimeInput, displayName: string, language: Lang): string | undefined {
  if (whisperedBy(input)) return undefined;
  const p = input.perceptionPacket.triggeringEvent?.payload as Record<string, unknown> | undefined;
  if (p?.["untrusted"] === true && [p["addresseeIds"], p["mentionedAgentIds"]].some((ids) => Array.isArray(ids) && ids.includes(input.agentId))) return undefined;
  const m = moveBefore(spokenLines(input.perceptionPacket), nameKeysOf([displayName]), input.agentId, roomNameKeys(input, displayName));
  return m ? answerNote(m, language) : undefined;
}

// ---- silence instead of a filler -----------------------------------------------------------------------------------------------------

/**
 * `PERFECTMAN_FILLER_SILENCE=0` brings back the old fallback: a line the guard could not repair was swapped for "Ah." or "Hm." and said. Anything else leaves it
 * on: such a line becomes silence (a no-op with the output-guard motive), because a filler is a line nobody wrote, and it also closed question debts.
 */
export function fillerSilenceEnabled(): boolean {
  return process.env["PERFECTMAN_FILLER_SILENCE"] !== "0";
}

/**
 * `PERFECTMAN_FREE_TRIM=0` sends every candidate over the cap to a retry again, as before the free cut: anything else leaves the cut on, which takes a candidate that is
 * over the cap by a quarter or less down to a sentence or clause boundary without a model call.
 */
export function freeTrimEnabled(): boolean {
  return process.env["PERFECTMAN_FREE_TRIM"] !== "0";
}

/**
 * `PERFECTMAN_FREE_TRIM_RAMBLE=0` sends a candidate that ran on (over the cap by more than a quarter) to a retry again; anything else cuts it to its first sentences with no
 * model call, up to 8 times the cap, as long as the cut keeps 5 words (see `freeTrimRambleLimit`).
 */
export function freeTrimRambleEnabled(): boolean {
  return process.env["PERFECTMAN_FREE_TRIM_RAMBLE"] !== "0";
}

/**
 * `PERFECTMAN_REPAIR_FIRST=0` sends a stale line or an echo of the actor's own to a retry before any repair, as before; anything else repairs it with no model call first
 * (the clauses that say something new, `strikeEcho`) whenever the repair leaves a line the same guards accept, and retries only when it does not.
 */
export function repairFirstEnabled(): boolean {
  return process.env["PERFECTMAN_REPAIR_FIRST"] !== "0";
}

/** The no-op motive of a turn the guard silenced. It starts with the output-guard marker, so every reader that skips engine-written motives skips it. */
export function silenceMotive(why: string): string {
  return `${OUTPUT_GUARD_MARKER}: no fresh line (${why}); staying quiet.`;
}

type Expression = "neutral" | "smile" | "angry" | "sad" | "surprised" | "sleepy";

const EXPRESSION_WORDS: ReadonlyArray<[Expression, readonly string[]]> = [
  ["angry", ["raiva", "ira", "irritacao", "irritado", "irritada", "furia", "furioso", "bravo", "brava", "desprezo", "indignacao", "indignado", "angry", "anger", "rage", "furious", "irritated", "contempt", "indignant"]],
  ["sad", ["tristeza", "triste", "luto", "desanimo", "melancolia", "vergonha", "culpa", "sad", "grief", "sorrow", "shame", "guilt", "sadness"]],
  ["surprised", ["surpresa", "surpreso", "surpresa", "choque", "susto", "medo", "assombro", "surprise", "surprised", "shock", "fear", "afraid", "startled"]],
  ["smile", ["alegria", "feliz", "riso", "diversao", "divertido", "satisfacao", "alivio", "deboche", "joy", "amusement", "happy", "glee", "relief", "smug", "amused"]],
  ["sleepy", ["sono", "cansaco", "tedio", "entediado", "sleepy", "tired", "boredom", "bored", "weary"]],
];

/** The face for the strongest feeling the model named (`emotionDrivers`, strongest first), in the body block's own vocabulary; undefined when none maps to one. */
export function expressionFor(emotionDrivers: readonly string[]): Expression | undefined {
  for (const driver of emotionDrivers) {
    const words = driver.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "").split(/[^a-z]+/u);
    for (const [expression, list] of EXPRESSION_WORDS) if (words.some((w) => list.includes(w))) return expression;
  }
  return undefined;
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
