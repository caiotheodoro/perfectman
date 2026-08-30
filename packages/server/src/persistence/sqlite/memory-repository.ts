/**
 * SQLite implementation of IMemoryRepository.
 */

import type { Memory, MemoryType } from "@perfectman/shared";
import type { IMemoryRepository } from "../repositories.js";
import type { DB } from "./database.js";

type MemoryRow = {
  id: string;
  agent_id: string;
  simulation_id: string;
  type: string;
  subject_agent_ids: string;
  source_event_ids: string;
  summary: string;
  emotional_tone: string;
  confidence: number;
  intensity: number;
  unresolved: number;
  created_at: number;
  last_reinforced_at: number;
};

function rowToMemory(row: MemoryRow): Memory {
  return {
    id: row.id,
    agentId: row.agent_id,
    simulationId: row.simulation_id,
    type: row.type as MemoryType,
    subjectAgentIds: JSON.parse(row.subject_agent_ids) as string[],
    sourceEventIds: JSON.parse(row.source_event_ids) as string[],
    summary: row.summary,
    emotionalTone: row.emotional_tone as Memory["emotionalTone"],
    confidence: row.confidence,
    intensity: row.intensity,
    unresolved: row.unresolved === 1,
    createdAt: row.created_at,
    lastReinforcedAt: row.last_reinforced_at,
  };
}

export class SqliteMemoryRepository implements IMemoryRepository {
  constructor(private readonly db: DB) {}

  getByAgent(simulationId: string, agentId: string): Promise<Memory[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM memories
         WHERE simulation_id = ? AND agent_id = ?
         ORDER BY created_at ASC`,
      )
      .all(simulationId, agentId) as MemoryRow[];

    return Promise.resolve(rows.map(rowToMemory));
  }

  upsert(memory: Memory): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO memories
           (id, agent_id, simulation_id, type, subject_agent_ids, source_event_ids,
            summary, emotional_tone, confidence, intensity, unresolved, created_at, last_reinforced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type               = excluded.type,
           subject_agent_ids  = excluded.subject_agent_ids,
           source_event_ids   = excluded.source_event_ids,
           summary            = excluded.summary,
           emotional_tone     = excluded.emotional_tone,
           confidence         = excluded.confidence,
           intensity          = excluded.intensity,
           unresolved         = excluded.unresolved,
           last_reinforced_at = excluded.last_reinforced_at`,
      )
      .run(
        memory.id,
        memory.agentId,
        memory.simulationId,
        memory.type,
        JSON.stringify(memory.subjectAgentIds),
        JSON.stringify(memory.sourceEventIds),
        memory.summary,
        memory.emotionalTone,
        memory.confidence,
        memory.intensity,
        memory.unresolved ? 1 : 0,
        memory.createdAt,
        memory.lastReinforcedAt,
      );

    return Promise.resolve();
  }

  getBySubject(simulationId: string, subjectAgentId: string): Promise<Memory[]> {
    // JSON array search: subject_agent_ids contains the agent id
    // SQLite json_each for proper JSON array membership check
    const rows = this.db
      .prepare(
        `SELECT m.* FROM memories m, json_each(m.subject_agent_ids) je
         WHERE m.simulation_id = ? AND je.value = ?
         ORDER BY m.created_at ASC`,
      )
      .all(simulationId, subjectAgentId) as MemoryRow[];

    return Promise.resolve(rows.map(rowToMemory));
  }
}
