/**
 * Judge harness — scores a scenario's roleplay quality on rubric axes.
 *
 * Two judge modes:
 *  - "rule" (default, offline, deterministic): heuristic v0 judge that maps
 *    the measured probes + event artifacts onto the rubric axes. Documented
 *    limitation: it measures proxies, not quality. Replace with an LLM judge
 *    for real runs (mode "llm" via any OpenAI-compatible endpoint).
 *  - "llm": LLM-as-judge scoring the transcript on the rubric anchors.
 *
 * Judge outputs are cached by canonical JSON fingerprint (never overwritten).
 * Calibration (kappa/alpha vs golden labels) is a separate gate.
 */

import type { CommittedEvent, JudgeRubric, RoleplayScenario } from "@perfectman/shared";
import { PromptSection, NARRATIVE_RUBRIC } from "@perfectman/shared";
import { chatCompletion, ChatCompletionError } from "../llm/chat-completion-error.js";
import { LLMHttpError } from "@perfectman/server";

import type { ProbeResult } from "../probes/types.js";
import type { Narration } from "../narrator/narrator.js";
import {
  buildMotiveIndex,
  buildTranscriptView,
  renderTranscript,
  renderTranscriptLine,
} from "../transcript/render-transcript.js";

export type AxisScores = Record<string, number>;

export type JudgedScene = {
  scenarioId: string;
  rubricId: string;
  axes: AxisScores;
  judge: "rule" | "llm";
  model?: string;
};

// ── Rule judge ───────────────────────────────────────────────────────────────

function clampScore(v: number): number {
  return Math.min(5, Math.max(1, Math.round(v)));
}

/**
 * Extracts the JSON object from a judge model's raw response text.
 *
 * The judge calls hit an OpenAI-compatible /chat/completions endpoint,
 * which — unlike a native Ollama /api/chat call — has no way to request
 * think:false for Qwen3-family models. Left uncontrolled, the model can
 * spend its entire token budget on a <think>...</think> reasoning block and
 * never emit the actual JSON, which used to blow up downstream as an opaque
 * "Unexpected end of JSON input" on JSON.parse(""). Stripping the think
 * block first (if present) means the brace search only ever looks at the
 * model's actual answer.
 */
