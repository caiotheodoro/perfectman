/**
 * buildGoulartColdStartScenario
 * Goulart arrives in an empty #geral channel.
 * Boredom + initiative accumulates until he sends the first message.
 *
 * Expected engine signals:
 * - goulart.coreMood.arousal low (boredom)
 * - goulart.initiativeAccumulators: boredom source accumulating
 * - Other agents: offline or not yet arrived
 * - After engine step: decision.outcome = "act", triggeringReason = "initiative"
 */
import type { Simulation, Channel, ChannelMembership, AgentState, PersonaConfig, CommittedEvent } from "../index.js";
export type GoulartColdStartScenario = {
    simulation: Simulation;
    channels: Channel[];
    memberships: ChannelMembership[];
    goulartPersona: PersonaConfig;
    goulartState: AgentState;
    otherPersonas: PersonaConfig[];
    otherStates: AgentState[];
    /** Empty — no messages yet. Channel just opened. */
    committedEvents: CommittedEvent[];
    /**
     * Expected signals from engine step:
     * - goulart initiative should accumulate (boredom source)
     * - decision.outcome will be "act" once threshold crossed
     * - triggeringReason = "initiative"
     */
    expectedSignals: {
        goulartHasHighBoredomInitiative: boolean;
        otherAgentsOffline: boolean;
        channelIsEmpty: boolean;
    };
};
export declare function buildGoulartColdStartScenario(): GoulartColdStartScenario;
//# sourceMappingURL=cold-start-first-10-minutes.d.ts.map