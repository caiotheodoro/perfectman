/**
 * SQLite AgentStateRepository round-trip + contract tests (:memory:, no file I/O).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, closeDatabase, type DB } from "../sqlite/database.js";
import { SqliteAgentStateRepository } from "../sqlite/agent-state-repository.js";
import { SqliteSimulationRepository } from "../sqlite/simulation-repository.js";
import { makeAgentState, makeMemory, makeSimulationInput, makeSqliteFactory } from "./sqlite-test-helpers.js";
import { runAgentStateRepositoryContract } from "./repository-contract.js";

let db: DB;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  closeDatabase(db);
});

describe("SqliteAgentStateRepository", () => {
  beforeEach(async () => {
    const simRepo = new SqliteSimulationRepository(db);
    await simRepo.create(makeSimulationInput("sim1"));
  });

  it("get returns null when not exists", async () => {
    const repo = new SqliteAgentStateRepository(db);
    expect(await repo.get("sim1", "a1")).toBeNull();
  });

  it("upsert + get round-trip including relationalStates Map", async () => {
    const repo = new SqliteAgentStateRepository(db);
    const state = makeAgentState("a1", "sim1");
    await repo.upsert(state);

    const fetched = await repo.get("sim1", "a1");
    expect(fetched).not.toBeNull();
    expect(fetched?.agentId).toBe("a1");
    expect(fetched?.presence).toBe("active");
    expect(fetched?.coreMood.valence).toBeCloseTo(0.2);
    expect(fetched?.socialEmotions.affection).toBeCloseTo(0.3);

    // Map round-trip
    expect(fetched?.relationalStates).toBeInstanceOf(Map);
    expect(fetched?.relationalStates.size).toBe(2);
    const rel = fetched?.relationalStates.get("a2");
    expect(rel?.trust).toBeCloseTo(0.5);
    expect(rel?.affection).toBeCloseTo(0.4);
    expect(rel?.interactionCount).toBe(5);
  });

  it("upsert updates existing state", async () => {
    const repo = new SqliteAgentStateRepository(db);
    const state = makeAgentState("a1", "sim1");
    await repo.upsert(state);

    const updated: AgentState = {
      ...state,
      presence: "lurking",
      coreMood: { ...state.coreMood, valence: -0.5 },
      lastProcessedEventId: "evt_123",
    };
    await repo.upsert(updated);

    const fetched = await repo.get("sim1", "a1");
    expect(fetched?.presence).toBe("lurking");
    expect(fetched?.coreMood.valence).toBeCloseTo(-0.5);
    expect(fetched?.lastProcessedEventId).toBe("evt_123");
  });

  it("listBySimulation returns all agents", async () => {
    const repo = new SqliteAgentStateRepository(db);
    await repo.upsert(makeAgentState("a1", "sim1"));
    await repo.upsert(makeAgentState("a2", "sim1"));
    await repo.upsert(makeAgentState("a3", "sim1"));

    const all = await repo.listBySimulation("sim1");
    expect(all).toHaveLength(3);
    expect(all.map(s => s.agentId)).toContain("a1");
    expect(all.map(s => s.agentId)).toContain("a3");
  });

  it("listBySimulation returns empty for unknown simulation", async () => {
    const repo = new SqliteAgentStateRepository(db);
    const all = await repo.listBySimulation("unknown");
    expect(all).toHaveLength(0);
  });

  it("empty relationalStates Map round-trips", async () => {
    const repo = new SqliteAgentStateRepository(db);
    const state: AgentState = { ...makeAgentState("a1", "sim1"), relationalStates: new Map() };
    await repo.upsert(state);

    const fetched = await repo.get("sim1", "a1");
    expect(fetched?.relationalStates).toBeInstanceOf(Map);
    expect(fetched?.relationalStates.size).toBe(0);
  });

  it("memories array round-trips", async () => {
    const repo = new SqliteAgentStateRepository(db);
    const memory = makeMemory("m1", "a1", "sim1");
    const state: AgentState = { ...makeAgentState("a1", "sim1"), memories: [memory] };
    await repo.upsert(state);

    const fetched = await repo.get("sim1", "a1");
    expect(fetched?.memories).toHaveLength(1);
    expect(fetched?.memories[0]?.summary).toBe("a2 was friendly to me");
  });

  it("lastActionAt null round-trips", async () => {
    const repo = new SqliteAgentStateRepository(db);
    const state = makeAgentState("a1", "sim1");
    await repo.upsert(state);

    const fetched = await repo.get("sim1", "a1");
    expect(fetched?.lastActionAt).toBeNull();
  });
});


runAgentStateRepositoryContract(
  makeSqliteFactory(db => new SqliteAgentStateRepository(db), ["sim1", "simA", "simB"]),
);
