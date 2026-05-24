/**
 * SQLite implementation of IEventRepository.
 * Events are append-only; committed events get id, createdAt, pulseIndex assigned here.
 */

import type {
  SimulationEvent,
  CommittedEvent,
} from "@perfectman/shared";
import { CommittedEventSchema } from "@perfectman/shared";
import type { IEventRepository } from "../repositories.js";
import type { DB } from "./database.js";

// Simple monotonic ID generator for events (nanoid-like but dependency-free)
let _counter = 0;
function generateEventId(): string {
  return `evt_${Date.now()}_${(++_counter).toString(36)}`;
}

type EventRow = {
  id: string;
  simulation_id: string;
  channel_id: string;
  actor_id: string;
  type: string;
  payload: string;
  created_at: number;
  pulse_index: number;
  source_intent_id: string | null;
  source_event_ids: string;
  emotional_salience: string;
  visibility: string;
};

type MaxPulseRow = { max_pulse: number | null };
type EventPivotRow = { created_at: number; id: string };

function rowToCommittedEvent(row: EventRow): CommittedEvent {
  return CommittedEventSchema.parse({
    id: row.id,
    simulationId: row.simulation_id,
    channelId: row.channel_id,
    actorId: row.actor_id,
    type: row.type,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
    pulseIndex: row.pulse_index,
    sourceIntentId: row.source_intent_id ?? undefined,
    sourceEventIds: JSON.parse(row.source_event_ids),
    emotionalSalience: row.emotional_salience,
    visibility: JSON.parse(row.visibility),
  });
}

export class SqliteEventRepository implements IEventRepository {
  private readonly insert: ReturnType<DB["prepare"]>;

  constructor(private readonly db: DB) {
    this.insert = this.db.prepare(
      `INSERT INTO events
         (id, simulation_id, channel_id, actor_id, type, payload,
          created_at, pulse_index, source_intent_id, source_event_ids,
          emotional_salience, visibility)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  append(simulationId: string, events: SimulationEvent[]): Promise<CommittedEvent[]> {
    if (events.length === 0) return Promise.resolve([]);

    // Determine next pulseIndex: max existing + 1, or 1
    const maxRow = this.db
      .prepare<[string], MaxPulseRow>(
        `SELECT MAX(pulse_index) AS max_pulse FROM events WHERE simulation_id = ?`,
      )
      .get(simulationId);

    const pulseIndex = (maxRow?.max_pulse ?? 0) + 1;
    const now = Date.now();

    const committed: CommittedEvent[] = [];

    const appendMany = this.db.transaction((evts: SimulationEvent[]) => {
      for (const evt of evts) {
        const id = evt.id ?? generateEventId();
        const createdAt = evt.createdAt ?? now;

        this.insert.run([
          id,
          simulationId,
          evt.channelId,
          evt.actorId,
          evt.type,
          JSON.stringify(evt.payload),
          createdAt,
          evt.pulseIndex ?? pulseIndex,
          evt.sourceIntentId ?? null,
          JSON.stringify(evt.sourceEventIds),
          evt.emotionalSalience,
          JSON.stringify(evt.visibility),
        ]);

        const committedEvent: CommittedEvent = {
          ...evt,
          id,
          simulationId,
          createdAt,
          pulseIndex: evt.pulseIndex ?? pulseIndex,
        };
        committed.push(committedEvent);
      }
    });

    appendMany(events);

    return Promise.resolve(committed);
  }

  getById(simulationId: string, eventId: string): Promise<CommittedEvent | null> {
    const row = this.db
      .prepare<[string, string], EventRow>(`SELECT * FROM events WHERE simulation_id = ? AND id = ?`)
      .get(simulationId, eventId);

    return Promise.resolve(row ? rowToCommittedEvent(row) : null);
  }

  getAfter(simulationId: string, afterEventId?: string): Promise<CommittedEvent[]> {
    if (!afterEventId) {
      const rows = this.db
        .prepare<[string], EventRow>(
          `SELECT * FROM events WHERE simulation_id = ? ORDER BY created_at ASC, id ASC`,
        )
        .all(simulationId);
      return Promise.resolve(rows.map(rowToCommittedEvent));
    }

    // Find the createdAt of the pivot event, then return events strictly after it
    const pivot = this.db
      .prepare<[string, string], EventPivotRow>(`SELECT created_at, id FROM events WHERE simulation_id = ? AND id = ?`)
      .get(simulationId, afterEventId);

    if (!pivot) return Promise.resolve([]);

    const rows = this.db
      .prepare<[string, number, number, string], EventRow>(
        `SELECT * FROM events
         WHERE simulation_id = ?
           AND (created_at > ? OR (created_at = ? AND id > ?))
         ORDER BY created_at ASC, id ASC`,
      )
      .all(simulationId, pivot.created_at, pivot.created_at, afterEventId);

    return Promise.resolve(rows.map(rowToCommittedEvent));
  }

  getCommittedThrough(simulationId: string, pulseIndex: number): Promise<CommittedEvent[]> {
    const rows = this.db
      .prepare<[string, number], EventRow>(
        `SELECT * FROM events
         WHERE simulation_id = ? AND pulse_index <= ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(simulationId, pulseIndex);

    return Promise.resolve(rows.map(rowToCommittedEvent));
  }

  getRecent(simulationId: string, limit: number): Promise<CommittedEvent[]> {
    const rows = this.db
      .prepare<[string, number], EventRow>(
        `SELECT * FROM events
         WHERE simulation_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .all(simulationId, limit);

    // Return in ascending chronological order
    return Promise.resolve(rows.reverse().map(rowToCommittedEvent));
  }
}
