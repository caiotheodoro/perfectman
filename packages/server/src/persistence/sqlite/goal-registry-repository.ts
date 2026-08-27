/**
 * SQLite persistence for the goal-registry self-verdict junction (D-29/D-32):
 * the only goal-layer state replay does not reconstruct. No interface — the
 * evaluator consumes this class through the structural GoalRegistryPersister
 * type in world-evaluator.ts.
 */

import type { SelfVerdict } from "@perfectman/shared";
import type { GoalSelfVerdictEntry, GoalRegistryPersister } from "../../simulation/world/world-evaluator.js";
export type { GoalSelfVerdictEntry } from "../../simulation/world/world-evaluator.js";
import type { DB } from "./database.js";

type GoalSelfVerdictRow = {
  simulation_id: string;
  goal_id: string;
  verdict: string;
  source: string;
  updated_at: number;
};

function rowToEntry(row: GoalSelfVerdictRow): GoalSelfVerdictEntry {
  return {
    goalId: row.goal_id,
    verdict: JSON.parse(row.verdict) as SelfVerdict,
    source: row.source as GoalSelfVerdictEntry["source"],
  };
}

export class SqliteGoalRegistryRepository {
  constructor(private readonly db: DB) {}

  saveSelfVerdicts(
    simulationId: string,
    entries: GoalSelfVerdictEntry[],
  ): Promise<void> {
    const persist = this.db.transaction(() => {
      this.db
        .prepare(`DELETE FROM goal_self_verdicts WHERE simulation_id = ?`)
        .run(simulationId);
      const insert = this.db.prepare(
        `INSERT INTO goal_self_verdicts
           (simulation_id, goal_id, verdict, source, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const now = Date.now();
      for (const entry of entries) {
        insert.run(
          simulationId,
          entry.goalId,
          JSON.stringify(entry.verdict),
          entry.source,
          now,
        );
      }
    });
    persist();
    return Promise.resolve();
  }

  loadSelfVerdicts(simulationId: string): Promise<GoalSelfVerdictEntry[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM goal_self_verdicts
         WHERE simulation_id = ?
         ORDER BY goal_id ASC`,
      )
      .all(simulationId) as GoalSelfVerdictRow[];

    return Promise.resolve(rows.map(rowToEntry));
  }
}