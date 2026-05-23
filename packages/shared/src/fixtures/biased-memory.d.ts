/**
 * buildBiasedMemoryScenario
 * Goulart is in a negative mood. He has both positive and negative memories of Caio.
 * Mood-congruent retrieval bias: negative memories should rank higher in the perception packet.
 *
 * Expected engine signals:
 * - perceptionPacket.relevantMemories: negative memories appear before positive ones
 *   when Goulart is in negative valence state
 * - The bias is purely from mood state, not from memory age/recency
 */
import type { Simulation, Channel, ChannelMembership, AgentState, PersonaConfig, CommittedEvent, Memory } from "../index.js";
export type BiasedMemoryScenario = {
    simulation: Simulation;
    channels: Channel[];
    memberships: ChannelMembership[];
    personas: {
        goulart: PersonaConfig;
        caio: PersonaConfig;
    };
    agentStates: {
        goulart: AgentState;
        caio: AgentState;
    };
    /** Goulart's mixed memories of Caio */
    goulartMemories: Memory[];
    /** Caio said something to Goulart — triggers memory retrieval */
    committedEvents: CommittedEvent[];
    expectedSignals: {
        negativeMemoriesShouldRankHigherInNegativeMood: boolean;
        positiveMemoriesShouldRankHigherInPositiveMood: boolean;
    };
};
export declare function buildBiasedMemoryScenario(): BiasedMemoryScenario;
//# sourceMappingURL=biased-memory.d.ts.map