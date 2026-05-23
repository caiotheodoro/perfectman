/**
 * Internal helpers for fixture construction.
 * Not exported from the package root — only used by fixture builders.
 */
import type { AgentState, CoreMood, SocialEmotions, RelationalState, CommittedEvent, EventVisibility, Channel, ChannelMembership, Simulation, SimulationSettings, Memory } from "../index.js";
export declare const DEFAULT_SETTINGS: SimulationSettings;
export declare const NEUTRAL_MOOD: CoreMood;
export declare const ZERO_SOCIAL: SocialEmotions;
export declare function makeAgentState(agentId: string, simulationId: string, personaId: string, moodOverride?: Partial<CoreMood>, socialOverride?: Partial<SocialEmotions>, relationalStates?: Map<string, RelationalState>): AgentState;
export declare function makeRelationalState(targetAgentId: string, overrides?: Partial<RelationalState>): RelationalState;
export declare function makeCommittedEvent(simulationId: string, channelId: string, actorId: string, type: CommittedEvent["type"], payload?: Record<string, unknown>, pulseIndex?: number, visibilityOverride?: Partial<EventVisibility>): CommittedEvent;
export declare function makePublicChannel(id: string, simulationId: string, name: string, memberAgentIds: string[]): Channel;
export declare function makePrivateChannel(id: string, simulationId: string, name: string, createdBy: string, memberAgentIds: string[], motives?: string[]): Channel;
export declare function membershipFor(channelId: string, agentIds: string[]): ChannelMembership[];
export declare function makeSimulation(id: string, name: string, agentIds: string[], channelIds: string[], settingsOverride?: Partial<SimulationSettings>): Simulation;
export declare function makeMemory(id: string, agentId: string, simulationId: string, type: Memory["type"], subjectAgentIds: string[], summary: string, emotionalTone?: Memory["emotionalTone"], confidence?: number): Memory;
//# sourceMappingURL=helpers.d.ts.map