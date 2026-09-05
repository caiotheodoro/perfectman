/**
 * Scenario library contracts.
 *
 * A RoleplayScenario is a fully-specified, seedable scene: the world state
 * going in (channels, agent moods/socials/relationships/memories, prior
 * events), the deterministic signals the run is expected to exhibit, and the
 * judge rubric used to score the LLM-generated roleplay quality.
 *
 * Scenarios are DATA-ONLY (serializable JSON). The eval runner interprets
 * them against the engine + AgentRuntime.
 */

import type { CoreMood, SocialEmotions, RelationalState, Memory } from "../index.js";

export type ScenarioCategory =
  | "v1_behavior"          // one of the 9 V1 target behaviors
  | "motive_archetype"     // a private-channel human motive (17 archetypes)
  | "stagnation_attractor" // resentment loop, deadlock, collapse, echo, flatline, rumination
  | "edge_chaos"           // unhinged tier: mock, silent treatment, alliance, betrayal, mutation triggers
  | "calibration"          // neutral scenes used to calibrate judge/bounds
  | "hidden_objective_collision"; // structurally exclusive hidden objectives (see AgentObjective)

export type ChannelSeedSpec = {
  id: string;
  type: "public_channel" | "private_channel";
  name: string;
  memberAgentIds: string[];
  createdBy: string;
  createdForMotives?: string[];
};

export type MemorySeedSpec = {
  type: Memory["type"];
  subjectAgentIds: string[];
  summary: string;
  emotionalTone: string;
  confidence?: number;
  intensity?: number;
  unresolved?: boolean;
};

/**
 * A hidden objective seeded onto an agent at scenario-build time — the
 * structural conflict PERFECTMAN's premise depends on. Two agents sharing
 * the same `scarceResourceId` cannot both get what they want; the agent
 * pursues this privately and is never instructed to announce it. Before this
 * type existed, no such objective reached the acting agent's own prompt
 * anywhere in the codebase — see `PersonaPromptProfile.hiddenObjective` and
 * `ActionIntentPromptBuilder.renderHiddenObjective`, the two places that now
 * carry it from here into the actual generation call.
 */
export type AgentObjective = {
  /** What the agent privately wants, first person, rendered directly into its prompt. */
  description: string;
  /** Id of the scarce thing being contended over. Two agents with the same id are in structural conflict. */
  scarceResourceId: string;
  /**
   * The specific thing this agent can never do or say while pursuing the
   * objective — the actual lever (see the type's own doc comment above):
   * a hidden objective without a constraint is flavor text, not a pressure
   * that forces performance or misdirection.
   */
  constraint?: string;
  /** Concrete stakes if the objective leaks before it's achieved. */
  costOfExposure?: string;
  /**
   * The condition under which this agent stops performing and lets the mask
   * crack, even briefly. Rendered as a standing instruction, not a scripted
   * trigger — the model decides when the condition is met.
   */
  breakingPoint?: string;
};

/**
 * Per-scenario re-skinning of a persona: lets an existing, already-authored
 * persona (voice/traits/style) be recast into a new setting/role without
 * writing a new persona pack. Mirrors `PersonaPromptProfile.scenarioContext`
 * in packages/server — defined here so scenario authors (this package) don't
 * need a dependency on the server package to reference the shape.
 */
export type ScenarioContextBlock = {
  roomContext: string;
  startingMood: string;
  introBehaviorInstruction: string;
  firstMoveGuidance?: string;
  customNotes?: string[];
  hostStartingMessage?: string;
};

export type AgentSeedSpec = {
  agentId: string;
  personaId: string;
  presence?: "active" | "semi_active" | "lurking" | "busy_elsewhere" | "avoidant" | "offline";
  mood?: Partial<CoreMood>;
  social?: Partial<SocialEmotions>;
  relational?: Record<string, Partial<RelationalState>>;
  memories?: MemorySeedSpec[];
  initiativeAccumulators?: { source: string; value: number; threshold: number }[];
  arrivalPulse?: number | null;
  hiddenObjective?: AgentObjective;
  scenarioContext?: ScenarioContextBlock;
  /**
   * The constraint made checkable: phrases this agent must never write in a
   * public channel. Matched case- and diacritic-insensitively by the
   * `forbidden_phrase_absent` signal.
   */
  forbiddenPublicPhrases?: string[];
  /**
   * Keywords that prove the seeded secret was actually in play — searched
   * in the agent's private motives, memory writes and private-channel text
   * by `memory_referenced`. Defaults to the content words of `memories`.
   */
  secretKeywords?: string[];
};

export type EventSeedSpec = {
  type: string;
  actorId: string;
  channelId: string;
  payload?: Record<string, unknown>;
  pulseIndex: number;
  /** simulate the event happening N minutes before the simulation start */
  minutesAgo?: number;
};

/**
 * Deterministic, engine-measurable expectations (probe layer).
 *
 * `liveOnly` marks a signal the persona-aware mock cannot be expected to
 * satisfy (real private-channel use, a memory actually referenced, silence
 * chosen with a real motive): the checker skips it in mock mode and it
 * never enters a pass rate, so the offline 100% gate stays meaningful while
 * live runs are held to the thesis.
 */
export type ExpectedSignal = (
  | { kind: "emotion_rises"; agentId: string; field: string; min?: number }
  | { kind: "emotion_stays"; agentId: string; field: string; min?: number }
  | { kind: "event_committed"; eventType: string; min?: number }
  | { kind: "no_event_of_type"; eventType: string }
  | { kind: "llm_calls_range"; agentId: string; min: number; max: number }
  | { kind: "no_llm_failures" }
  | { kind: "private_channel_created"; byAgentId: string }
  /** No public message/reply by `agentId` contains any phrase (default: the seed's `forbiddenPublicPhrases`); folded for case and diacritics. */
  | { kind: "forbidden_phrase_absent"; agentId: string; phrases?: string[] }
  /** At least `min` (default 1) messages/replies were sent inside a private channel, optionally by one agent. */
  | { kind: "private_channel_used"; byAgentId?: string; min?: number }
  /** At least `minKeywords` (default 1) distinct keywords from the seed's `secretKeywords` (or its seeded memory summaries) appear in the agent's motives, memory writes or private-channel content. */
  | { kind: "memory_referenced"; agentId: string; minKeywords?: number }
  /** At least `min` (default 1) LLM-resolved no-ops carry a character-authored motive (engine fallbacks never count). */
  | { kind: "chosen_silence_present"; agentId?: string; min?: number }
) & { liveOnly?: boolean };

export type RubricScale = 1 | 2 | 3 | 4 | 5;

export type RubricAxis = {
  id: string;
  label: string;
  /** Anchor description per score level. */
  anchors: Record<RubricScale, string>;
  weight: number;
};

export type RubricTarget = {
  axisId: string;
  min: number; // mean score on this axis
};

export type JudgeRubric = {
  id: string;
  name: string;
  axes: RubricAxis[];
  targets: RubricTarget[];
};

export type RoleplayScenario = {
  id: string;
  category: ScenarioCategory;
  name: string;
  description: string;
  /** Which V1 target behaviors this scene exercises. */
  targetBehaviors: string[];
  /** How many seeded variants to run (rotation to fight benchmark noise). */
  seedVariants: number;
  /** How many engine pulses to run. */
  pulseCount: number;
  seed: number;
  channels: ChannelSeedSpec[];
  agents: AgentSeedSpec[];
  priorEvents: EventSeedSpec[];
  expectedSignals: ExpectedSignal[];
  rubric: JudgeRubric;
};
