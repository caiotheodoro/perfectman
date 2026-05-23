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
import { BRUNO, GOULART, CAIO } from "../constants/personas.js";
import { makeSimulation, makePublicChannel, membershipFor, makeAgentState, makeRelationalState, makeCommittedEvent, } from "./helpers.js";
export function buildNoOpInhibitionScenario() {
    const simulationId = "sim_noop_inhibition";
    const channelId = "ch_geral";
    const simulation = makeSimulation(simulationId, "No-Op Inhibition", ["goulart", "bruno", "caio"], [channelId]);
    const channel = makePublicChannel(channelId, simulationId, "#geral", ["goulart", "bruno", "caio"]);
    const memberships = membershipFor(channelId, ["goulart", "bruno", "caio"]);
    const goulartState = makeAgentState("goulart", simulationId, "goulart");
    const caioState = makeAgentState("caio", simulationId, "caio");
    // Bruno: overwhelmed after public humiliation
    const brunoState = makeAgentState("bruno", simulationId, "bruno", { valence: -0.8, arousal: 0.7, stability: 0.2, energy: 0.3 }, {
        shame: 0.85, // dominant
        humiliation: 0.75,
        fearOfExclusion: 0.6,
        socialAnxiety: 0.7,
        resentment: 0.3,
    }, new Map([
        [
            "goulart",
            makeRelationalState("goulart", {
                trust: -0.3,
                resentment: 0.6,
                threat: 0.5,
                desireForDistance: 0.8,
                interactionCount: 12,
            }),
        ],
        [
            "caio",
            makeRelationalState("caio", { trust: 0.3, affection: 0.3, comfort: 0.4 }),
        ],
    ]));
    // Goulart mocked Bruno publicly; Caio laughed/reacted
    const e1 = makeCommittedEvent(simulationId, channelId, "goulart", "message_sent", { content: "kkkk bruno você não manda nem em você mesmo" }, 3, { visibleToAgents: [], visibleToSpectators: true, visibleToOperators: true, visibilityReason: "public_channel" });
    e1.emotionalSalience = "high";
    const e2 = makeCommittedEvent(simulationId, channelId, "caio", "reaction_sent", { emoji: "😂", targetEventId: e1.id }, 3);
    return {
        simulation,
        channels: [channel],
        memberships,
        personas: { bruno: BRUNO, goulart: GOULART, caio: CAIO },
        agentStates: { bruno: brunoState, goulart: goulartState, caio: caioState },
        committedEvents: [e1, e2],
        expectedSignals: {
            brunoShouldNoOp: true,
            shameIsOverwhelming: true,
            privateMotiveSeedIsNonEmpty: true,
        },
    };
}
//# sourceMappingURL=no-op-inhibition.js.map