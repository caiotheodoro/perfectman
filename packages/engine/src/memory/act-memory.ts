import type { AgentState, Memory, RelationalState } from "@perfectman/shared";
import { clamp } from "@perfectman/shared";

/**
 * What an act leaves in the memory of the people who were in it (act-contract.md REA-8, DEATH-4, MEM-1). Pure: it takes
 * an agent's state and the facts of one act and returns the state with one episodic memory and the relationship moves
 * that memory implies. The hotel's frames carry the facts (`act_done`, `act_beat.witnesses`, `actor_death`); the verb
 * table carries the event and tone (`verbs.<id>.memory`), which the caller passes in as `entry`.
 */

export type ActMemoryEvent = "aggressor" | "victim" | "witnessed" | "affectionate" | "receiver" | "death" | "none";

/** `verb-vocab.json` `enums.memory_tones`, plus the three a death can be remembered as. */
export type ActMemoryTone = "hostile" | "hurt" | "shocked" | "warm" | "tender" | "grief" | "dismissive" | "neutral" | "anger" | "fear";

export type ActMemoryEntry = { event: ActMemoryEvent; tone: ActMemoryTone };

export type ActLang = "pt-BR" | "en";

export type ActFacts = {
  actId: string;
  verb: string;
  /** The initiator. */
  actor: string;
  /** The `with` of the act, when it has one. */
  target?: string;
  /** Everyone in `act_beat.witnesses` that is one of the cast, principals excluded. */
  witnesses: readonly string[];
  /** ref -> display name. A name that is not here reads as "someone". */
  names: Readonly<Record<string, string>>;
  lang?: ActLang;
};

export type DeathFacts = {
  actId: string;
  victim: string;
  /** Absent for a standalone `die`. */
  killer?: string;
  cause: "kill" | "die";
  witnesses: readonly string[];
  names: Readonly<Record<string, string>>;
  lang?: ActLang;
};

export const DEATH_MEMORY_PREFIX = "drama_death_";
export const ACT_MEMORY_PREFIX = "drama_act_";

/** Past-tense phrases, per verb and viewpoint. `{a}` is the actor, `{t}` the target. */
const PHRASE: Partial<Record<string, Record<ActLang, { actor: string; target: string; witness: string }>>> = {
  glare: { en: { actor: "I glared at {t}.", target: "{a} glared at me.", witness: "I saw {a} glare at {t}." }, "pt-BR": { actor: "Encarei {t}.", target: "{a} me encarou.", witness: "Vi {a} encarar {t}." } },
  insult: { en: { actor: "I insulted {t}.", target: "{a} insulted me.", witness: "I heard {a} insult {t}." }, "pt-BR": { actor: "Insultei {t}.", target: "{a} me insultou.", witness: "Ouvi {a} insultar {t}." } },
  shove: { en: { actor: "I shoved {t}.", target: "{a} shoved me.", witness: "I saw {a} shove {t}." }, "pt-BR": { actor: "Empurrei {t}.", target: "{a} me empurrou.", witness: "Vi {a} empurrar {t}." } },
  slap: { en: { actor: "I slapped {t}.", target: "{a} slapped me.", witness: "I saw {a} slap {t}." }, "pt-BR": { actor: "Dei um tapa em {t}.", target: "{a} me deu um tapa.", witness: "Vi {a} dar um tapa em {t}." } },
  punch: { en: { actor: "I punched {t}.", target: "{a} punched me.", witness: "I saw {a} punch {t}." }, "pt-BR": { actor: "Soquei {t}.", target: "{a} me socou.", witness: "Vi {a} socar {t}." } },
  hug: { en: { actor: "I hugged {t}.", target: "{a} hugged me.", witness: "I saw {a} hug {t}." }, "pt-BR": { actor: "Abracei {t}.", target: "{a} me abracou.", witness: "Vi {a} abracar {t}." } },
  kiss: { en: { actor: "I kissed {t}.", target: "{a} kissed me.", witness: "I saw {a} kiss {t}." }, "pt-BR": { actor: "Beijei {t}.", target: "{a} me beijou.", witness: "Vi {a} beijar {t}." } },
  tend_fallen: { en: { actor: "I tended {t}.", target: "{a} tended me.", witness: "I saw {a} tend {t}." }, "pt-BR": { actor: "Cuidei de {t}.", target: "{a} cuidou de mim.", witness: "Vi {a} cuidar de {t}." } },
  faint: { en: { actor: "I fainted.", target: "{a} fainted.", witness: "I saw {a} faint." }, "pt-BR": { actor: "Desmaiei.", target: "{a} desmaiou.", witness: "Vi {a} desmaiar." } },
};

