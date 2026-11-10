import type { AgentRuntimeInput, PerceptionPacket } from "@perfectman/shared";
import { tokenize } from "./echo-guard.js";
import { whisperedBy } from "./whisper-note.js";

/**
 * Scene stall (hotel drama mode): the last few things said brought nothing new, so the next actor is asked, in one
 * line, to commit to a concrete move. Deterministic and pure: it reads the lines already in the perception packet, so
 * a replayed run renders the same prompt, and a scene that is moving renders no extra text at all.
 *
 * Stalled means: at least 4 room lines are in view with 3 or more before them, the newest 4 hold no line from a person,
 * nothing near the actor moved or gestured, and those 4 lines hold at most {@link MAX_NEW_ANCHORS} numbers, names or
 * topic words that the 8 lines before them did not already have.
 */

/** Newest room lines judged. */
export const STALL_WINDOW = 4;
/** Lines before the window that say what is already known. */
export const STALL_HISTORY = 8;
/** History needed before a scene can be called stalled: a scene's first lines are all new. */
export const STALL_MIN_HISTORY = 3;
/** New anchors the window may bring and still count as stalled. */
export const MAX_NEW_ANCHORS = 2;

type Lang = "pt-BR" | "en";

const FILLER = new Set(
  ("para pra porque porem entao tambem ainda sempre nunca todo toda todos todas outro outra outros outras mesmo mesma coisa coisas gente cara tipo agora aqui ali alem " +
    "assim muito muita muitos pouco pouca tudo nada algo alguem ninguem qualquer vamos bora vem olha olhe claro verdade isso isto esse essa esses essas este esta aquele aquela " +
    "pode posso podia quero quer queria fazer faz fazendo disse falou fala diz acho acha sabe sei saber ver vai vou vamos estou esta estao foi era ser sao tem tinha " +
    "from with that this have what your about just like they them then than there were been would could should").split(" "),
);

type RoomLine = { text: string; person: boolean };

/** The spoken room lines in view, oldest first: public speech only, the line that woke the actor last. */
function roomLines(packet: Pick<PerceptionPacket, "triggeringEvent" | "visibleContextEvents">): RoomLine[] {
  const seen = new Set<string>();
  const out: RoomLine[] = [];
  for (const e of [...packet.visibleContextEvents, ...(packet.triggeringEvent ? [packet.triggeringEvent] : [])]) {
    if (e.type !== "message_sent" && e.type !== "reply_sent") continue;
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    const p = e.payload as Record<string, unknown> | undefined;
    const text = p?.["content"];
    if (typeof text !== "string" || text.trim() === "") continue;
    if (p?.["mode"] === "whisper" || p?.["channelType"] === "private_channel" || e.visibility.visibilityReason.includes("private")) continue;
    out.push({ text, person: p?.["untrusted"] === true });
  }
  return out;
}

/** Numbers, names said mid-sentence and topic words of a line, as comparable keys. */
function anchors(text: string): Set<string> {
  const out = new Set<string>();
  for (const n of text.match(/\d+(?:[.,]\d+)?/g) ?? []) out.add(`#${n}`);
  const toks = tokenize(text);
  toks.forEach((t, i) => {
    if (/^\p{Lu}\p{Ll}{2,}/u.test(t.raw) && i > 0) out.add(`n:${t.key}`);
    if (t.key.length >= 4 && !FILLER.has(t.key) && !/^\d+$/.test(t.key)) out.add(t.key);
  });
  return out;
}

const memo = new WeakMap<object, boolean>();

/** True when the room's last lines went over the same ground and nobody moved. */
export function sceneStalled(packet: Pick<PerceptionPacket, "triggeringEvent" | "visibleContextEvents" | "body">): boolean {
  const cached = memo.get(packet);
  if (cached !== undefined) return cached;
  const verdict = judge(packet);
  memo.set(packet, verdict);
  return verdict;
}

function judge(packet: Pick<PerceptionPacket, "triggeringEvent" | "visibleContextEvents" | "body">): boolean {
  if (packet.body?.changes && packet.body.changes.length > 0) return false;
  const lines = roomLines(packet);
  if (lines.length < STALL_WINDOW + STALL_MIN_HISTORY) return false;
  const recent = lines.slice(-STALL_WINDOW);
  if (recent.some((l) => l.person)) return false;
  const known = new Set<string>();
  for (const l of lines.slice(-(STALL_WINDOW + STALL_HISTORY), -STALL_WINDOW)) for (const a of anchors(l.text)) known.add(a);
  const fresh = new Set<string>();
  for (const l of recent) for (const a of anchors(l.text)) if (!known.has(a)) fresh.add(a);
  return fresh.size <= MAX_NEW_ANCHORS;
}

/** One line for the decision moment of a stalled scene. */
export function stallNote(lang: Lang): string {
  return lang === "pt-BR"
    ? "A cena travou: nas últimas falas ninguém trouxe um nome, um número ou um objeto novo, e ninguém se mexeu. Faça uma jogada concreta agora: revele algo, acuse alguém, recuse dando um motivo, vá embora ou toque em alguém ou em alguma coisa. Não repita o assunto."
    : "The scene has stalled: the last lines brought no new name, number or object and nobody moved. Make one concrete move now: reveal something, accuse someone, refuse and say why, leave, or touch someone or something. Do not go over the same ground again.";
}

/** The person's own line is the one to answer, so a stall never adds a lean to it. */
function askedNow(input: AgentRuntimeInput): boolean {
  const p = input.perceptionPacket.triggeringEvent?.payload as Record<string, unknown> | undefined;
  if (!p || p["untrusted"] !== true) return false;
  return [p["addresseeIds"], p["mentionedAgentIds"]].some((ids) => Array.isArray(ids) && ids.includes(input.agentId));
}

/**
 * The nudge to add to this actor's decision, or undefined. Drama hotel runs only (the prompt that teaches `act` and
 * the verbs the note names); never on a whisper or a line a person aimed at the actor.
 */
export function stallNoteFor(input: AgentRuntimeInput, lang: Lang): string | undefined {
  const packet = input.perceptionPacket;
  if (packet.body?.drama !== true) return undefined;
  if (whisperedBy(input) || askedNow(input)) return undefined;
  return sceneStalled(packet) ? stallNote(lang) : undefined;
}
