/**
 * buildFivePersonaSeedFixture
 * Returns all 5 PersonaConfigs with freshly-seeded AgentState objects.
 */
import { ALL_PERSONAS } from "../constants/personas.js";
import { makeAgentState } from "./helpers.js";
/**
 * Returns [{persona, agentState}] for all 5 canonical personas,
 * ready to drop into a simulation fixture.
 *
 * @param simulationId - the sim they belong to
 */
export function buildFivePersonaSeedFixture(simulationId) {
    return ALL_PERSONAS.map(persona => ({
        persona,
        agentState: makeAgentState(persona.id, simulationId, persona.id, {
            valence: persona.baselineValence,
            arousal: persona.baselineArousal,
            stability: persona.baselineStability,
            energy: persona.baselineEnergy,
        }),
    }));
}
//# sourceMappingURL=personas.js.map