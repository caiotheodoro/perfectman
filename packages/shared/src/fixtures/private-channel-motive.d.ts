/**
 * buildPrivateChannelMotiveScenario
 * Mariana has high affection + admiration for Caio, but public shame/anxiety
 * inhibits direct public approach. A private channel becomes the only comfortable path.
 *
 * Expected engine signals:
 * - mariana.socialEmotions.affection high
 * - mariana.socialEmotions.socialAnxiety blocking public interaction
 * - motivation: "attraction" or "comfort" ranked high
 * - availableActions includes create_channel with private_channel type
 * - decision.outcome = "act" with create_channel intent
 */
import type { Simulation, Channel, ChannelMembership, AgentState, PersonaConfig, CommittedEvent } from "../index.js";
export type PrivateChannelMotiveScenario = {
    simulation: Simulation;
    channels: Channel[];
    memberships: ChannelMembership[];
    personas: {
        mariana: PersonaConfig;
        caio: PersonaConfig;
    };
    agentStates: {
        mariana: AgentState;
        caio: AgentState;
    };
    committedEvents: CommittedEvent[];
    expectedSignals: {
        marianaWantsPrivateChannelWithCaio: boolean;
        shameBlocksPublicApproach: boolean;
        createChannelActionAvailable: boolean;
    };
};
export declare function buildPrivateChannelMotiveScenario(): PrivateChannelMotiveScenario;
//# sourceMappingURL=private-channel-motive.d.ts.map