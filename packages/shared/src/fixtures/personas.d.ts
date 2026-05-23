/**
 * buildFivePersonaSeedFixture
 * Returns all 5 PersonaConfigs with freshly-seeded AgentState objects.
 */
import type { AgentState, PersonaConfig } from "../index.js";
export type PersonaSeedEntry = {
    persona: PersonaConfig;
    agentState: AgentState;
};
/**
 * Returns [{persona, agentState}] for all 5 canonical personas,
 * ready to drop into a simulation fixture.
 *
 * @param simulationId - the sim they belong to
 */
export declare function buildFivePersonaSeedFixture(simulationId: string): PersonaSeedEntry[];
//# sourceMappingURL=personas.d.ts.map