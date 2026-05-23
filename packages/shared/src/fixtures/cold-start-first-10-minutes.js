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
import { GOULART, ALL_PERSONAS } from "../constants/personas.js";
import { makeSimulation, makePublicChannel, membershipFor, makeAgentState, } from "./helpers.js";
export function buildGoulartColdStartScenario() {
    const simulationId = "sim_cold_start";
    const channelId = "ch_geral";
    const simulation = makeSimulation(simulationId, "Cold Start — Goulart First", ALL_PERSONAS.map(p => p.id), [channelId]);
    const channel = makePublicChannel(channelId, simulationId, "#geral", ["goulart"]);
    const memberships = membershipFor(channelId, ["goulart"]);
    // Goulart: low arousal (boredom), above-neutral energy — ready to initiate
    const goulartState = makeAgentState("goulart", simulationId, "goulart", {
        valence: GOULART.baselineValence,
        arousal: 0.15, // bored — below baseline
        stability: 0.8,
        energy: 0.7,
    }, {}, new Map());
    // Seed Goulart with a healthy boredom initiative accumulator
    goulartState.initiativeAccumulators = [
        {
            source: "boredom_accumulator",
            value: 0.75, // above threshold (0.6)
            threshold: 0.6,
            growthRate: 0.08,
            decayRate: 0.02,
            lastFiredAt: null,
        },
    ];
    // Others not yet arrived
    const others = ALL_PERSONAS.filter(p => p.id !== "goulart");
    const otherStates = others.map(persona => makeAgentState(persona.id, simulationId, persona.id, {}, {}, new Map()));
    for (const s of otherStates) {
        s.presence = "offline";
    }
    return {
        simulation,
        channels: [channel],
        memberships,
        goulartPersona: GOULART,
        goulartState,
        otherPersonas: others,
        otherStates,
        committedEvents: [],
        expectedSignals: {
            goulartHasHighBoredomInitiative: true,
            otherAgentsOffline: true,
            channelIsEmpty: true,
        },
    };
}
//# sourceMappingURL=cold-start-first-10-minutes.js.map