function extractJsonObject(raw: string): string {
  const withoutThinking = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const start = withoutThinking.indexOf("{");
  const end = withoutThinking.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Judge response had no parseable JSON object (raw length ${raw.length}, likely truncated mid-reasoning): ${raw.slice(0, 200)}`,
    );
  }
  return withoutThinking.slice(start, end + 1);
}

/**
 * Last-resort recovery for judges that ignore the JSON contract and answer
 * in prose ("**Roleplay Quality Score Summary** ... 1. Character
 * Development (2/5)"). Scans for each rubric axis id followed nearby by a
 * 1-5 integer score. Returns null unless at least half the axes were
 * recovered — a partial read of the transcript's quality must beat crashing
 * mid-benchmark, but near-empty salvage is not signal.
 */
export function salvageAxisScoresFromProse(
  raw: string,
  axisIds: readonly string[],
): Record<string, number> | null {
  const scores: Record<string, number> = {};
  for (const axisId of axisIds) {
    const labelPattern = axisId.replace(/_/g, "[_\\s]");
    // axis id, optional separator decoration, then a 1-5 integer either as
    // "N/5", "N out of 5", or a bare "N" right after : - = or whitespace.
    // The gap before the digit excludes newlines so a numbered-list marker
    // on the *next* line (e.g. "in_character — strong\n2. voice_match") can
    // never be mistaken for this axis's score.
    const re = new RegExp(
      `${labelPattern}[^0-9\\n]{0,40}?(\\d)\\s*(?:/\\s*5|out of 5|(?=[.,;)\\n]|$))`,
      "i",
    );
    const m = raw.match(re);
    if (m) {
      const v = Number(m[1]);
      if (v >= 1 && v <= 5) scores[axisId] = v;
    }
  }
  const recovered = Object.keys(scores).length;
  if (recovered === 0 || recovered < axisIds.length / 2) return null;
  return scores;
}

const STYLE_TELLS = ["kkk", "kkkk", "cara", "pera", "hm", "né", "tô", "tá", "tbm", "tb", "vdd", "pois é", "não", "..." ];

export function ruleJudge(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  probes: readonly ProbeResult[],
  signalPassRate: number,
): AxisScores {
  const probe = (id: string): ProbeResult | undefined => probes.find(p => p.probe === id);
  const leak = probe("ai-leak")?.measured ?? 0;
  const emoji = probe("emoji-reaction")?.measured ?? 0;
  const noopMeaning = probe("noop-meaningfulness")?.measured ?? 1;
  const memory = probe("memory-write")?.measured ?? 0;

  const messages = events.filter(e => e.type === "message_sent" || e.type === "reply_sent");
  const content = messages.map(e => (e.payload as Record<string, unknown>).content).filter((c): c is string => typeof c === "string");

  // voice_match: share of messages carrying persona-ish tells.
  const withTells = content.filter(c => {
    const lower = c.toLowerCase();
    return STYLE_TELLS.some(t => lower.includes(t));
  });
  const tellRatio = content.length > 0 ? withTells.length / content.length : 0.3;

  const noAiLeak = 5 - leak * 100;
  const voice = tellRatio * 5;
  const motive = noopMeaning * 5;
  const interpretation = signalPassRate * 5;
  const inCharacter = Math.min(5, (voice * 0.6 + noAiLeak * 0.4));
  const creativity = 3 + emoji * 5 * 0.4 + (1 - leak) * 0.6;
  const continuity = memory > 0 ? 4 : 3;

  const axes: Record<string, number> = {
    in_character: clampScore(inCharacter),
    voice_match: clampScore(voice),
    motive_authenticity: clampScore(motive),
    interpretation: clampScore(interpretation),
    creativity_unhinged: clampScore(creativity),
    memory_continuity: clampScore(continuity),
    no_ai_leak: clampScore(noAiLeak),
    // Proxy: a scene that references memories and reads signals is more likely
    // to keep a thread across turns. The LLM judge owns the real axis.
    narrative_cohesion: clampScore((continuity + interpretation) / 2),
  };

  // Edge rubric uses different axes — map what exists.
  const result: AxisScores = {};
  for (const axis of scenario.rubric.axes) {
    result[axis.id] =
      axes[axis.id] ??
      clampScore(
        axis.id === "dramatic_tension" ? 3 + signalPassRate * 2 :
        axis.id === "unpredictability" ? 1 + intentEntropyScore(events) * 4 :
        axis.id === "believability_under_pressure" ? 3 + (1 - leak) * 2 :
        axis.id === "probe_bounds" ? (probes.filter(p => p.passed).length / Math.max(1, probes.length)) * 5 :
        axis.id === "signal_completion" ? signalPassRate * 5 :
        // Hidden-objective axes need the seeds and a semantic read; the rule
        // judge has neither, so both sit at the neutral anchor. The LLM judge
        // owns them (HIDDEN_OBJECTIVE_RUBRIC).
        axis.id === "mask_integrity" ? 3 :
        axis.id === "objective_pursuit" ? 3 :
        3,
      );
  }
  return result;
}


// ── Intent-entropy (unpredictability proxy) ──────────────────────────────────

/**
 * Event types that represent an agent's observable choice. `agent_invited`
 * is intentionally NOT here: it is the mechanical echo of one
 * `channel_created` decision (N invites from a single create), so counting
 * it would inflate one choice across two buckets.
 *
 * `repetition_blocked` is likewise absent on purpose: the guard firing is the
 * generator failing, not the agent choosing, and counting it as a choice let a
 * degenerate run score as behaviorally diverse.
 */
const CHOICE_EVENT_TYPES = new Set([
  "message_sent",
  "reply_sent",
  "reaction_sent",
  "no_op_recorded",
  "channel_created",
]);

type ChoiceCounts = Map<string, number>;

function choiceEntropy(counts: ChoiceCounts): number {
  const total = [...counts.values()].reduce((s, c) => s + c, 0);
  if (total === 0 || counts.size <= 1) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / total;
    entropy -= p * Math.log(p);
  }
  // Normalize by the FULL choice set, not the observed subset: a room that
  // only messages/replies 50/50 is the most ordinary chat shape and must
  // not read as maximally unpredictable. log(5) keeps the room that uses
  // all five choice types uniformly at the ceiling.
  return entropy / Math.log(CHOICE_EVENT_TYPES.size);
}

/**
 * Normalized Shannon entropy over each agent's distribution of committed
 * choice types, averaged across agents: 1.0 when EVERY agent spreads its
 * actions uniformly across the full choice set, 0.0 when every action is
 * the same type. Per-agent, not pooled — the rubric anchor is per-agent
 * ("unpredictable choices within persona"), and pooling lets one diverse
 * actor hide a room full of predictable ones. Type-level ONLY: surprising
 * content inside a fixed type is invisible to this proxy (the LLM judge
 * owns that). It replaces the old `3 + emoji*2` proxy, which was
 * structurally pinned at 3.0 in any room that never reacts (#32).
 *
 * Tiny-transcript caveat: with very few events the estimate is coarse — a
 * room storing 2 events of 2 different types scores H=log(2)/log(5) ≈ 0.43.
 * Acceptable for a documented v0 proxy; revisit if micro-transcripts ever
 * gate decisions.
 *
 * Degenerate rooms (all no_op, or empty) score 0 here and land the
 * `unpredictability` axis at its 1 floor — the old `3 + emoji*2` proxy left
 * them at 3. Defensible against anchor 1 (same choice every turn IS the
 * definition of predictable), but it shifts the axis mean for silent rooms.
 */
export function intentEntropyScore(events: readonly CommittedEvent[]): number {
  const byActor = new Map<string, ChoiceCounts>();
  for (const e of events) {
    if (!CHOICE_EVENT_TYPES.has(e.type)) continue;
    let counts = byActor.get(e.actorId);
    if (!counts) byActor.set(e.actorId, (counts = new Map()));
    counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  }
  const scores: number[] = [];
  for (const counts of byActor.values()) {
    const total = [...counts.values()].reduce((s, c) => s + c, 0);
    if (total === 0) continue;
    scores.push(choiceEntropy(counts));
  }
  if (scores.length === 0) return 0;
  return scores.reduce((s, v) => s + v, 0) / scores.length;
}


// ── LLM judge ────────────────────────────────────────────────────────────────

export type LLMJudgeConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  timeoutMs?: number;
  /**
   * Output budget per call. Defaults differ per call site (transcript 1500,
   * narration 1200). A reasoning model with no thinking switch (GLM-5.3
   * through OrcaRouter) spends its budget before the JSON and returns empty
   * content at the defaults — the jury file raises it per juror.
   */
  maxTokens?: number;
};

// Root-caused via a real capture: a deepseek-v4-flash judge call returned
// completely empty content (raw length 0) — the same hidden-reasoning-
// burns-the-budget failure already fixed for the agent path and the
// narrator, which no judge call site had ever disabled. `includes` (not
// `startsWith`) because routers namespace model ids by provider.
// Qwen3 exposes the same switch under a different name: the chat template
// flag `enable_thinking` (verified on OrcaRouter's `qwen/qwen3.8-27b-free`
// — `enable_thinking` at the body root and `reasoning.enabled` are both
// ignored there). GLM-5.3 has no working switch through the router
// (`thinking.disabled` 502s upstream); it reasons inside the `maxTokens`
// headroom instead.
function thinkingExtraBody(model: string): Record<string, unknown> | undefined {
  if (model.includes("deepseek-v4")) return { thinking: { type: "disabled" } };
  if (/qwen3/i.test(model)) return { chat_template_kwargs: { enable_thinking: false } };
  return undefined;
}

function buildJudgeSystem(rubric: JudgeRubric): string {
  const axes = rubric.axes.map(
    (a) => `${a.id}: ${a.label}\n${Object.entries(a.anchors).map(([k, v]) => `  ${k}: ${v}`).join("\n")}`,
  );
  return new PromptSection()
    .container("role", (s) => s.raw(
      "You are a strict evaluator of roleplay quality in a chat-room social simulation. Score each axis 1-5 using ONLY the anchor descriptions. Be honest — a flat, safe, assistant-like performance must score low on creativity, voice, and motive authenticity.",
    ))
    .container("rubric", (s) => {
      s.raw(`Rubric: ${rubric.name}`);
      s.list(undefined, axes);
    })
    .container("output_contract", (s) => s.raw(
      'Return ONLY a JSON object: {"axes": {"<axisId>": score, ...}, "evidence": {"<axisId>": "<one short quote or [pNN] reference from the transcript that decided the score>", ...}} with no prose outside the JSON.',
    ))
    .toString();
}

/**
 * The judge reads the shared transcript view: cast, channels, the seeded
 * objectives/memories, then events with each act's motive joined from its
 * private_motive_summary. Seeds are ground truth the room does not have —
 * the note below scopes what they may be used for.
 */
const SEEDS_NOTE =
  "The <seeds> section is ground truth you know and the room does not: hidden objectives and seeded memories. " +
  "Use it ONLY to score memory_continuity, hidden_payoff, mask_integrity and objective_pursuit. " +
  "Never reward an agent for stating a seed the room could not have known, and never treat a seed as something that was said.";

function renderJudgeTranscript(scenario: RoleplayScenario, events: readonly CommittedEvent[]): string {
  return renderTranscript(buildTranscriptView(scenario, events, { seeds: "full", motives: "model" }));
}

function buildJudgeUser(scenario: RoleplayScenario, events: readonly CommittedEvent[]): string {
  return new PromptSection()
    .container("scenario", (s) => { s.raw(`Scenario: ${scenario.name}`); s.raw(scenario.description); })
    .container("seeds_note", (s) => s.raw(SEEDS_NOTE))
    .container("transcript", (s) => s.raw(renderJudgeTranscript(scenario, events)))
    .container("decision", (s) => s.raw("Score each axis from the transcript above, returning ONLY the JSON object per the output contract."))
    .toString();
}

async function callJudge(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  config: LLMJudgeConfig,
  systemSuffix = "",
): Promise<string> {
  const system = buildJudgeSystem(scenario.rubric) + systemSuffix;
  const user = buildJudgeUser(scenario, events);

  return chatCompletion({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    label: "LLM judge",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: config.temperature ?? 0,
    // Generous headroom: a thinking-mode model spends real tokens on
    // thinking... response before it ever reaches the answer, and not
    // every such model can be told to skip it (see extractJsonObject
    // above) — deepseek-v4 and qwen3 can, via extraBody below. GLM cannot,
    // so its jury entry raises `maxTokens` instead.
    maxTokens: config.maxTokens ?? 1500,
    timeoutMs: config.timeoutMs ?? 60000,
    extraBody: thinkingExtraBody(config.model),
  });
}

/** Per-axis evidence the judge cited: a short quote or `[pNN]` reference. */
export type AxisEvidence = Record<string, string>;

function parseAxes(raw: string, rubric: JudgeRubric): { axes: AxisScores; imputedAxes: string[]; evidence: AxisEvidence } {
  const jsonText = extractJsonObject(raw);
  const parsed = JSON.parse(jsonText) as { axes?: Record<string, number>; evidence?: Record<string, unknown> };
  const axes: AxisScores = {};
  const imputedAxes: string[] = [];
  // Evidence is requested, never required: an older judge answer (or one
  // that trims the field to fit) still parses; only string values survive.
  const evidence: AxisEvidence = {};
  for (const axis of rubric.axes) {
    const e = parsed.evidence?.[axis.id];
    if (typeof e === "string" && e.trim().length > 0) evidence[axis.id] = e.trim();
  }
  for (const axis of rubric.axes) {
    const v = parsed.axes?.[axis.id];
    if (typeof v === "number") {
      axes[axis.id] = clampScore(v);
    } else {
      // Model omitted this axis: fill the neutral 3 for single-judge
      // consumers, but flag it so a jury can exclude the vote — an
      // unflagged default would move the median on axes the juror never
      // scored.
      axes[axis.id] = 3;
      imputedAxes.push(axis.id);
    }
  }
  return { axes, imputedAxes, evidence };
}

const RETRY_SYSTEM_SUFFIX =
  "\n\nIMPORTANT: your previous reply was not parseable JSON. Respond with ONLY the JSON object — no prose, no markdown, no reasoning.";

/**
 * `salvaged: true` means the axes were recovered from a prose critique (or
 * partly defaulted to 3) rather than parsed from the requested JSON —
 * callers that feed scores into calibration must exclude these, since a
 * fabricated midpoint would silently compress the agreement signal.
 */
/**
 * `salvaged: true` means the axes were recovered from a prose critique (or
 * partly defaulted to 3) rather than parsed from the requested JSON —
 * callers that feed scores into calibration must exclude these, since a
 * fabricated midpoint would silently compress the agreement signal.
 * `imputedAxes` lists rubric axes the model omitted from its JSON answer
 * (filled with 3 by the single-judge path, but juries exclude them).
 * `evidence` is whatever the judge cited per axis — absent on salvage.
 */
export type JudgeResult = { axes: AxisScores; salvaged: boolean; imputedAxes: string[]; evidence?: AxisEvidence };

function isTransientTransportError(err: unknown): boolean {
  if (!(err instanceof ChatCompletionError)) return false;
  const status = err.cause instanceof LLMHttpError ? err.cause.status : undefined;
  return status === 429 || status === 503;
}

/**
 * Retries a transient transport failure (429 rate-limit, 503 capacity) with
 * backoff. Root-caused via a real canary bench round against a free-tier
 * endpoint: every scenario was marked "failed" not because generation or
 * scoring logic was wrong, but because the judge's first HTTP call hit a
 * 429 and that error propagated straight out of `llmJudge` uncaught —
 * `runJudgeWithRetrySalvage`'s own retry only ever covered unparseable
 * *responses*, never a failure on the call itself. A transport error is not
 * a quality signal; it should not sink an otherwise-valid scenario run.
 */
export async function retryOnTransientError<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 2;
  const delayMs = opts.delayMs ?? 2000;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries || !isTransientTransportError(err)) throw err;
      await new Promise(resolve => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  throw lastError;
}

/**
 * Shared call/parse/retry/salvage skeleton behind both `llmJudge` (scores the
 * transcript) and `judgeNarration` (scores the narrator's prose) — same JSON
 * contract, same one-retry-then-salvage defense, same honest failure. Neither
 * caller reimplements this; they only supply how to place one call and which
 * rubric to parse against.
 */
async function runJudgeWithRetrySalvage(
  rubric: JudgeRubric,
  callOnce: (systemSuffix: string) => Promise<string>,
  errorLabel: string,
): Promise<JudgeResult> {
  const rawAttempts: string[] = [];
  const axisIds = rubric.axes.map(a => a.id);

  rawAttempts.push(await retryOnTransientError(() => callOnce("")));
  try {
    const first = parseAxes(rawAttempts[0]!, rubric);
    return { axes: first.axes, salvaged: false, imputedAxes: first.imputedAxes, evidence: first.evidence };
  } catch {
    // One strict retry covers judges that burned their budget on reasoning
    // or ignored the JSON instruction on the first pass.
  }
  try {
    rawAttempts.push(await retryOnTransientError(() => callOnce(RETRY_SYSTEM_SUFFIX)));
    const second = parseAxes(rawAttempts[1]!, rubric);
    return { axes: second.axes, salvaged: false, imputedAxes: second.imputedAxes, evidence: second.evidence };
  } catch {
    // Fall through to prose salvage — a judge that answered in a scored
    // critique still emitted usable signal. Try every response we hold:
    // pass 2 may be truncated garbage while pass 1 was scored prose.
  }

  for (const raw of rawAttempts) {
    const salvaged = salvageAxisScoresFromProse(raw, axisIds);
    if (salvaged) {
      const axes: AxisScores = {};
      for (const axis of rubric.axes) {
        const v = salvaged[axis.id];
        axes[axis.id] = typeof v === "number" ? clampScore(v) : 3;
      }
      return { axes, salvaged: true, imputedAxes: [] };
    }
  }

  const lastRaw = rawAttempts[rawAttempts.length - 1] ?? "";
  throw new Error(
    `${errorLabel} returned unparseable response after retry (raw length ${lastRaw.length}): ${lastRaw.slice(0, 200)}`,
  );
}

export async function llmJudge(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  config: LLMJudgeConfig,
): Promise<JudgeResult> {
  return runJudgeWithRetrySalvage(
    scenario.rubric,
    (systemSuffix) => callJudge(scenario, events, config, systemSuffix),
    "LLM judge",
  );
}

// ── Narration judge ──────────────────────────────────────────────────────────

/**
 * Scores the Narration object (title/recap/hiddenShift) against
 * NARRATIVE_RUBRIC — the prose a spectator reads, never the raw transcript.
 * `events` is the real transcript the narration claims to describe: it grounds
 * the `hidden_payoff` axis, which must catch a hiddenShift that invents a
 * motive with no seeded fact behind it (see the rubric's own doc comment for
 * the real evidence this was grounded against).
 */
function buildNarrationJudgeUser(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  narration: Narration,
): string {
  return new PromptSection()
    .container("scenario", (s) => { s.raw(`Scenario: ${scenario.name}`); s.raw(scenario.description); })
    .container("seeds_note", (s) => s.raw(SEEDS_NOTE))
    .container("real_transcript", (s) => s.raw(renderJudgeTranscript(scenario, events)))
    .container("narration_under_review", (s) => {
      s.raw(`Title: ${narration.title}`);
      s.raw(`Recap: ${narration.recap}`);
      s.raw(`Hidden shift: ${narration.hiddenShift}`);
    })
    .container("decision", (s) => s.raw(
      "Score the NARRATION above — not the agents' behavior — against the real transcript it claims to describe, returning ONLY the JSON object per the output contract.",
    ))
    .toString();
}

async function callNarrationJudge(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  narration: Narration,
  config: LLMJudgeConfig,
  systemSuffix = "",
): Promise<string> {
  const system = buildJudgeSystem(NARRATIVE_RUBRIC) + systemSuffix;
  const user = buildNarrationJudgeUser(scenario, events, narration);

  return chatCompletion({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    label: "Narration judge",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: config.temperature ?? 0,
    maxTokens: config.maxTokens ?? 1200,
    timeoutMs: config.timeoutMs ?? 60000,
    extraBody: thinkingExtraBody(config.model),
  });
}

export async function judgeNarration(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  narration: Narration,
  config: LLMJudgeConfig,
): Promise<JudgeResult> {
  return runJudgeWithRetrySalvage(
    NARRATIVE_RUBRIC,
    (systemSuffix) => callNarrationJudge(scenario, events, narration, config, systemSuffix),
    "Narration judge",
  );
}

// ── Per-turn narrative-cohesion eval ─────────────────────────────────────────

/**
 * Scores turn-to-turn narrative cohesion across a transcript, plus the full
 * rubric from the whole transcript.
 *
 * The premise: perfectman is more than text generation — the interesting
 * failure modes live in whether a later message still carries the thread of
 * earlier turns (callbacks, escalation, shifted meaning), not in any single
 * message. A whole-transcript judge misses that; a per-turn judge sees it.
 *
 * Strategy (kept cheap for heuristic runs):
 *  1. One whole-transcript call scores all rubric axes (as `llmJudge` does).
 *  2. Consecutive content-bearing turns (grouped by pulse) are sampled and
 *     each scored on narrative_cohesion against the turn that preceded it.
 *  3. The mean cohesion becomes the `narrative_cohesion` axis value.
 *
 * Nondeterministic by design (high temperature, see bench.ts default) — this
 * is a heuristic, not a calibration gate. Calibration runs set temperature 0.
 */
export async function llmJudgePerTurn(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  config: LLMJudgeConfig,
  maxTurnSamples = 8,
): Promise<JudgeResult> {
  const { axes, salvaged, imputedAxes } = await llmJudge(scenario, events, config);

  // The per-turn axis is only meaningful when the rubric defines it (it lives
  // on roleplay-v1, not edge-chaos/behavioral). Guard before spending calls.
  if (!scenario.rubric.axes.some(a => a.id === "narrative_cohesion")) {
    return { axes, salvaged, imputedAxes };
  }

  const turns: CommittedEvent[][] = [];
  for (const e of events) {
    (turns[e.pulseIndex] ??= []).push(e);
  }
  const contentTurns = turns
    .map((group, pulseIndex) => ({ pulseIndex, group }))
    .filter(({ group }) =>
      group.some(e => e.type === "message_sent" || e.type === "reply_sent"),
    );

  const step = Math.max(1, Math.ceil((contentTurns.length - 1) / maxTurnSamples));
  let cohesionSum = 0;
  let cohesionCount = 0;
  // Start at 1 so the opening pair (0,1) is sampled and the strided adjacency
  // covers the full timeline when step > 1.
  for (let i = 1; i < contentTurns.length; i += step) {
    const prior = contentTurns[i - 1];
    const turn = contentTurns[i];
    if (!prior || !turn) continue;
    try {
      const score = await scoreCohesion(scenario, prior, turn, config);
      cohesionSum += score;
      cohesionCount++;
    } catch {
      // A failed per-turn call should not sink the whole scene — the axis
      // keeps the whole-transcript default if nothing succeeded.
    }
  }
  if (cohesionCount > 0) {
    axes["narrative_cohesion"] = clampScore(cohesionSum / cohesionCount);
  }
  return {
    axes,
    salvaged,
    // The per-turn pass actually measured cohesion, so it is no longer
    // imputed even if the whole-transcript judge omitted it.
    imputedAxes: imputedAxes.filter(a => a !== "narrative_cohesion"),
  };
}

function turnTranscript(group: readonly CommittedEvent[]): string {
  // Cohesion is scored on what the room saw: no motives, no seeds.
  const idx = buildMotiveIndex(group);
  return group
    .filter(e => e.type !== "private_motive_summary")
    .map(e => renderTranscriptLine(e, undefined, idx, { motives: "none" }))
    .join("\n");
}

async function scoreCohesion(
  scenario: RoleplayScenario,
  prior: { pulseIndex: number; group: CommittedEvent[] },
  turn: { pulseIndex: number; group: CommittedEvent[] },
  config: LLMJudgeConfig,
): Promise<number> {
  const system = new PromptSection()
    .container("role", (s) => s.raw(
      "You are a strict evaluator of NARRATIVE COHESION in a chat-room social simulation. Score 1-5 using ONLY these anchors:",
    ))
    .container("rubric", (s) => s.raw([
      "1: Contradicts its own earlier messages or ignores what it just said.",
      "2: Messages feel disconnected; no thread between turns.",
      "3: References prior turns sometimes, but loosely.",
      "4: Each turn builds on the prior exchange; thread is clear.",
      "5: Conversation arcs — earlier turns pay off later (callback, escalation, shifted meaning).",
    ].join("\n")))
    .container("output_contract", (s) => s.raw('Return ONLY a JSON object: {"narrative_cohesion": score} with no prose.'))
    .toString();

  const user = new PromptSection()
    .container("scenario", (s) => { s.raw(`Scenario: ${scenario.name}`); s.raw(scenario.description); })
    .container("earlier_turn", (s) => { s.raw(`Earlier turn (pulse ${prior.pulseIndex}):`); s.raw(turnTranscript(prior.group)); })
    .container("this_turn", (s) => { s.raw(`This turn (pulse ${turn.pulseIndex}):`); s.raw(turnTranscript(turn.group)); })
    .container("decision", (s) => s.raw("Score narrative_cohesion 1-5 from these two turns, returning ONLY the JSON object."))
    .toString();

  const raw = await chatCompletion({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: config.apiKey,
    label: "Cohesion judge",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: config.temperature ?? 1,
    // See extractJsonObject's comment — a thinking-mode model needs
    // headroom beyond the tiny {"narrative_cohesion": N} answer itself.
    maxTokens: 800,
    timeoutMs: config.timeoutMs ?? 60000,
    extraBody: thinkingExtraBody(config.model),
  });
  const jsonText = extractJsonObject(raw);
  const parsed = JSON.parse(jsonText) as {
    narrative_cohesion?: number;
    axes?: { narrative_cohesion?: number };
  };
  const v = parsed.narrative_cohesion ?? parsed.axes?.narrative_cohesion;
  return typeof v === "number" ? clampScore(v) : 3;
}

// ── Cache ────────────────────────────────────────────────────────────────────

export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value ?? {}).sort() as never);
}

export function judgeCacheKey(scenarioId: string, rubricId: string, events: readonly CommittedEvent[]): string {
  const digest = events
    .map(e => `${e.pulseIndex}:${e.actorId}:${e.type}:${canonicalJson(e.payload)}`)
    .join("|");
  return `judge:${rubricId}:${scenarioId}:${hashString(digest)}`;
}

function hashString(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

// ── Jury of judges ───────────────────────────────────────────────────────────

export type JuryJuror = {
  axes: AxisScores;
  /** True when this juror's scores came from prose salvage (imputed defaults). */
  salvaged: boolean;
  /** Rubric axes the model omitted from its JSON answer (voted nothing). */
  imputedAxes: string[];
  /** What this juror cited per axis, when it answered the evidence field. */
  evidence?: AxisEvidence;
  /** Source of this juror's scores, for the evidence trail. */
  model: string;
  baseUrl: string;
};

export type JuryVerdict = {
  /** Per-axis median across UNSALVAGED surviving judges — the verdict. */
  axes: AxisScores;
  /** Number of unsalvaged jurors whose votes produced the median. */
  voterCount: number;
  /**
   * Votes behind each axis's median. `voterCount` is jury-wide; an axis
   * every juror but one omitted has a "median" that is a single vote, and
   * a grade must be able to see that.
   */
  axisVoterCounts: Record<string, number>;
  /** Per-judge raw scores + salvage status, keyed by config label. */
  perJudge: Record<string, JuryJuror>;
  /** Judges that errored (transport/timeout/parse), label → reason. */
  failed: Record<string, string>;
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * Majority verdict across independently-sourced judges: same transcript,
 * different model families/endpoints, per-axis median. Self-preference bias
 * shows up as spread in `perJudge`; the median resists a single biased
 * outlier ONLY when >= 3 jurors survive — with exactly 2 the median is the
 * mean and offers no outlier resistance. Salvaged jurors (prose-implied
 * scores, mostly imputed defaults) are reported but EXCLUDED from medians,
 * and axes a juror omitted from its JSON answer are excluded from that
 * juror's vote (the single-judge path fills the neutral 3; a jury must not
 * let an unflagged default move the median). Judges that error are dropped
 * and their label → reason recorded in `failed`; at least one unsalvaged
 * survivor is required. Labels must be unique — duplicates would silently
 * collapse two votes into one. **Caller obligation: jurors must be
 * independently sourced** — duplicate (baseUrl, model) pairs throw, and
 * each juror's model/baseUrl is recorded in `perJudge` so the sourcing is
 * checkable later.
 */
export async function juryJudge(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  configs: Array<LLMJudgeConfig & { label?: string }>,
): Promise<JuryVerdict> {
  if (configs.length === 0) throw new Error("juryJudge requires at least one judge config");

  const labels = configs.map((c, i) => c.label ?? `judge-${i}`);
  const duplicates = labels.filter((label, i) => labels.indexOf(label) !== i);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate jury judge labels: ${[...new Set(duplicates)].join(", ")}`);
  }

  // Three qwen3:8b configs with distinct labels are NOT a jury — they are
  // the same bias three times. Reject same-endpoint pairs before any
  // network call.
  const endpointOwner = new Map<string, string>();
  for (let i = 0; i < configs.length; i++) {
    const key = `${configs[i]!.baseUrl}|${configs[i]!.model}`;
    const owner = endpointOwner.get(key);
    if (owner) {
      throw new Error(
        `Duplicate jury judge endpoint (${configs[i]!.baseUrl}, ${configs[i]!.model}) on labels "${owner}" and "${labels[i]}" — a jury must be independently sourced`,
      );
    }
    endpointOwner.set(key, labels[i]!);
  }

  const settled = await Promise.allSettled(
    configs.map(async (config, i) => ({
      label: labels[i]!,
      config,
      result: await llmJudge(scenario, events, config),
    })),
  );

  const perJudge: Record<string, JuryJuror> = {};
  const failed: Record<string, string> = {};
  // Index-based: `allSettled` discards the payload on rejection, so the
  // label must come from the configs array position, not the outcome.
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]!;
    if (outcome.status === "fulfilled") {
      perJudge[outcome.value.label] = {
        axes: outcome.value.result.axes,
        salvaged: outcome.value.result.salvaged,
        imputedAxes: outcome.value.result.imputedAxes,
        ...(outcome.value.result.evidence && Object.keys(outcome.value.result.evidence).length > 0
          ? { evidence: outcome.value.result.evidence }
          : {}),
        model: outcome.value.config.model,
        baseUrl: outcome.value.config.baseUrl,
      };
    } else {
      failed[labels[i]!] = (outcome.reason as Error)?.message ?? String(outcome.reason);
    }
  }
  if (Object.keys(perJudge).length === 0) {
    throw new Error("All jury judges failed");
  }

  // Salvaged scores are imputed defaults — they drag medians toward 3 and
  // poison divergence evidence. Reported, but never voted.
  const voters = Object.values(perJudge).filter(juror => !juror.salvaged);
  if (voters.length === 0) {
    throw new Error("All surviving jury judges required prose salvage — no trustworthy votes");
  }

  const axisIds = new Set<string>();
  for (const juror of voters) {
    for (const axis of Object.keys(juror.axes)) axisIds.add(axis);
  }

  const axes: AxisScores = {};
  const axisVoterCounts: Record<string, number> = {};
  for (const axis of axisIds) {
    const votes = voters
      .filter(juror => !juror.imputedAxes.includes(axis))
      .map(juror => juror.axes[axis])
      .filter((v): v is number => typeof v === "number");
    // clampScore keeps the verdict on the repo's single integer score domain
    // — an unclamped x.5 median would inflate kappa categories if a verdict
    // ever reached computeCalibration, and every other AxisScores value is
    // an integer in [1,5].
    if (votes.length > 0) {
      axes[axis] = clampScore(median(votes));
      axisVoterCounts[axis] = votes.length;
    }
  }
  return { axes, voterCount: voters.length, axisVoterCounts, perJudge, failed };
}
