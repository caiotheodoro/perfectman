/**
 * SQLite cross-repository foreign-key cascade tests (:memory:, no file I/O).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, closeDatabase, type DB } from "../sqlite/database.js";
import { SqliteSimulationRepository } from "../sqlite/simulation-repository.js";
import { SqliteEventRepository } from "../sqlite/event-repository.js";
import { SqliteAgentStateRepository } from "../sqlite/agent-state-repository.js";
import { makeAgentState, makeEvent, makeSimulationInput } from "./sqlite-test-helpers.js";

let db: DB;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  closeDatabase(db);
});

describe("Foreign key cascade", () => {
  it("deleting simulation cascades to events", async () => {
    const simRepo = new SqliteSimulationRepository(db);
    const evtRepo = new SqliteEventRepository(db);

    await simRepo.create(makeSimulationInput("sim1"));
    await evtRepo.append("sim1", [makeEvent("sim1")]);

    // Verify event exists
    const before = await evtRepo.getAfter("sim1");
    expect(before).toHaveLength(1);

    // Delete simulation directly via SQL
    db.prepare("DELETE FROM simulations WHERE id = ?").run("sim1");

    // Events should be gone (CASCADE)
    const after = await evtRepo.getAfter("sim1");
    expect(after).toHaveLength(0);
  });

  it("deleting simulation cascades to agent_states", async () => {
    const simRepo = new SqliteSimulationRepository(db);
    const stateRepo = new SqliteAgentStateRepository(db);

    await simRepo.create(makeSimulationInput("sim1"));
    await stateRepo.upsert(makeAgentState("a1", "sim1"));

    db.prepare("DELETE FROM simulations WHERE id = ?").run("sim1");

    const after = await stateRepo.listBySimulation("sim1");
    expect(after).toHaveLength(0);
  });
});