const DEATH_PHRASE: Record<ActLang, { victimKilled: string; victimDied: string; killer: string; witnessKilled: string; witnessDied: string }> = {
  en: { victimKilled: "{k} killed me.", victimDied: "I died.", killer: "I killed {v}.", witnessKilled: "I saw {v} die at the hands of {k}.", witnessDied: "I saw {v} die." },
  "pt-BR": { victimKilled: "{k} me matou.", victimDied: "Eu morri.", killer: "Eu matei {v}.", witnessKilled: "Vi {v} morrer pelas maos de {k}.", witnessDied: "Vi {v} morrer." },
};

const fill = (text: string, vars: Record<string, string>): string => text.replace(/\{(\w)\}/g, (_, k: string) => vars[k] ?? "");
const nameOf = (names: Readonly<Record<string, string>>, ref: string | undefined, lang: ActLang): string => (ref ? names[ref] : undefined) ?? (lang === "en" ? "someone" : "alguem");

type RelMove = Partial<Record<"trust" | "resentment" | "threat" | "suspicion" | "affection" | "comfort" | "desireForCloseness" | "desireForDistance", number>>;

const BLANK = (id: string): RelationalState => ({
  targetAgentId: id, trust: 0, affection: 0, resentment: 0, attraction: 0, suspicion: 0, admiration: 0, envy: 0, comfort: 0, threat: 0, curiosity: 0,
  desireForCloseness: 0.5, desireForDistance: 0.2, interactionCount: 0, lastInteractionAt: null, lastPositiveAt: null, lastNegativeAt: null,
});

const BOUNDS: Record<keyof RelMove, [number, number]> = {
  trust: [-1, 1], resentment: [0, 1], threat: [0, 1], suspicion: [0, 1], affection: [0, 1], comfort: [0, 1], desireForCloseness: [0, 1], desireForDistance: [0, 1],
};

/** Adds `move` (each term times `w`) to the agent's view of `other`; the clock fields follow the sign of the event. */
function nudge(rels: Map<string, RelationalState>, other: string, move: RelMove, w: number, now: number, negative: boolean): void {
  const cur = rels.get(other) ?? BLANK(other);
  const next: RelationalState = { ...cur };
  for (const [k, v] of Object.entries(move) as [keyof RelMove, number][]) next[k] = clamp(next[k] + v * w, BOUNDS[k][0], BOUNDS[k][1]);
  next.interactionCount = cur.interactionCount + 1;
  next.lastInteractionAt = now;
  if (negative) next.lastNegativeAt = now;
  else next.lastPositiveAt = now;
  rels.set(other, next);
}

const tender: RelMove = { affection: 0.1, comfort: 0.1, trust: 0.1 };

/**
 * REA-8 weights: a witness's memory scales with how close it was to the victim, 0.4 for a stranger to 1 for someone it loves.
 * Principals count in full.
 */
export function witnessWeight(state: AgentState, victim: string | undefined): number {
  const rel = victim ? state.relationalStates.get(victim) : undefined;
  return 0.4 + 0.6 * clamp(Math.max(rel?.affection ?? 0, rel?.comfort ?? 0), 0, 1);
}

function remember(state: AgentState, id: string, m: Omit<Memory, "id" | "agentId" | "simulationId" | "sourceEventIds" | "createdAt" | "lastReinforcedAt" | "type" | "confidence">, now: number): AgentState {
  if (state.memories.some((x) => x.id === id)) return state;
  const memory: Memory = {
    id, agentId: state.agentId, simulationId: state.simulationId, type: "episodic", sourceEventIds: [], confidence: 0.95, createdAt: now, lastReinforcedAt: now, ...m,
  };
  return { ...state, memories: [...state.memories, memory] };
}

/**
 * A landed act, as one of its people remembers it (REA-8). `role` says which half of the act `self` was; `entry` is the
 * verb's `memory.<role>` row from the table. An entry whose event is `none` writes nothing. Idempotent on `act_id`.
 */
