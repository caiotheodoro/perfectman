import type {
  AgentRuntimeInput,
  LLMUsage,
  OperatorEvent,
  TargetResolutionFlooredData,
} from "@perfectman/shared";
import type {
  AgentRuntimeContext,
  AgentRuntimeOutput,
  BuiltPrompt,
  PromptTrim,
} from "../agent-runtime.types.js";
import type { LLMConfig } from "../../llm/llm-config.js";
import type { LLMProvider } from "../../llm/llm-provider.js";
import { llmBudget } from "../../llm/llm-budget.js";
import { IntentParser, type TargetResolutionContext } from "../intent-parser.js";
import {
  DEFAULT_REPETITION_MAX_RETRIES,
  isNearRepeat,
  isRoomCopy,
  normalizeWords,
  similarity,
  REPETITION_GUARD_MARKER,
  REPETITION_SIMILARITY_THRESHOLD,
  roomLinesHeard,
  type GuardInfo,
  type GuardKind,
} from "../repetition-guard.js";
import { OUTPUT_GUARD_MARKER, SCRIPT_NORMS, answersFirst, falseQuotes, lengthOf, lowNovelty, motifRepeat, noveltyFloor, splitAfter, stripNarration, trimToCap, withoutFalseQuotes, withoutQuestions } from "@perfectman/shared";
import type { OwedLine } from "@perfectman/shared";
import { findGarble, findOwnEcho, findPhraseLoop, findRoomEcho, type GarbleHit, type LoopHit } from "../echo-guard.js";
import {
  answerNoteFor,
  expressionFor,
  fillerSilenceEnabled,
  lengthRetryNote,
  mergeRetryNotes,
  motifRetryNote,
  narrationRetryNote,
  noveltyRetryNote,
  owedFor,
  owedNoteFor,
  owedRetryNote,
  quoteRetryNote,
  reactionFor,
  roomNameKeys,
  scriptLang,
  silenceMotive,
  spokenLines,
  lengthTargetOf,
} from "../script-guard.js";
import { whisperedBy } from "../whisper-note.js";
import { answerWhisper } from "../../simulation/whisper-reply.js";
import { promptVersionHash } from "../prompt-version.js";
import { ActionIntentPromptBuilder } from "../action-intent-prompt-builder.js";
import { PromptBuilder } from "../prompt-builder.js";
import { EXAMPLE_MOTIVES } from "../hotel-body-hint.js";
import {
  LLMStep,
  purposeToCallType,
  StepOutcome,
  StepRunContext,
} from "./llm-step.js";

/** The trigger is a guest's line, aimed at this agent: somebody is waiting for its answer (hotel mode). */
function askedByPerson(input: AgentRuntimeInput, agentId: string): boolean {
  const trigger = input.perceptionPacket.triggeringEvent;
  const p = trigger?.payload as Record<string, unknown> | undefined;
  if (!p || p["untrusted"] !== true) return false;
  const aimed = [p["addresseeIds"], p["mentionedAgentIds"]].some((ids) => Array.isArray(ids) && ids.includes(agentId));
  return aimed;
}

type RetryKind = "none" | "repeat_failed" | "parse_failed" | "provider_failed";

/** Everything written in the actor's view (lines and speakers' names): letters in it are the room's own, not corruption. */
function visibleText(packet: AgentRuntimeInput["perceptionPacket"]): string[] {
  const out: string[] = [];
  for (const e of [...packet.visibleContextEvents, ...(packet.triggeringEvent ? [packet.triggeringEvent] : [])]) {
    const p = e.payload as Record<string, unknown> | undefined;
    for (const key of ["content", "senderName"]) if (typeof p?.[key] === "string") out.push(p[key] as string);
  }
  return out;
}

/** A counter hook must never break a turn. */
function notify(hook: ((kind: GuardKind, info?: GuardInfo) => void) | undefined, kind: GuardKind, info?: GuardInfo): void {
  try {
    hook?.(kind, info);
  } catch {
    // counters are best effort
  }
}

/** What a guard did, for the run's guard log: the actor, the text it was given and the text it left (either may be absent). */
function guardInfo(actor: string, before?: string, after?: string): GuardInfo {
  return { actor, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) };
}

/**
 * The retry note when a person asked this actor something and its answer could not be used (the output was invalid
 * and the engine would otherwise fall back to a no-op, so the person hears nothing). Names what was wrong, in the
 * profile's language, and asks for the answer in words.
 */
export function answerOwedNote(problem: string, language: "pt-BR" | "en"): string {
  const what = problem.replace(/\s+/g, " ").trim().slice(0, 140);
  if (language === "pt-BR") {
    return `IMPORTANTE: sua última tentativa nesta rodada não pôde ser usada (${what}). Alguém acabou de falar com você e espera uma resposta: responda a essa pessoa em palavras, com "intentType" "reply_to_message" ou "send_message" e "visibleContent" preenchido, sem escolher outra pessoa como alvo.`;
  }
  return `IMPORTANT: your last attempt this turn could not be used (${what}). Someone just spoke to you and is waiting: answer that person in words, with "intentType" "reply_to_message" or "send_message" and "visibleContent" filled in, without choosing anyone else as the target.`;
}

/** The retry note when the answer to a person who asked was aimed at somebody else. */
export function aimedElsewhereNote(lastAttempt: string, language: "pt-BR" | "en"): string {
  if (language === "pt-BR") {
    return `IMPORTANTE: sua última tentativa nesta rodada ("${lastAttempt}") foi dirigida a outra pessoa. Quem acabou de falar com você espera a resposta: responda a ela, falando só com ela, sem se dirigir a mais ninguém.`;
  }
  return `IMPORTANT: your last attempt this turn ("${lastAttempt}") was aimed at somebody else. The person who just spoke to you is waiting: answer them, talking only to them, without turning to anyone else.`;
}

/**
 * The repetition note when a person is waiting on the answer: the novelty goes into the wording and the answer
 * stays aimed at them. The generic note sends the model to "another angle" or "someone else", which for a person
 * who just asked is how a whisper got a line meant for the room.
 */
function askedRetryNote(lastAttempt: string, language: "pt-BR" | "en"): string {
  if (language === "pt-BR") {
    return `IMPORTANTE: sua última tentativa nesta rodada ("${lastAttempt}") repete algo que você já disse. Alguém acabou de falar com você e espera uma resposta: responda ao que essa pessoa disse, com outras palavras, falando só com ela. Não use "no_op" e não fale com o resto da sala.`;
  }
  return `IMPORTANT: your last attempt this turn ("${lastAttempt}") repeats something you already said. Someone just spoke to you and is waiting: answer what that person said, in new words, talking only to them. Do not choose "no_op" and do not talk to the rest of the room.`;
}

/**
 * Correction appended to the system prompt on each repetition retry. The
 * retry prompt version hash covers this text, so a reworded note yields a
 * new prompt version; the block motive keeps its own "Repetition guard"
 * prefix (repetition-guard.ts) that the offline sweeps match on.
 */
