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
  | "calibration";         // neutral scenes used to calibrate judge/bounds

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

/** Deterministic, engine-measurable expectations (probe layer). */
export type ExpectedSignal =
  | { kind: "emotion_rises"; agentId: string; field: string; min?: number }
  | { kind: "emotion_stays"; agentId: string; field: string; min?: number }
  | { kind: "event_committed"; eventType: string; min?: number }
  | { kind: "no_event_of_type"; eventType: string }
  | { kind: "llm_calls_range"; agentId: string; min: number; max: number }
  | { kind: "no_llm_failures" }
  | { kind: "private_channel_created"; byAgentId: string };

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