export function rememberAct(state: AgentState, facts: ActFacts, role: "actor" | "target" | "witness", entry: ActMemoryEntry, now: number): AgentState {
  if (entry.event === "none" || entry.event === "death") return state;
  const lang = facts.lang ?? "pt-BR";
  const phrase = PHRASE[facts.verb]?.[lang];
  if (!phrase) return state;
  const w = role === "witness" ? witnessWeight(state, facts.target ?? facts.actor) : 1;
  const rels = new Map([...state.relationalStates].map(([k, v]) => [k, { ...v }]));
  const other = role === "actor" ? facts.target : facts.actor;
  const negative = entry.tone === "hostile" || entry.tone === "hurt" || entry.tone === "shocked" || entry.tone === "dismissive";
  const warm = entry.tone === "warm" || entry.tone === "tender";
  if (other && other !== state.agentId && (negative || warm)) {
    const move: RelMove = negative
      ? role === "actor" ? { desireForDistance: 0.05 } : { trust: -0.3, resentment: role === "target" ? 0.3 : 0.1, threat: 0.2, desireForDistance: 0.2 }
      : tender;
    nudge(rels, other, move, role === "witness" ? w : 1, now, negative);
  }
  const text = role === "actor" ? phrase.actor : role === "target" ? phrase.target : phrase.witness;
  const names = { a: nameOf(facts.names, facts.actor, lang), t: nameOf(facts.names, facts.target, lang) };
  const next = remember(state, `${ACT_MEMORY_PREFIX}${facts.actId}_${state.agentId}`, {
    subjectAgentIds: [facts.actor, ...(facts.target ? [facts.target] : [])].filter((x) => x !== state.agentId),
    summary: fill(text, names), emotionalTone: entry.tone, intensity: clamp((negative ? 0.5 : 0.35) * (0.6 + 0.4 * w), 0, 1), unresolved: negative && role !== "actor",
  }, now);
  return next === state ? state : { ...next, relationalStates: rels };
}

/** How a witness takes a death, by what it felt about the two before (bible 5.5, DEATH-4). */
export function deathTone(state: AgentState, victim: string, killer: string | undefined): "grief" | "anger" | "fear" {
  const toVictim = state.relationalStates.get(victim);
  const toKiller = killer ? state.relationalStates.get(killer) : undefined;
  if (Math.max(toVictim?.affection ?? 0, toVictim?.comfort ?? 0) >= 0.5) return "grief";
  if ((toKiller?.resentment ?? 0) >= 0.4 || (toVictim?.affection ?? 0) >= 0.25) return "anger";
  return "fear";
}

const DEATH_MOVE: Record<"grief" | "anger" | "fear", { killer: RelMove; victim: RelMove }> = {
  grief: { killer: { resentment: 0.35, trust: -0.4, threat: 0.25 }, victim: { desireForCloseness: 0.15 } },
  anger: { killer: { resentment: 0.45, trust: -0.5, threat: 0.2 }, victim: {} },
  fear: { killer: { threat: 0.5, desireForDistance: 0.45, trust: -0.4 }, victim: {} },
};

/**
 * The death, strongest of the act memories (DEATH-4): written for the victim, the killer and every witness. It is
 * `unresolved`, so the memory store's eviction keeps it, and it is never removed at a revive. Idempotent on `act_id`.
 */
export function rememberDeath(state: AgentState, facts: DeathFacts, now: number): AgentState {
  const self = state.agentId;
  const lang = facts.lang ?? "pt-BR";
  const phrase = DEATH_PHRASE[lang];
  const v = { v: nameOf(facts.names, facts.victim, lang), k: nameOf(facts.names, facts.killer, lang) };
  const id = `${DEATH_MEMORY_PREFIX}${facts.actId}_${self}`;
  const rels = new Map([...state.relationalStates].map(([k, r]) => [k, { ...r }]));
  const subjects = [facts.victim, ...(facts.killer ? [facts.killer] : [])].filter((x) => x !== self);

  if (self === facts.victim) {
    if (facts.killer) nudge(rels, facts.killer, { resentment: 0.4, trust: -0.5, threat: 0.3 }, 1, now, true);
    return withRels(remember(state, id, { subjectAgentIds: subjects, summary: fill(facts.killer ? phrase.victimKilled : phrase.victimDied, v), emotionalTone: "grief", intensity: 1, unresolved: true }, now), state, rels);
  }
  if (self === facts.killer) {
    return withRels(remember(state, id, { subjectAgentIds: subjects, summary: fill(phrase.killer, v), emotionalTone: "hostile", intensity: 0.9, unresolved: true }, now), state, rels);
  }
  const tone = deathTone(state, facts.victim, facts.killer);
  const w = witnessWeight(state, facts.victim);
  if (facts.killer) nudge(rels, facts.killer, DEATH_MOVE[tone].killer, w, now, true);
  if (Object.keys(DEATH_MOVE[tone].victim).length > 0) nudge(rels, facts.victim, DEATH_MOVE[tone].victim, w, now, true);
  return withRels(
    remember(state, id, { subjectAgentIds: subjects, summary: fill(facts.killer ? phrase.witnessKilled : phrase.witnessDied, v), emotionalTone: tone, intensity: clamp(0.6 + 0.4 * w, 0, 1), unresolved: true }, now),
    state,
    rels,
  );
}

/** Keeps the relationship moves only when the memory was new, so a repeated frame moves nothing twice. */
function withRels(next: AgentState, before: AgentState, rels: Map<string, RelationalState>): AgentState {
  return next === before ? before : { ...next, relationalStates: rels };
}