export function retryCorrectionNote(lastAttempt: string, language: "pt-BR" | "en", askedBy = false, copiedFrom: "own" | "room" | "thought" = "own"): string {
  if (askedBy) return askedRetryNote(lastAttempt, language);
  if (copiedFrom === "thought") {
    if (language === "pt-BR") {
      return `IMPORTANTE: sua última tentativa nesta rodada ("${lastAttempt}") é o seu pensamento privado dito em voz alta. "visibleContent" é só o que você fala para as pessoas; o pensamento fica em "privateMotiveSummary". Diga uma frase de verdade, ou escolha "no_op".`;
    }
    return `IMPORTANT: your last attempt this turn ("${lastAttempt}") is your private thought said out loud. "visibleContent" is only what you say to people; the thought goes in "privateMotiveSummary". Say a real sentence, or choose "no_op".`;
  }
  if (copiedFrom === "room") {
    if (language === "pt-BR") {
      return `IMPORTANTE: sua última tentativa nesta rodada ("${lastAttempt}") repete o que outra pessoa da sala acabou de dizer. Fale com as suas palavras, do seu jeito, sobre o que só você diria agora; ou escolha "no_op" de propósito.`;
    }
    return `IMPORTANT: your last attempt this turn ("${lastAttempt}") repeats what someone else in the room just said. Say it in your own words, about what only you would say right now; or choose "no_op" on purpose.`;
  }
  // In the profile's language: this is appended to the system prompt as its
  // newest instruction, and in English it pulled pt-BR characters into
  // English on exactly the turns that retried.
  if (language === "pt-BR") {
    return `IMPORTANTE: sua última tentativa nesta rodada ("${lastAttempt}") ficou parecida demais com algo que você já disse. Diga algo genuinamente diferente — outro ângulo, uma reação a outra pessoa, uma mudança de assunto — sem deixar de ser fiel ao que você realmente quer agora; não invente novidade que seu motivo e seu estado emocional atuais não justifiquem. Ou escolha "no_op" de propósito — deixar o ponto sem resposta é uma jogada, se for a jogada que essa pessoa faria.`;
  }
  return `IMPORTANT: your last attempt this turn ("${lastAttempt}") was too close to something you already said. Say something genuinely different — a new angle, a reaction to someone else, a topic change — while staying true to what you actually want right now; do not invent novelty that your current motive and emotional state wouldn't justify. Or choose "no_op" on purpose — letting the point stand unanswered is a move, if it is the move this person would make.`;
}

