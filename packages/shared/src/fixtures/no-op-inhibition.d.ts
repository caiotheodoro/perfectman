/**
 * buildNoOpInhibitionScenario
 * Bruno witnesses Goulart mock him publicly (high humiliation event).
 * Shame + fear + high social anxiety produce overwhelming inhibition.
 * Engine should yield no_op with a meaningful private motive seed.
 *
 * Expected engine signals:
 * - bruno.socialEmotions.shame > 0.7
 * - bruno.socialEmotions.humiliation elevated
 * - decision.outcome = "no_op"
 * - decision.noOpReason involves shame/inhibition
 * - decision.privateMotiveSeed is non-empty (tells story of why silent)
 */
import type { Simulation, Channel, ChannelMembership, AgentState, PersonaConfig, CommittedEvent } from "../index.js";
export type NoOpInhibitionScenario = {
    simulation: Simulation;
    channels: Channel[];
    memberships: ChannelMembership[];
    personas: {
        bruno: PersonaConfig;
        goulart: PersonaConfig;
        caio: PersonaConfig;
    };
    agentStates: {
        bruno: AgentState;
        goulart: AgentState;
        caio: AgentState;
    };
    /** The humiliating exchange bruno witnessed */
    committedEvents: CommittedEvent[];
    expectedSignals: {
        brunoShouldNoOp: boolean;
        shameIsOverwhelming: boolean;
        privateMotiveSeedIsNonEmpty: boolean;
    };
};
export declare function buildNoOpInhibitionScenario(): NoOpInhibitionScenario;
//# sourceMappingURL=no-op-inhibition.d.ts.map