import type { CoreMood, SocialEmotions, RelationalState, EmotionalState } from "../emotion/emotion.types.js";
import type { Memory } from "../memory/memory.types.js";
import type { InitiativeAccumulator } from "../initiative/initiative.types.js";
import type { PerceptionPacket } from "../perception/perception.types.js";
import type { Motivation } from "../motivation/motivation.types.js";
import type { Pressure, PressureType } from "../pressure/pressure.types.js";
import type { Inhibition } from "../inhibition/inhibition.types.js";
import type { AvailableAction } from "../action/action.types.js";
import type { TriggeringReason } from "../attention/attention.types.js";

export type PresenceMode =
  | "active"
  | "semi_active"
  | "lurking"
  | "busy_elsewhere"
  | "avoidant"
  | "offline";

export type BudgetPriority = "high" | "normal" | "low" | "blocked";

/** Persisted agent state — written every pulse */
export type AgentState = {
  agentId: string;
  simulationId: string;
  personaId: string;
  presence: PresenceMode;
  coreMood: CoreMood;
  socialEmotions: SocialEmotions;
  relationalStates: Map<string, RelationalState>;
  memories: Memory[];
  initiativeAccumulators: InitiativeAccumulator[];
  lastProcessedEventId: string | null;
  lastActionAt: number | null;
  lastRuminationPulse: number | null;
  arrivalPulse: number | null;       // pulse index when agent joins; null = present from start
  /**
   * Pulse index of the last committed outward act that expressed each urge
   * (ADR-0016 pressure discharge). Acting spends the urge; it refills over
   * PRESSURE_REFRACTORY_PULSES. Optional: absent means never discharged.
   */
  pressureDischargedAt?: Partial<Record<PressureType, number>>;
  createdAt: number;
  updatedAt: number;
};

/** Persona calibration constants — loaded from shared constants */
export type PersonaConfig = {
  id: string;
  name: string;
  archetype: string;
  writingStyle: string;
  styleExamples: string[];
  // Mood configuration
  baselineValence: number;
  baselineArousal: number;
  baselineStability: number;
  baselineEnergy: number;
  emotionalReactivity: number;
  moodInertia: number;
  maxMoodRotation: number; // radians
  energyRegen: number;
  // Sensitivities
  exclusionSensitivity: number;
  praiseSensitivity: number;
  conflictSensitivity: number;
  boredomSensitivity: number;
  intimacySensitivity: number;
  // Social emotion sensitivities (15)
  socialSensitivities: Record<string, number>;
};

/** Seed state for agent at simulation start */
export type AgentSeedState = {
  personaId: string;
  initialCoreMood: CoreMood;
  initialSocialEmotions: SocialEmotions;
  initialRelationalStates: Map<string, RelationalState>;
  arrivalDelayPulses: number; // cold-start stagger
};

/** Input to AgentRuntime.generateIntent — assembled by dev2 from EngineStepResult */
export type AgentRuntimeInput = {
  simulationId: string;
  agentId: string;
  personaConfig: PersonaConfig;
  perceptionPacket: PerceptionPacket;
  emotionalState: EmotionalState;
  activeMotivations: Motivation[];
  activePressures: Pressure[];
  activeInhibitions: Inhibition[];
  relevantMemories: Memory[];
  availableActions: AvailableAction[];
  budgetPriority: BudgetPriority;
  triggeringReason: TriggeringReason;
  /**
   * Whether this agent has already committed an outward act this run
   * (`lastActionAt !== null`). Gates the scenario entrance instructions;
   * absent means "not yet" so older fixtures keep rendering them.
   */
  hasActed?: boolean;
  /** ADR-0017: the engine would have held this agent back; the model is asked to voice the hold or break it. */
  holdSuggested?: boolean;
};
