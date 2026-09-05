/**
 * SQLite implementation of IAgentStateRepository.
 * AgentState.relationalStates is a Map — serialized as JSON array of entries.
 */

import type { AgentState, RelationalState, PresenceMode } from "@perfectman/shared";
import type { IAgentStateRepository } from "../repositories.js";
import type { DB } from "./database.js";

type AgentStateRow = {
  agent_id: string;
  simulation_id: string;
  persona_id: string;
  presence: string;
  core_mood: string;
  social_emotions: string;
  relational_states: string;
  memories: string;
  initiative_accumulators: string;
  last_processed_event_id: string | null;
  last_action_at: number | null;
  last_rumination_pulse: number | null;
  arrival_pulse: number | null;
  pressure_discharged_at: string | null;
  created_at: number;
  updated_at: number;
};

/** Serialize Map<string, RelationalState> → JSON array of [key, value] tuples */
function serializeRelationalStates(map: Map<string, RelationalState>): string {
  return JSON.stringify([...map.entries()]);
}

/** Deserialize JSON array of [key, value] tuples → Map<string, RelationalState> */
function deserializeRelationalStates(json: string): Map<string, RelationalState> {
  const entries = JSON.parse(json) as [string, RelationalState][];
  return new Map(entries);
}

function rowToAgentState(row: AgentStateRow): AgentState {
  return {
    agentId: row.agent_id,
    simulationId: row.simulation_id,
    personaId: row.persona_id,
    presence: row.presence as PresenceMode,
    coreMood: JSON.parse(row.core_mood),
    socialEmotions: JSON.parse(row.social_emotions),
    relationalStates: deserializeRelationalStates(row.relational_states),
    memories: JSON.parse(row.memories),
    initiativeAccumulators: JSON.parse(row.initiative_accumulators),
    lastProcessedEventId: row.last_processed_event_id,
    lastActionAt: row.last_action_at,
    lastRuminationPulse: row.last_rumination_pulse ?? null,
    arrivalPulse: row.arrival_pulse ?? null,
    ...(row.pressure_discharged_at ? { pressureDischargedAt: JSON.parse(row.pressure_discharged_at) as AgentState["pressureDischargedAt"] } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteAgentStateRepository implements IAgentStateRepository {
  constructor(private readonly db: DB) {}

  get(simulationId: string, agentId: string): Promise<AgentState | null> {
    const row = this.db
      .prepare(`SELECT * FROM agent_states WHERE simulation_id = ? AND agent_id = ?`)
      .get(simulationId, agentId) as AgentStateRow | undefined;

    return Promise.resolve(row ? rowToAgentState(row) : null);
  }

  upsert(agentState: AgentState): Promise<void> {
    const now = Date.now();

    this.db
      .prepare(
        `INSERT INTO agent_states
           (agent_id, simulation_id, persona_id, presence,
            core_mood, social_emotions, relational_states, memories,
            initiative_accumulators, last_processed_event_id, last_action_at,
            last_rumination_pulse, arrival_pulse, pressure_discharged_at,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent_id, simulation_id) DO UPDATE SET
           persona_id                = excluded.persona_id,
           presence                  = excluded.presence,
           core_mood                 = excluded.core_mood,
           social_emotions           = excluded.social_emotions,
           relational_states         = excluded.relational_states,
           memories                  = excluded.memories,
           initiative_accumulators   = excluded.initiative_accumulators,
           last_processed_event_id   = excluded.last_processed_event_id,
           last_action_at            = excluded.last_action_at,
           last_rumination_pulse     = excluded.last_rumination_pulse,
           arrival_pulse             = excluded.arrival_pulse,
           pressure_discharged_at    = excluded.pressure_discharged_at,
           updated_at                = excluded.updated_at`,
      )
      .run(
        agentState.agentId,
        agentState.simulationId,
        agentState.personaId,
        agentState.presence,
        JSON.stringify(agentState.coreMood),
        JSON.stringify(agentState.socialEmotions),
        serializeRelationalStates(agentState.relationalStates),
        JSON.stringify(agentState.memories),
        JSON.stringify(agentState.initiativeAccumulators),
        agentState.lastProcessedEventId,
        agentState.lastActionAt,
        agentState.lastRuminationPulse,
        agentState.arrivalPulse,
        agentState.pressureDischargedAt ? JSON.stringify(agentState.pressureDischargedAt) : null,
        agentState.createdAt,
        agentState.updatedAt ?? now,
      );

    return Promise.resolve();
  }

  listBySimulation(simulationId: string): Promise<AgentState[]> {
    const rows = this.db
      .prepare(`SELECT * FROM agent_states WHERE simulation_id = ? ORDER BY created_at ASC`)
      .all(simulationId) as AgentStateRow[];

    return Promise.resolve(rows.map(rowToAgentState));
  }
}
