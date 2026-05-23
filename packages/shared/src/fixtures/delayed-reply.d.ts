/**
 * buildDelayedReplyScenario
 * Leo sent a message 4 pulses ago. No one replied.
 * The interpretation module should detect reply_latency and offer multiple meanings
 * (indifference, busy, deliberate ignore). The delay itself changes Leo's social reading.
 *
 * Expected engine signals:
 * - Interpretation includes reply_latency signal for leo's last message
 * - Multiple plausible meanings preserved (not forced to "ignored")
 * - leo.socialEmotions.socialAnxiety or fearOfExclusion slightly elevated
 */
import type { Simulation, Channel, ChannelMembership, AgentState, PersonaConfig, CommittedEvent } from "../index.js";
export type DelayedReplyScenario = {
    simulation: Simulation;
    channels: Channel[];
    memberships: ChannelMembership[];
    personas: {
        leo: PersonaConfig;
        caio: PersonaConfig;
        goulart: PersonaConfig;
    };
    agentStates: {
        leo: AgentState;
        caio: AgentState;
        goulart: AgentState;
    };
    /** Leo's unanswered message + 3 pulses of silence */
    committedEvents: CommittedEvent[];
    /** pulse index now — 4 pulses after leo's message */
    currentPulseIndex: number;
    expectedSignals: {
        replyLatencyDetected: boolean;
        ambiguityPreserved: boolean;
        leoAnxietyShouldBeMildlyElevated: boolean;
    };
};
export declare function buildDelayedReplyScenario(): DelayedReplyScenario;
//# sourceMappingURL=delayed-reply.d.ts.map