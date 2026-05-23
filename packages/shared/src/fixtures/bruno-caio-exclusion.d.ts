/**
 * buildBrunoCaioExclusionScenario
 * Caio replies to Goulart's message, ignoring Bruno's previous message.
 * Bruno experiences exclusion cascade: fearOfExclusion rises, resentment builds.
 *
 * Expected engine signals:
 * - bruno.socialEmotions.fearOfExclusion elevated
 * - bruno.socialEmotions.resentment rising
 * - bruno.relationalStates["caio"].trust decreasing
 * - Bruno's available actions include reply_to_message (to continue bidding)
 * - Decision might yield delay or act depending on inhibition
 */
import type { Simulation, Channel, ChannelMembership, AgentState, PersonaConfig, CommittedEvent } from "../index.js";
export type BrunoCaioExclusionScenario = {
    simulation: Simulation;
    channels: Channel[];
    memberships: ChannelMembership[];
    personas: {
        bruno: PersonaConfig;
        caio: PersonaConfig;
        goulart: PersonaConfig;
    };
    agentStates: {
        bruno: AgentState;
        caio: AgentState;
        goulart: AgentState;
    };
    /** The key events: Bruno's message → Caio ignores and replies to Goulart */
    committedEvents: CommittedEvent[];
    expectedSignals: {
        brunoFearOfExclusionShouldRise: boolean;
        brunoResentmentTowardCaioShouldRise: boolean;
        brunoVisibleEventShouldShowIgnore: boolean;
    };
};
export declare function buildBrunoCaioExclusionScenario(): BrunoCaioExclusionScenario;
//# sourceMappingURL=bruno-caio-exclusion.d.ts.map