/** A quoted piece of the actor's own text for a note: one line, no quotes of its own, short. */
const quoted = (text: string, max: number): string => text.replace(/["\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The retry note for a signature phrase or question the actor keeps coming back to (echo-guard.ts `findPhraseLoop`):
 * names the phrase, bans it and its variations, and asks for new information or a decision instead. When a person is
 * waiting the answer stays aimed at them and is not offered a silence.
 */
export function loopRetryNote(phrase: string, language: "pt-BR" | "en", askedBy = false): string {
  const said = quoted(phrase, 80);
  if (language === "pt-BR") {
    return askedBy
      ? `IMPORTANTE: você já usou "${said}" em várias das suas últimas falas. Alguém acabou de falar com você e espera uma resposta: responda ao que essa pessoa disse, sem essa frase nem uma variação dela, com algo que ainda não foi dito. Não fale com o resto da sala.`
      : `IMPORTANTE: você já usou "${said}" em várias das suas últimas falas. Não use essa frase, nem a mesma pergunta, nem uma variação dela. Traga uma informação nova ou tome uma decisão agora: diga algo concreto que ainda não foi dito, ou mexa na cena (acusar, revelar, recusar dando um motivo, sair).`;
  }
  return askedBy
    ? `IMPORTANT: you already used "${said}" in several of your last lines. Someone just spoke to you and is waiting: answer what that person said, without that phrase or a variation of it, with something not said yet. Do not talk to the rest of the room.`
    : `IMPORTANT: you already used "${said}" in several of your last lines. Do not use that phrase, the same question or a variation of it. Bring new information or make a decision now: say something concrete that was not said yet, or move the scene (accuse, reveal, refuse and say why, leave).`;
}

/** The retry note for corrupt text in the line (echo-guard.ts `findGarble`): rewrite it in plain words. */
export function garbleRetryNote(token: string, language: "pt-BR" | "en"): string {
  const bad = quoted(token, 40);
  if (language === "pt-BR") {
    return `IMPORTANTE: sua última tentativa nesta rodada tinha texto corrompido ("${bad}"). Escreva a fala de novo em português normal, só com palavras inteiras, separadas por espaço.`;
  }
  return `IMPORTANT: your last attempt this turn had corrupted text ("${bad}"). Write the line again in plain, normal words, whole words separated by spaces.`;
}

/**
 * Correction appended to the system prompt on the single reply/react target
 * retry: names the unresolvable handle, lists the valid handle set for this
 * render, and offers the send_message escape hatch. The retry prompt version
 * hash covers this text.
 */
export function targetRetryCorrectionNote(
  field: string,
  badHandle: string,
  validHandles: string[],
  language: "pt-BR" | "en",
): string {
  if (language === "pt-BR") {
    const valid = validHandles.length > 0 ? validHandles.join(", ") : "(nenhum identificador de evento disponível nesta rodada)";
    return `IMPORTANTE: você colocou "${field}" como "${badHandle || "(vazio)"}", que não é um dos identificadores de evento mostrados em <events>. Os únicos identificadores válidos nesta rodada são: ${valid}. Ou coloque em "${field}" exatamente um desses identificadores, ou — se isso não era de fato uma resposta/reação a uma mensagem específica — use "intentType" "send_message" e omita "${field}".`;
  }
  const valid = validHandles.length > 0 ? validHandles.join(", ") : "(no event handles are available this turn)";
  return `IMPORTANT: you set "${field}" to "${badHandle || "(empty)"}", which is not one of the event handles shown in <events>. The only valid handles this turn are: ${valid}. Either set "${field}" to exactly one of those handles, or — if this was not actually a reply/reaction to one specific message — set "intentType" to "send_message" and omit "${field}".`;
}

/**
 * The `action_intent` LLM surface as a typed step. This is the canonical
 * implementation of the project's "engine owns structure, model owns language"
 * rule for the one active production surface: the provider call, strict parse,
 * the single bounded retry arm (repetition guard + target resolution) and
 * controlled fallback all live here as an explicit, closed outcome instead of
 * ad-hoc branches in the runtime.
 */
export class ActionIntentStep implements LLMStep<AgentRuntimeInput, AgentRuntimeOutput> {
  readonly purpose = "action_intent" as const;
  readonly label = "action_intent";

  render(input: AgentRuntimeInput, ctx: StepRunContext): BuiltPrompt {
    // Route through the dispatcher so unused prompt purposes still fail
    // closed (see prompt-builder.ts) and the render entry stays singular.
    const built = PromptBuilder.build(input, ctx.profile, "action_intent", ctx.llmConfig.maxInputTokens, ctx.llmConfig.promptStyle);
    if (built.stallNudged) notify(ctx.repetitionPolicy?.onGuard, "stall_nudge");
    const actor = ctx.profile.displayName ?? input.agentId;
    if (built.owedNoted) notify(ctx.repetitionPolicy?.onGuard, "debt_note", guardInfo(actor, undefined, owedNoteFor(input, ctx.profile.displayName, ctx.profile.language)));
    if (built.answerNoted) notify(ctx.repetitionPolicy?.onGuard, "answer_note", guardInfo(actor, undefined, answerNoteFor(input, ctx.profile.displayName, ctx.profile.language)));
    return built;
  }

  gate(input: AgentRuntimeInput, ctx: StepRunContext): StepOutcome<AgentRuntimeOutput> | undefined {
    if (!ctx.prompt) return undefined;
    const startTime = Date.now();
    const budgetDecision = llmBudget.canCall({
      simulationId: input.simulationId,
      agentId: input.agentId,
      priority: input.budgetPriority,
      inputTokensEstimate: ctx.prompt.inputTokensEstimate,
    });
    if (budgetDecision.allowed) return undefined;

    const fallbackIntent = IntentParser.createFallback(
      input.agentId,
      "no_op",
      `LLM budget exceeded: ${budgetDecision.reason || "unknown reason"}`,
    );
    const opEvent: OperatorEvent = {
      type: "llm_budget_exceeded",
      simulationId: input.simulationId,
      agentId: input.agentId,
      pulseIndex: ctx.pulseIndex,
      detail: `LLM budget pre-check blocked call for agent ${input.agentId}: ${budgetDecision.reason}`,
      createdAt: Date.now(),
    };
    // A trim runs in render(), before this gate. When the gate blocks, execute()
    // never runs, so this is the only place the trim that already happened can
    // be logged on the blocked path.
    const trimEvent = this.promptTrimEvent(
      ctx.prompt,
      input.simulationId,
      input.agentId,
      ctx.pulseIndex,
      ctx.now,
    );
    return {
      ok: false,
      gateBlocked: true,
      fallback: {
        intent: fallbackIntent,
        llmUsage: null,
        latencyMs: Date.now() - startTime,
        fallbackApplied: true,
        operatorEvents: trimEvent ? [trimEvent, opEvent] : [opEvent],
      },
    };
  }

  async execute(
    input: AgentRuntimeInput,
    ctx: StepRunContext,
  ): Promise<StepOutcome<AgentRuntimeOutput>> {
    if (!ctx.prompt) throw new Error("ActionIntentStep.execute requires a rendered prompt (run render first)");
    const { provider, llmConfig, prompt } = ctx;
    const runtimeContext: AgentRuntimeContext = { pulseIndex: ctx.pulseIndex, now: ctx.now };
    const { agentId, simulationId } = input;
    const startTime = Date.now();

    const trimEvent = this.promptTrimEvent(prompt, simulationId, agentId, ctx.pulseIndex, ctx.now);

    let providerResult;
    try {
      providerResult = await provider.generateIntent(input, runtimeContext, prompt);
    } catch (error: any) {
      const fallbackReason = `Provider failed: ${error.message || String(error)}`;
      const fallbackIntent = IntentParser.createFallback(agentId, "no_op", fallbackReason);
      const opEvent: OperatorEvent = {
        type: "llm_failure",
        simulationId,
        agentId,
        pulseIndex: ctx.pulseIndex,
        detail: `LLM provider execution failed for agent ${agentId}: ${error.message || String(error)}`,
        createdAt: Date.now(),
      };
      return {
        ok: false,
        fallback: {
          intent: fallbackIntent,
          llmUsage: null,
          latencyMs: Date.now() - startTime,
          fallbackApplied: true,
          providerFailed: true,
          operatorEvents: trimEvent ? [trimEvent, opEvent] : [opEvent],
        },
        errorDetail: `Provider failed: ${error.message || String(error)}`,
      };
    }

    const targetContext: TargetResolutionContext = {
      eventHandles: input.perceptionPacket.eventHandles,
      events: [
        ...(input.perceptionPacket.triggeringEvent ? [input.perceptionPacket.triggeringEvent] : []),
        ...input.perceptionPacket.visibleContextEvents,
      ],
      triggeringEventId: input.perceptionPacket.triggeringEvent?.id,
      ...(input.perceptionPacket.bodyHandles ? { bodyHandles: input.perceptionPacket.bodyHandles } : {}),
    };

    let parseResult = IntentParser.parse(providerResult.content, agentId, input.availableActions, "no_op", targetContext);

    // Single bounded retry arm for the two structural guard violations — a
    // near-duplicate message and an unresolvable reply/react target. The
    // prompt already instructs the model on both, but empirically small local
    // models violate them anyway; the re-prompt names every currently
    // violated constraint (default: one retry, budget permitting), and the
    // latest attempt is then judged structurally: repetition block first,
    // then the target floor. A failed retry is reported as an llm_failure,
    // not as a repetition block.
    const policy = ctx.repetitionPolicy ?? {};
    const threshold = Math.min(1, Math.max(0, policy.threshold ?? REPETITION_SIMILARITY_THRESHOLD));
    const ambient = !input.perceptionPacket.triggeringEvent;
    const maxRetries = Math.max(
      0,
      Math.floor(ambient && policy.ambientMaxRetries !== undefined ? Math.min(policy.ambientMaxRetries, policy.maxRetries ?? DEFAULT_REPETITION_MAX_RETRIES) : (policy.maxRetries ?? DEFAULT_REPETITION_MAX_RETRIES)),
    );
    const roomThreshold = policy.roomThreshold === undefined ? undefined : Math.min(1, Math.max(0, policy.roomThreshold));
    // Hotel mode (RepetitionPolicy.strict): also compare word sequences, name a signature phrase, and refuse corrupt text.
    const strict = policy.strict === true;
    const roomLines = roomThreshold === undefined && !strict ? [] : roomLinesHeard(input.perceptionPacket);
    const ownLines = input.perceptionPacket.ownRecentUtterances;
    const seenText = strict ? visibleText(input.perceptionPacket) : [];

    let intent = parseResult.intent;
    let fallbackApplied = parseResult.fallbackApplied;
    let repetitionBlocked = false;
    let lastRepeatWasOwn = true;
    let lastBlockedLoop: LoopHit | undefined;
    let garbleDropped: GarbleHit | undefined;
    let garbleRetried = false;
    let retryKind: RetryKind = "none";
    let retriesAttempted = 0;

    // The script checks (hotel runs, `policy.script`): a line over its word cap, a line that says nothing new or brings back a phrase or
    // simile the room already carries, and a line that asks while its speaker owes an answer. Each is retried once, then repaired below.
    const script = policy.script === true;
    const lang = ctx.profile.language;
    const target = script ? (ctx.profile.scriptPrompt?.length ?? lengthTargetOf(ctx.profile.messageLength, lang)) : undefined;
    const spoken = script ? spokenLines(input.perceptionPacket) : [];
    const roomNamesSet = script ? roomNameKeys(input, ctx.profile.displayName ?? "") : new Set<string>();
    const noveltyFloorValue = script ? noveltyFloor(SCRIPT_NORMS, scriptLang(lang)) : 0;
    const owedQuestionNow = script && !askedByPerson(input, agentId) && !whisperedBy(input) ? owedFor(input, ctx.profile.displayName ?? "") : undefined;
    // A line the guard cannot repair is silence, not a filler said in its place (`PERFECTMAN_FILLER_SILENCE=0` brings the filler back).
    const fillerSilence = script && fillerSilenceEnabled();
    const actor = ctx.profile.displayName ?? agentId;
    const tell = (kind: GuardKind, before?: string, after?: string): void => notify(policy.onGuard, kind, guardInfo(actor, before, after));
    // Novelty reads the actor's own last 3 lines and the turn before: own lines older than the events in view come from the packet's own-utterance list.
    const inViewOwn = new Set(spoken.filter((l) => l.own).map((l) => l.text));
    const noveltyRoom: OwedLine[] = script ? [...input.perceptionPacket.ownRecentUtterances.filter((t) => !inViewOwn.has(t)).slice(-3).map((text) => ({ speaker: ctx.profile.displayName ?? agentId, text, own: true })), ...spoken] : [];
    const noveltyOf = (text: string) => lowNovelty(text, noveltyRoom, noveltyFloorValue, { names: roomNamesSet });
    let lengthRetried = false;
    let motifRetried = false;
    let debtRetried = false;
    let quoteRetried = false;
    let narrationRetried = false;
    let totalInputTokens = providerResult.usage.inputTokens;
    let totalOutputTokens = providerResult.usage.outputTokens;
    const mainInputTokens = providerResult.usage.inputTokens;
    const mainOutputTokens = providerResult.usage.outputTokens;
    const retryUsages: { inputTokens: number; outputTokens: number; latencyMs: number; promptVersion: string }[] = [];
    const retryTrimEvents: OperatorEvent[] = [];
    const retryRecoveryEvents: OperatorEvent[] = [];

    const speaks = (candidateIntent: typeof intent): boolean =>
      (candidateIntent.intentType === "send_message" || candidateIntent.intentType === "reply_to_message") &&
      !!candidateIntent.visibleContent;
    // Each check runs once per candidate: the retry arm asks the same questions of the same intent several times.
    const once = <T,>(check: (candidateIntent: typeof intent) => T): ((candidateIntent: typeof intent) => T) => {
      const seen = new WeakMap<object, T>();
      return (candidateIntent) => {
        if (!seen.has(candidateIntent)) seen.set(candidateIntent, check(candidateIntent));
        return seen.get(candidateIntent) as T;
      };
    };
    // Narration in speech: the sentences of a candidate that only say what the actor does ("Olho pra ela, sorriso atravessado.") are taken out before any
    // check reads it, so length, novelty and echo are judged on what the person says out loud. A candidate with nothing else is speechless (`narrationOnly`).
    const narrationOnly = new Map<object, string>();
    const withoutNarration = (parsed: typeof parseResult): typeof parseResult => {
      if (!script || parsed.fallbackApplied || !speaks(parsed.intent)) return parsed;
      const before = parsed.intent.visibleContent!;
      const out = stripNarration(before);
      if (out.removed.length === 0) return parsed;
      tell("narration_stripped", before, out.text);
      if (out.text !== "") return { ...parsed, intent: { ...parsed.intent, visibleContent: out.text } };
      const { visibleContent: _gone, ...speechless } = parsed.intent;
      narrationOnly.set(speechless, before);
      return { ...parsed, intent: speechless as typeof parsed.intent };
    };
    parseResult = withoutNarration(parseResult);
    intent = parseResult.intent;
    const isOwnRepeat = once((candidateIntent: typeof intent): boolean =>
      speaks(candidateIntent) &&
      (isNearRepeat(candidateIntent.visibleContent!, ownLines, threshold) || (strict && findOwnEcho(candidateIntent.visibleContent!, ownLines) !== undefined)));
    const isRoomRepeat = once((candidateIntent: typeof intent): boolean =>
      speaks(candidateIntent) &&
      ((roomThreshold !== undefined && isRoomCopy(candidateIntent.visibleContent!, roomLines, roomThreshold)) ||
        (strict && findRoomEcho(candidateIntent.visibleContent!, roomLines) !== undefined)));
    const loopOf = once((candidateIntent: typeof intent): LoopHit | undefined =>
      strict && speaks(candidateIntent) ? findPhraseLoop(candidateIntent.visibleContent!, ownLines) : undefined);
    const garbleOf = once((candidateIntent: typeof intent): GarbleHit | undefined =>
      strict && speaks(candidateIntent) ? findGarble(candidateIntent.visibleContent!, seenText) : undefined);
    // Hotel only (it rides on the room threshold): a line that is the actor's own private thought spoken out loud.
    const isThoughtSpoken = (candidateIntent: typeof intent): boolean =>
      roomThreshold !== undefined &&
      speaks(candidateIntent) &&
      ((normalizeWords(candidateIntent.privateMotiveSummary ?? "").length >= 3 &&
        similarity(candidateIntent.visibleContent!, candidateIntent.privateMotiveSummary ?? "") >= 0.6) ||
        EXAMPLE_MOTIVES.some((m) => similarity(candidateIntent.visibleContent!, m) >= 0.7));
    const isRepeat = (candidateIntent: typeof intent): boolean => isOwnRepeat(candidateIntent) || isRoomRepeat(candidateIntent) || isThoughtSpoken(candidateIntent);
    const tooLongOf = once((candidateIntent: typeof intent): { words: number; cap: number } | undefined => {
      if (!target || !speaks(candidateIntent)) return undefined;
      const words = lengthOf(candidateIntent.visibleContent!);
      return words > target.cap ? { words, cap: target.cap } : undefined;
    });
    const motifOf = once((candidateIntent: typeof intent) => (script && speaks(candidateIntent) ? motifRepeat(candidateIntent.visibleContent!, spoken, roomNamesSet) : undefined));
    const staleOf = once((candidateIntent: typeof intent) => (script && speaks(candidateIntent) ? noveltyOf(candidateIntent.visibleContent!) : undefined));
    // A quotation or a claim ("ela te chamou de burro") that the room's last 10 lines do not hold.
    const quotesOf = once((candidateIntent: typeof intent) => (script && speaks(candidateIntent) ? falseQuotes(candidateIntent.visibleContent!, spoken as OwedLine[]) : []));
    const dodgesOf = once((candidateIntent: typeof intent): boolean => owedQuestionNow !== undefined && speaks(candidateIntent) && !answersFirst(candidateIntent.visibleContent!));
    // What would still earn a retry: each script check gets one, so a line that stays long after its retry is cut, not retried again.
    const scriptBlocking = (candidateIntent: typeof intent): boolean =>
      script &&
      ((tooLongOf(candidateIntent) !== undefined && !lengthRetried) ||
        ((motifOf(candidateIntent) !== undefined || staleOf(candidateIntent) !== undefined) && !motifRetried) ||
        (dodgesOf(candidateIntent) && !debtRetried) ||
        (quotesOf(candidateIntent).length > 0 && !quoteRetried) ||
        (narrationOnly.has(candidateIntent) && !narrationRetried));
    // A line the guards refuse: a repeat, a signature phrase the actor keeps coming back to, or corrupt text.
    const isBad = (candidateIntent: typeof intent): boolean => isRepeat(candidateIntent) || loopOf(candidateIntent) !== undefined || garbleOf(candidateIntent) !== undefined;
    // One count per flagged candidate, by what it is first: corrupt, an echo of the actor, of the room, a signature phrase.
    const tally = (candidateIntent: typeof intent): void => {
      if (!policy.onGuard) return;
      const said = candidateIntent.visibleContent;
      if (garbleOf(candidateIntent)) tell("garble", said);
      else if (isOwnRepeat(candidateIntent)) tell("repeat_own", said);
      else if (isRoomRepeat(candidateIntent)) tell("repeat_room", said);
      else if (loopOf(candidateIntent)) tell("phrase_loop", said);
    };
    if (!fallbackApplied) tally(intent);

    // A person asked this actor something. An invalid output (which would fall back to a no-op) or an answer aimed at
    // somebody else leaves them without one, so both get the retry arm too.
    const asked = askedByPerson(input, agentId);
    const aimedElsewhere = (candidateIntent: typeof intent): boolean =>
      asked &&
      speaks(candidateIntent) &&
      (candidateIntent.intentType === "reply_to_message"
        ? candidateIntent.replyToEventId !== undefined && candidateIntent.replyToEventId !== input.perceptionPacket.triggeringEvent?.id
        : candidateIntent.personTargets.length > 0);
    const unusable = fallbackApplied && asked;

    if (unusable || (!fallbackApplied && (isBad(intent) || parseResult.unresolvedTarget || aimedElsewhere(intent) || scriptBlocking(intent)))) {
      // What the *first* attempt got wrong. A retry that fixes it clears every
      // in-band signal (`fallbackApplied` goes back to false, no llm_failure is
      // pushed), so without capturing it here the failed attempt vanishes and
      // the offline counters report a clean run.
      const firstAttemptViolations = [
        isRepeat(intent) ? "near_duplicate" : null,
        loopOf(intent) ? "phrase_loop" : null,
        garbleOf(intent) ? "garbled_text" : null,
        parseResult.unresolvedTarget ? "unresolved_target" : null,
        !unusable && tooLongOf(intent) ? "too_long" : null,
        !unusable && motifOf(intent) ? "motif_repeat" : null,
        !unusable && !motifOf(intent) && staleOf(intent) ? "low_novelty" : null,
        !unusable && dodgesOf(intent) ? "owed_answer" : null,
        !unusable && quotesOf(intent).length > 0 ? "false_quote" : null,
        !unusable && narrationOnly.has(intent) ? "narration_only" : null,
        unusable ? "unusable_answer" : null,
        !unusable && aimedElsewhere(intent) ? "aimed_elsewhere" : null,
      ].filter((v): v is string => v !== null);
      const unusableWhy = parseResult.errorDetail ?? "invalid answer";

      for (let attempt = 0; attempt < maxRetries; attempt++) {
        // The correction notes re-inflate the (already-capped) base prompt, so
        // the retry prompt is re-assembled and re-trimmed against the same cap
        // before it goes anywhere near the wire; the trim event and the budget
        // gate below therefore see the corrected, final estimate.
        // Corrupt text gets one retry and no more: a second corrupt answer is dropped below.
        if (garbleOf(intent) !== undefined) {
          if (garbleRetried) break;
          garbleRetried = true;
        }
        // One retry per turn, whatever the rules the first attempt broke (they are all in its one note): what is still wrong is repaired below, not asked for again.
        if (script && attempt > 0) break;
        const corrections: string[] = [];
        const garbled = garbleOf(intent);
        if (garbled) corrections.push(garbleRetryNote(garbled.token, ctx.profile.language));
        const looped = loopOf(intent);
        if (isRepeat(intent) && !(looped && asked)) {
          corrections.push(retryCorrectionNote(intent.visibleContent ?? "", ctx.profile.language, askedByPerson(input, agentId), isOwnRepeat(intent) ? "own" : isRoomRepeat(intent) ? "room" : "thought"));
        }
        if (looped) corrections.push(loopRetryNote(looped.phrase, ctx.profile.language, asked));
        if (unusable && fallbackApplied) corrections.push(answerOwedNote(unusableWhy, ctx.profile.language));
        else if (!fallbackApplied && aimedElsewhere(intent) && !isRepeat(intent)) corrections.push(aimedElsewhereNote(intent.visibleContent ?? "", ctx.profile.language));
        if (parseResult.unresolvedTarget) {
          corrections.push(
            targetRetryCorrectionNote(
              parseResult.unresolvedTarget.field,
              parseResult.unresolvedTarget.badHandle,
              parseResult.unresolvedTarget.validHandles,
              ctx.profile.language,
            ),
          );
        }
        if (!fallbackApplied) {
          const long = tooLongOf(intent);
          if (long && !lengthRetried) {
            lengthRetried = true;
            corrections.push(lengthRetryNote(long.words, long.cap, lang));
            tell("len_retry", intent.visibleContent);
          }
          const motif = motifOf(intent);
          const stale = staleOf(intent);
          if ((motif || stale) && !motifRetried) {
            motifRetried = true;
            corrections.push(motif ? motifRetryNote(motif.said, lang) : noveltyRetryNote(lang));
            tell(motif ? "motif_retry" : "novelty_retry", intent.visibleContent);
          }
          if (owedQuestionNow && dodgesOf(intent) && !debtRetried) {
            debtRetried = true;
            corrections.push(owedRetryNote(owedQuestionNow, lang));
            tell("debt_retry", intent.visibleContent);
          }
          const falseQuote = quotesOf(intent);
          if (falseQuote.length > 0 && !quoteRetried) {
            quoteRetried = true;
            corrections.push(quoteRetryNote(falseQuote, lang));
            tell("quote_retry", intent.visibleContent);
          }
          if (narrationOnly.has(intent) && !narrationRetried) {
            narrationRetried = true;
            corrections.push(narrationRetryNote(narrationOnly.get(intent)!, lang));
          }
        }
        // The failed attempt joins "your last lines": the retry is shown it as said, and its angle rotates (compact hotel prompt only).
        const retryInput: AgentRuntimeInput =
          ctx.llmConfig.promptStyle === "compact" && intent.visibleContent
            ? { ...input, perceptionPacket: { ...input.perceptionPacket, ownRecentUtterances: [...input.perceptionPacket.ownRecentUtterances, intent.visibleContent] } }
            : input;
        const retryPrompt = this.buildRetryPrompt(retryInput, ctx, prompt, script ? mergeRetryNotes(corrections, lang) : corrections.join("\n\n"));
        const retryTrimEvent = this.promptTrimEvent(
          retryPrompt,
          simulationId,
          agentId,
          ctx.pulseIndex,
          ctx.now,
        );
        if (retryTrimEvent) retryTrimEvents.push(retryTrimEvent);
        // The gate's budget check runs once before the first call; each retry
        // is a further wire call it did not authorize, so re-check before
        // issuing one. A denial must not turn into a free retry. With a
        // near-duplicate still on the table the pulse is blocked below; a
        // merely unresolved target falls to the floor instead.
        const budgetDecision = llmBudget.canCall({
          simulationId,
          agentId,
          priority: input.budgetPriority,
          inputTokensEstimate: retryPrompt.inputTokensEstimate,
        });
        if (!budgetDecision.allowed) {
          if (isRepeat(intent) || loopOf(intent) !== undefined) {
            repetitionBlocked = true;
            lastRepeatWasOwn = isOwnRepeat(intent);
            lastBlockedLoop = isRepeat(intent) ? undefined : loopOf(intent);
            retryKind = "repeat_failed";
          }
          break;
        }
        try {
          const retryResult = await provider.generateIntent(input, runtimeContext, retryPrompt);
          retriesAttempted++;
          totalInputTokens += retryResult.usage.inputTokens;
          totalOutputTokens += retryResult.usage.outputTokens;
          retryUsages.push({
            inputTokens: retryResult.usage.inputTokens,
            outputTokens: retryResult.usage.outputTokens,
            latencyMs: retryResult.latencyMs,
            promptVersion: retryPrompt.version,
          });
          const retryParse = withoutNarration(IntentParser.parse(retryResult.content, agentId, input.availableActions, "no_op", targetContext));
          if (!retryParse.fallbackApplied) tally(retryParse.intent);
          if (!retryParse.fallbackApplied && !isBad(retryParse.intent) && !retryParse.unresolvedTarget && !aimedElsewhere(retryParse.intent) && !scriptBlocking(retryParse.intent)) {
            parseResult = retryParse;
            intent = retryParse.intent;
            fallbackApplied = false;
            retryRecoveryEvents.push({
              type: "llm_retry_recovered",
              simulationId,
              agentId,
              pulseIndex: ctx.pulseIndex,
              detail: `Agent ${agentId} recovered on retry ${retriesAttempted} after ${firstAttemptViolations.join(" + ")}.`,
              createdAt: Date.now(),
              data: {
                violations: firstAttemptViolations,
                retriesAttempted,
              },
            });
            break;
          }
          // Adopt the latest attempt even when it still violates a guard, so
          // the structural outcomes below judge the model's final answer: a
          // still-repeating answer is blocked, a still-unresolved target is
          // floored. A parse fallback ends the arm as an llm_failure.
          parseResult = retryParse;
          intent = retryParse.intent;
          if (retryParse.fallbackApplied) {
            fallbackApplied = true;
            retryKind = "parse_failed";
            break;
          }
        } catch {
          fallbackApplied = true;
          intent = IntentParser.createFallback(agentId, "no_op", "Retry call failed.");
          retryKind = "provider_failed";
          break;
        }
      }
      // Exhausted the retry budget with the model still repeating. A person who asked this actor something and is
      // waiting is answered anyway: a repeated answer is what people give when asked twice, and silence is not.
      // Corrupt text is never delivered, to a person who asked either: silence is better than "Éduğunu".
      const stillGarbled = fallbackApplied ? undefined : garbleOf(intent);
      if (stillGarbled) {
        garbleDropped = stillGarbled;
      } else if (!fallbackApplied && isRepeat(intent) && !askedByPerson(input, agentId)) {
        repetitionBlocked = true;
        lastRepeatWasOwn = isOwnRepeat(intent);
        lastBlockedLoop = undefined;
        retryKind = "repeat_failed";
      } else if (!fallbackApplied && loopOf(intent) !== undefined && !askedByPerson(input, agentId)) {
        repetitionBlocked = true;
        lastBlockedLoop = loopOf(intent);
        retryKind = "repeat_failed";
      }
    }

    // Script repairs of the line that is left. Sentences that quote or report words nobody said are struck; a person who asked this actor something gets their
    // answer as it is otherwise (a repeat is what people give when asked twice); a line that still brings back a motif or says nothing new becomes the sentences
    // of it that do not; a line that still asks while it owes an answer loses its questions; and a line over the cap is cut at a sentence boundary. When nothing
    // is left of the line the turn is silence (a no-op with the output-guard motive, the face the model gave it or one for its feeling): the guard never speaks for
    // the actor. `PERFECTMAN_FILLER_SILENCE=0` brings back the old short reaction ("Ah.", "Hm.") said in its place.
    let silenced: { why: string; before: string } | undefined;
    if (script && !fallbackApplied && !repetitionBlocked && !garbleDropped && narrationOnly.has(intent)) {
      silenced = { why: "only narration, nothing said out loud", before: narrationOnly.get(intent)! };
    } else if (script && !fallbackApplied && !repetitionBlocked && !garbleDropped && speaks(intent)) {
      const original = intent.visibleContent!;
      let text = original;
      const reaction = (): string => reactionFor(`${agentId}|${ctx.pulseIndex}|${original.length}`, lang);
      const giveUp = (why: string): void => {
        if (fillerSilence) {
          silenced ??= { why, before: original };
          text = "";
        } else text = reaction();
      };
      const falseQuote = quotesOf(intent);
      if (falseQuote.length > 0) {
        const before = text;
        text = withoutFalseQuotes(text, falseQuote);
        tell("quote_struck", before, text);
        if (text === "") giveUp("every sentence put words in someone's mouth");
      }
      if (!silenced && !asked && (motifOf(intent) !== undefined || staleOf(intent) !== undefined)) {
        const before = text;
        const kept = splitAfter(text, ".!?…")
          .filter((sentence) => motifRepeat(sentence, spoken, roomNamesSet) === undefined)
          .join(" ")
          .trim();
        const usable = kept !== "" && normalizeWords(kept).length >= 2 && noveltyOf(kept) === undefined;
        if (usable) text = kept;
        else giveUp("nothing the room had not just heard");
        if (!silenced) tell("motif_reaction", before, text);
      }
      if (!silenced && owedQuestionNow && !asked && !answersFirst(text)) {
        const before = text;
        const rest = withoutQuestions(text);
        if (rest !== "") text = rest;
        else giveUp("a question asked while one was owed");
        if (!silenced && text !== before) tell("debt_stripped", before, text);
      }
      if (!silenced && target && lengthOf(text) > target.cap) {
        const before = text;
        text = trimToCap(text, target.cap, target.sentences);
        tell("len_trimmed", before, text);
      }
      if (!silenced && text !== original) intent = { ...intent, visibleContent: text };
    }

    const retryPhrase =
      retriesAttempted === 0
        ? "with no retry allowed"
        : retriesAttempted === 1
          ? "even after a retry"
          : `even after ${retriesAttempted} retries`;
    if (garbleDropped) {
      // Not "Fallback applied:": the provider answered, so neither the breaker nor the health watch may count it as a failure.
      fallbackApplied = true;
      const dropped = intent.visibleContent;
      intent = IntentParser.createFallback(
        agentId,
        "no_op",
        `${OUTPUT_GUARD_MARKER}: corrupt text ("${quoted(garbleDropped.token, 40)}") in the line, ${retryPhrase} — dropped, staying quiet.`,
      );
      tell("garble_dropped", dropped, "");
    } else if (silenced) {
      fallbackApplied = true;
      const face = this.silentBody(intent, input);
      intent = { ...IntentParser.createFallback(agentId, "no_op", silenceMotive(silenced.why)), ...(face ? { body: face } : {}) };
      tell("guard_silenced", silenced.before, "");
    } else if (repetitionBlocked) {
      fallbackApplied = true;
      const blockedOwn = lastRepeatWasOwn;
      const what = lastBlockedLoop
        ? `a signature phrase ("${quoted(lastBlockedLoop.phrase, 60)}") you keep coming back to`
        : `near-duplicate of ${blockedOwn ? "a message you already sent" : "a line someone else in the room just said, or of your own thought"}`;
      const blocked = intent.visibleContent;
      intent = IntentParser.createFallback(agentId, "no_op", `${REPETITION_GUARD_MARKER}: ${what}, ${retryPhrase} — blocked structurally.`);
      tell("repeat_blocked", blocked, "");
    }

    // Target floor: after the retry arm, an intent whose reply/react target
    // is still unresolved never commits as-is — the triggering event (or the
    // most recent visible message) is inferred as the target; with no event
    // left to target, a reply downgrades to send_message and a reaction is
    // dropped. The repetition block above takes precedence: a near-duplicate
    // is never floored into a commit.
    let targetFloor: { detail: string; data: TargetResolutionFlooredData } | undefined;
    if (!fallbackApplied && parseResult.unresolvedTarget) {
      const bad = parseResult.unresolvedTarget;
      const floored = IntentParser.floorTargets(intent, targetContext);
      if (floored.outcome === "dropped") {
        fallbackApplied = true;
        retryKind = "parse_failed";
        parseResult = {
          ...parseResult,
          errorDetail: floored.detail ?? "Reaction target unresolvable; reaction dropped.",
          unresolvedTarget: undefined,
        };
        intent = IntentParser.createFallback(
          agentId,
          "no_op",
          floored.detail ?? "Reaction target unresolvable; reaction dropped.",
        );
      } else {
        intent = floored.intent;
        parseResult = { ...parseResult, errorDetail: undefined, unresolvedTarget: undefined };
        if (floored.outcome === "floored" || floored.outcome === "downgraded") {
          targetFloor = {
            detail: floored.detail ?? "",
            data: {
              field: floored.field,
              badHandle: bad.badHandle,
              outcome:
                floored.outcome === "downgraded"
                  ? "downgraded_to_send_message"
                  : "triggering_or_visible_event",
              ...(floored.resolvedEventId ? { resolvedEventId: floored.resolvedEventId } : {}),
            },
          };
        }
      }
    }

    const model = providerResult.model || llmConfig.modelName;
    const makeUsage = (u: {
      inputTokens: number;
      outputTokens: number;
      latencyMs: number;
      promptVersion: string;
    }): LLMUsage => ({
      simulationId,
      agentId,
      model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      latencyMs: u.latencyMs,
      callType: purposeToCallType("action_intent"),
      pulseIndex: ctx.pulseIndex,
      createdAt: ctx.now,
      promptVersion: u.promptVersion,
      promptTemplateVersion: prompt.templateVersion,
    });

    // Record each provider call with the prompt version that actually produced
    // it, so attribution stays per-prompt even when a retry used a modified
    // prompt (see m4). The retry's tokens are not double-counted: the main call
    // is recorded with the base prompt version, the retry with its own.
    llmBudget.recordUsage(makeUsage({
      inputTokens: mainInputTokens,
      outputTokens: mainOutputTokens,
      latencyMs: providerResult.latencyMs,
      promptVersion: prompt.version,
    }));
    for (const retryUsage of retryUsages) {
      llmBudget.recordUsage(makeUsage(retryUsage));
    }
    // Aggregated view for the returned output (summed across all calls).
    const totalLatencyMs =
      providerResult.latencyMs + retryUsages.reduce((sum, usage) => sum + usage.latencyMs, 0);
    const usageRecord = makeUsage({
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      latencyMs: totalLatencyMs,
      promptVersion: prompt.version,
    });

    const operatorEvents: OperatorEvent[] = [];
    if (trimEvent) operatorEvents.push(trimEvent);
    operatorEvents.push(...retryTrimEvents);
    operatorEvents.push(...retryRecoveryEvents);
    if (parseResult.truncationRepaired && !fallbackApplied) {
      // The response ran away inside a string and was cut back to a packet:
      // a real intent, not a fallback, but recorded — the cap was hit.
      operatorEvents.push({
        type: "llm_retry_recovered",
        simulationId,
        agentId,
        pulseIndex: ctx.pulseIndex,
        detail: `Agent ${agentId}'s response never closed its JSON (${parseResult.rawLength ?? "?"} chars); packet rebuilt from the closed fields.`,
        createdAt: Date.now(),
        data: { violations: ["truncated_json"], retriesAttempted: 0 },
      });
    }
    operatorEvents.push({
      type: "pulse_metrics",
      simulationId,
      agentId,
      pulseIndex: ctx.pulseIndex,
      detail: `LLM cognition call completed for agent ${agentId}`,
      createdAt: Date.now(),
      data: {
        model: providerResult.model || llmConfig.modelName,
        requestedModel: providerResult.requestedModel || llmConfig.modelName,
        routedModel: providerResult.routedModel ?? null,
        fallbackAttempts: providerResult.fallbackAttempts ?? null,
        latencyMs: totalLatencyMs,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        // Memory proposals that matched neither shape; the intent survived.
        memoryWritesDropped: parseResult.droppedMemoryWrites ?? 0,
      },
    });

    if (targetFloor) {
      operatorEvents.push({
        type: "target_resolution_floored",
        simulationId,
        agentId,
        pulseIndex: ctx.pulseIndex,
        detail: `Reply/reaction target for agent ${agentId} could not be resolved; engine floor applied: ${targetFloor.detail}`,
        createdAt: ctx.now,
        data: targetFloor.data,
      });
    }

    if (fallbackApplied && !repetitionBlocked && !garbleDropped && !silenced) {
      const detail =
        retryKind === "provider_failed"
          ? `Retry provider call failed for agent ${agentId}; falling back to no_op.`
          : `LLM parsing or target constraint validation failed for agent ${agentId}: ${parseResult.errorDetail}`;
      operatorEvents.push({
        type: "llm_failure",
        simulationId,
        agentId,
        pulseIndex: ctx.pulseIndex,
        detail,
        createdAt: Date.now(),
        data: {
          errorDetail: parseResult.errorDetail ?? null,
          // What the model actually returned, so a no-JSON fallback can be
          // attributed (empty / prose / reasoning leak / truncation).
          rawHead: parseResult.rawHead ?? null,
          rawTail: parseResult.rawTail ?? null,
          rawLength: parseResult.rawLength ?? null,
          requestedModel: providerResult.requestedModel || llmConfig.modelName,
          routedModel: providerResult.routedModel ?? null,
          fallbackAttempts: providerResult.fallbackAttempts ?? null,
        },
      });
    }

    if (garbleDropped || repetitionBlocked || silenced) {
      operatorEvents.push({
        type: "intent_blocked",
        simulationId,
        agentId,
        pulseIndex: ctx.pulseIndex,
        detail: garbleDropped
          ? `Output guard dropped a line with corrupt text from agent ${agentId}; substituted no_op.`
          : silenced
            ? `Output guard held back a line from agent ${agentId} (${silenced.why}); substituted no_op.`
            : `Repetition guard blocked a near-duplicate message from agent ${agentId}; substituted no_op.`,
        createdAt: Date.now(),
      });
    }

    const output: AgentRuntimeOutput = {
      intent: answerWhisper(intent, input.perceptionPacket.triggeringEvent ?? undefined),
      llmUsage: usageRecord,
      latencyMs: Date.now() - startTime,
      fallbackApplied,
      operatorEvents,
      ...(retryKind === "provider_failed" ? { providerFailed: true } : {}),
      ...(parseResult.bodyDropped && !fallbackApplied ? { bodyDropped: parseResult.bodyDropped } : {}),
    };

    return { ok: true, value: output };
  }

  /**
   * The body of a turn the guard silenced: the block the model gave, when it names a face, a gesture or an act (the silence still shows what the
   * person feels); else a face for the strongest feeling the model named (`emotionDrivers`), when this run asks for bodies at all; else whatever
   * block it had (a walk, a posture). Never speech.
   */
  private silentBody(intent: AgentRuntimeOutput["intent"], input: AgentRuntimeInput): AgentRuntimeOutput["intent"]["body"] {
    const given = intent.body;
    if (given && (given.expression !== undefined || given.gesture !== undefined || given.act !== undefined)) return given;
    const expression = input.perceptionPacket.body !== undefined ? expressionFor(intent.emotionDrivers ?? []) : undefined;
    if (expression === undefined) return given;
    return { ...(given ?? { order: "move_then_speak" as const }), expression };
  }

  /**
   * Assemble the retry prompt with the cap re-enforced. The composed
   * correction text is appended to the system text *after* the base render,
   * so a base prompt that `trimToFit` left just under the cap would cross it
   * once the correction is added. The base is therefore rebuilt against a cap
   * lowered by the correction's own token estimate; `base + correction` is
   * then within the original cap by construction. Falls back to a plain
   * append when the agent has no configured cap.
   */
  private buildRetryPrompt(
    input: AgentRuntimeInput,
    ctx: StepRunContext,
    basePrompt: BuiltPrompt,
    correction: string,
  ): BuiltPrompt {
    const suffix = correction ? `\n\n${correction}` : "";
    const cap = ctx.llmConfig.maxInputTokens;

    if (typeof cap !== "number" || cap <= 0) {
      const system = `${basePrompt.system}${suffix}`;
      return {
        ...basePrompt,
        retry: "correction",
        system,
        user: basePrompt.user,
        inputTokensEstimate: ActionIntentPromptBuilder.estimateTokens(system, basePrompt.user),
        version: promptVersionHash([system, basePrompt.user]),
      };
    }

    const suffixTokens = Math.ceil(suffix.length / 4);
    const adjustedCap = Math.max(1, cap - suffixTokens);
    const rebuilt = PromptBuilder.build(input, ctx.profile, "action_intent", adjustedCap, ctx.llmConfig.promptStyle);
    const system = `${rebuilt.system}${suffix}`;
    const user = rebuilt.user;
    const finalEstimate = ActionIntentPromptBuilder.estimateTokens(system, user);

    let trim: PromptTrim | undefined;
    if (rebuilt.trim) {
      const rawRetryEstimate = rebuilt.trim.rawInputTokensEstimate + suffixTokens;
      trim = {
        maxInputTokens: cap,
        rawInputTokensEstimate: rawRetryEstimate,
        finalInputTokensEstimate: finalEstimate,
        droppedEvents: rebuilt.trim.droppedEvents,
        droppedMemories: rebuilt.trim.droppedMemories,
        droppedUtterances: rebuilt.trim.droppedUtterances,
        droppedInputTokensEstimate: rawRetryEstimate - finalEstimate,
        withinCap: finalEstimate <= cap,
        phase: "repetition_retry",
      };
    }

    return {
      ...basePrompt,
      retry: "correction",
      system,
      user,
      inputTokensEstimate: finalEstimate,
      version: promptVersionHash([system, user]),
      ...(trim ? { trim } : {}),
    };
  }

  /**
   * Operator record for a prompt whose raw assembly exceeded the agent's
   * `maxInputTokens` (see ActionIntentPromptBuilder). Returns null when no
   * trim happened. The `detail` wording splits on `trim.withinCap`: a clean
   * trim reports what it dropped to fit; an irreducible one states plainly
   * that the cap could not be met, so an operator scanning `prompt_trimmed`
   * events never has to hand-compare the raw and final numbers.
   */
  private promptTrimEvent(
    prompt: BuiltPrompt,
    simulationId: string,
    agentId: string,
    pulseIndex: number,
    now: number,
  ): OperatorEvent | null {
    const { trim } = prompt;
    if (!trim) return null;
    const where = trim.phase === "repetition_retry" ? "Repetition-retry prompt" : "Prompt assembly";
    const detail = trim.withinCap
      ? `${where} for agent ${agentId} exceeded maxInputTokens ` +
        `(${trim.rawInputTokensEstimate} > ${trim.maxInputTokens} est. tokens); dropped ` +
        `${trim.droppedMemories} lowest-salience memory(ies), ${trim.droppedEvents} oldest ` +
        `context event(s) and ${trim.droppedUtterances} oldest own utterance(s) ` +
        `(~${trim.droppedInputTokensEstimate} tokens) to fit ${trim.finalInputTokensEstimate}.`
      : `${where} for agent ${agentId} could NOT be trimmed below maxInputTokens ` +
        `(${trim.maxInputTokens} est. tokens); dropped every trimmable item ` +
        `(${trim.droppedMemories} memory(ies), ${trim.droppedEvents} context event(s), ` +
        `${trim.droppedUtterances} own utterance(s)) but ` +
        `irreducible content still estimates ~${trim.finalInputTokensEstimate} tokens — sent over cap.`;
    return {
      type: "prompt_trimmed",
      simulationId,
      agentId,
      pulseIndex,
      detail,
      createdAt: now,
      data: {
        phase: trim.phase,
        withinCap: trim.withinCap,
        maxInputTokens: trim.maxInputTokens,
        rawInputTokensEstimate: trim.rawInputTokensEstimate,
        finalInputTokensEstimate: trim.finalInputTokensEstimate,
        droppedEvents: trim.droppedEvents,
        droppedMemories: trim.droppedMemories,
        droppedUtterances: trim.droppedUtterances,
        droppedInputTokensEstimate: trim.droppedInputTokensEstimate,
      },
    };
  }
}
