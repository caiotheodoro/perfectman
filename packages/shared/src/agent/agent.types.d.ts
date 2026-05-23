import type { CoreMood, SocialEmotions, RelationalState, EmotionalState } from "../emotion/emotion.types.js";
import type { Memory } from "../memory/memory.types.js";
import type { InitiativeAccumulator } from "../initiative/initiative.types.js";
import type { PerceptionPacket } from "../perception/perception.types.js";
import type { Motivation } from "../motivation/motivation.types.js";
import type { Pressure } from "../pressure/pressure.types.js";
import type { Inhibition } from "../inhibition/inhibition.types.js";
import type { AvailableAction } from "../action/action.types.js";
import type { TriggeringReason } from "../attention/attention.types.js";
export type PresenceMode = "active" | "semi_active" | "lurking" | "busy_elsewhere" | "avoidant" | "offline";
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
    baselineValence: number;
    baselineArousal: number;
    baselineStability: number;
    baselineEnergy: number;
    emotionalReactivity: number;
    moodInertia: number;
    maxMoodRotation: number;
    energyRegen: number;
    exclusionSensitivity: number;
    praiseSensitivity: number;
    conflictSensitivity: number;
    boredomSensitivity: number;
    intimacySensitivity: number;
    socialSensitivities: Record<string, number>;
};
/** Seed state for agent at simulation start */
export type AgentSeedState = {
    personaId: string;
    initialCoreMood: CoreMood;
    initialSocialEmotions: SocialEmotions;
    initialRelationalStates: Map<string, RelationalState>;
    arrivalDelayPulses: number;
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
};
//# sourceMappingURL=agent.types.d.ts.map