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
import type { ProbeResult } from "../probes/types.js";

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
        axis.id === "unpredictability" ? 3 + emoji * 2 :
        axis.id === "believability_under_pressure" ? 3 + (1 - leak) * 2 :
        axis.id === "probe_bounds" ? (probes.filter(p => p.passed).length / Math.max(1, probes.length)) * 5 :
        axis.id === "signal_completion" ? signalPassRate * 5 :
        3,
      );
  }
  return result;
}

// ── LLM judge ────────────────────────────────────────────────────────────────

export type LlmJudgeConfig = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  timeoutMs?: number;
};

function buildJudgeSystem(rubric: JudgeRubric): string {
  const axes = rubric.axes
    .map(a => `- ${a.id}: ${a.label}\n  ${Object.entries(a.anchors).map(([k, v]) => `  ${k}: ${v}`).join("\n  ")}`)
    .join("\n");
  return `You are a strict evaluator of roleplay quality in a chat-room social simulation. Score each axis 1-5 using ONLY the anchor descriptions. Be honest — a flat, safe, assistant-like performance must score low on creativity, voice, and motive authenticity.

Rubric: ${rubric.name}
Axes:
${axes}

Return ONLY a JSON object: {"axes": {"<axisId>": score, ...}} with no prose.`;
}

function buildJudgeUser(scenario: RoleplayScenario, events: readonly CommittedEvent[]): string {
  const transcript = events
    .map(e => {
      const p = e.payload as Record<string, unknown>;
      const text = typeof p.content === "string" ? `: ${p.content}` : "";
      const motive = typeof p.privateMotiveSummary === "string" ? ` [private: ${p.privateMotiveSummary}]` : "";
      return `[p${e.pulseIndex}] ${e.actorId} (${e.type})${text}${motive}`;
    })
    .join("\n");
  return `Scenario: ${scenario.name}
${scenario.description}

Transcript:
${transcript}`;
}

export async function llmJudge(
  scenario: RoleplayScenario,
  events: readonly CommittedEvent[],
  config: LlmJudgeConfig,
): Promise<AxisScores> {
  const system = buildJudgeSystem(scenario.rubric);
  const user = buildJudgeUser(scenario, events);

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: config.temperature ?? 0,
      max_tokens: 600,
    }),
    signal: AbortSignal.timeout(config.timeoutMs ?? 60000),
  });

  if (!res.ok) {
    throw new Error(`LLM judge HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const parsed = JSON.parse(jsonText) as { axes?: Record<string, number> };
  const axes: AxisScores = {};
  for (const axis of scenario.rubric.axes) {
    const v = parsed.axes?.[axis.id];
    axes[axis.id] = typeof v === "number" ? clampScore(v) : 3;
  }
  return axes;
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
  config: LlmJudgeConfig,
  maxTurnSamples = 8,
): Promise<AxisScores> {
  const axes = await llmJudge(scenario, events, config);

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
  for (let i = 0; i < contentTurns.length; i += step) {
    const prior = contentTurns[i - 1];
    const turn = contentTurns[i];
    if (!prior || !turn) continue;
    try {
      const score = await scoreCohesion(scenario, prior, turn, config);
      cohesionSum += score;
      cohesionCount++;
    } catch {
      // A failed per-turn call should not sink the whole scene — the axis
      // stays unscored if nothing succeeded.
    }
  }
  if (cohesionCount > 0) {
    axes["narrative_cohesion"] = clampScore(cohesionSum / cohesionCount);
  }
  return axes;
}

function turnTranscript(group: readonly CommittedEvent[]): string {
  return group
    .map(e => {
      const p = e.payload as Record<string, unknown>;
      const text = typeof p.content === "string" ? `: ${p.content}` : "";
      return `[p${e.pulseIndex}] ${e.actorId} (${e.type})${text}`;
    })
    .join("\n");
}

async function scoreCohesion(
  scenario: RoleplayScenario,
  prior: { pulseIndex: number; group: CommittedEvent[] },
  turn: { pulseIndex: number; group: CommittedEvent[] },
  config: LlmJudgeConfig,
): Promise<number> {
  const system = `You are a strict evaluator of NARRATIVE COHESION in a chat-room social simulation. Score 1-5 using ONLY these anchors:
1: Contradicts its own earlier messages or ignores what it just said.
2: Messages feel disconnected; no thread between turns.
3: References prior turns sometimes, but loosely.
4: Each turn builds on the prior exchange; thread is clear.
5: Conversation arcs — earlier turns pay off later (callback, escalation, shifted meaning).

Return ONLY a JSON object: {"narrative_cohesion": score} with no prose.`;

  const user = `Scenario: ${scenario.name}
${scenario.description}

Earlier turn (pulse ${prior.pulseIndex}):
${turnTranscript(prior.group)}

This turn (pulse ${turn.pulseIndex}):
${turnTranscript(turn.group)}`;

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: config.temperature ?? 1,
      max_tokens: 120,
    }),
    signal: AbortSignal.timeout(config.timeoutMs ?? 60000),
  });

  if (!res.ok) {
    throw new Error(`Cohesion judge HTTP ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = data.choices?.[0]?.message?.content ?? "";
  const jsonText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const parsed = JSON.parse(jsonText) as { narrative_cohesion?: number };
  const v = parsed.narrative_cohesion;
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
