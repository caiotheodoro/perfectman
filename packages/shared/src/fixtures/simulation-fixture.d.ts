/**
 * buildSimulationFixture
 * Basic 5-agent simulation with one public #geral channel.
 * Suitable as a starting canvas for most test scenarios.
 */
import type { Simulation, Channel, ChannelMembership, AgentState, PersonaConfig } from "../index.js";
export type SimulationFixture = {
    simulation: Simulation;
    channels: Channel[];
    memberships: ChannelMembership[];
    personas: PersonaConfig[];
    agentStates: AgentState[];
};
/**
 * 5 agents in a single public channel.
 * All agents are active with near-neutral baseline moods.
 */
export declare function buildSimulationFixture(): SimulationFixture;
//# sourceMappingURL=simulation-fixture.d.ts.map