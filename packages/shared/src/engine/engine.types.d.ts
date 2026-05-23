import type { Simulation, SimulationSettings } from "../simulation/simulation.types.js";
import type { Channel, ChannelMembership } from "../channel/channel.types.js";
import type { CommittedEvent } from "../event/event.types.js";
import type { AgentState, PersonaConfig } from "../agent/agent.types.js";
import type { RelationalState, ActionEmotions, EmotionDelta } from "../emotion/emotion.types.js";
import type { AttentionResult } from "../attention/attention.types.js";
import type { PerceptionPacket } from "../perception/perception.types.js";
import type { Interpretation } from "../interpretation/interpretation.types.js";
import type { Motivation } from "../motivation/motivation.types.js";
import type { Pressure } from "../pressure/pressure.types.js";
import type { Inhibition } from "../inhibition/inhibition.types.js";
import type { Decision, NoOpRecord } from "../decision/decision.types.js";
import type { AvailableAction } from "../action/action.types.js";
import type { InitiativeCandidate } from "../initiative/initiative.types.js";
import type { MemoryWriteProposal } from "../memory/memory.types.js";
import type { OperatorMetrics } from "../operator/operator.types.js";
import type { SeededRng } from "../utils/rng.js";
/** Stateful rate-limiting info — computed by dev2, passed to engine via snapshot */
export type RateLimitStatus = {
    agentId: string;
    messagesThisMinute: number;
    privateChannelsCreated: number;
    lastActionAt: number | null;
    blocked: boolean;
    blockReason?: string;
};
/** Context signals about the world visible to an agent this pulse */
export type WorldSignals = {
    highArousalNearby: boolean;
    averageChannelArousal: number;
    activeAgentCount: number;
    timeSinceLastPublicMessage: number;
    channelMessageRatePerMinute: number;
    recentTopicShift: boolean;
};
/** Immutable snapshot passed to RunEngineStep — assembled by dev2 scheduler */
export type EngineSnapshot = {
    pulseIndex: number;
    simulation: Simulation;
    committedEvents: CommittedEvent[];
    agentState: AgentState;
    persona: PersonaConfig;
    channels: Channel[];
    channelMembership: ChannelMembership[];
    relationalStates: Map<string, RelationalState>;
    worldSignals: WorldSignals;
    rateLimitStatus: RateLimitStatus;
    dt: number;
    rng: SeededRng;
};
/** Output of RunEngineStep — pure, no side effects */
export type EngineStepResult = {
    visibleEvents: CommittedEvent[];
    newEvents: CommittedEvent[];
    attentionResults: AttentionResult;
    perceptionPacket: PerceptionPacket;
    interpretations: Interpretation[];
    emotionDelta: EmotionDelta;
    updatedAgentState: AgentState;
    motivations: Motivation[];
    pressures: Pressure[];
    inhibitions: Inhibition[];
    actionEmotions: ActionEmotions;
    decision: Decision;
    availableActions: AvailableAction[];
    initiativeCandidates: InitiativeCandidate[];
    memoryProposals: MemoryWriteProposal[];
    noOpRecord: NoOpRecord | null;
    operatorMetrics: OperatorMetrics;
};
/** Type alias for the primary engine entry point */
export type RunEngineStep = (snapshot: EngineSnapshot) => EngineStepResult;
/** Pure intent validator — called by dev2 IntentResolver */
export type ValidateIntentPureFn = (intent: import("../intent/intent.types.js").ActionIntent, availableActions: AvailableAction[], agentState: AgentState, settings: SimulationSettings) => import("../intent/intent.types.js").IntentValidationResult;
//# sourceMappingURL=engine.types.d.ts.map