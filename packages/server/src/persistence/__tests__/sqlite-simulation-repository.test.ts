/**
 * SQLite SimulationRepository round-trip + contract tests (:memory:, no file I/O).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, closeDatabase, type DB } from "../sqlite/database.js";
import { SqliteSimulationRepository } from "../sqlite/simulation-repository.js";
import { makeSimulationInput } from "./sqlite-test-helpers.js";
import { runSimulationRepositoryContract } from "./repository-contract.js";

let db: DB;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  closeDatabase(db);
});

describe("SqliteSimulationRepository", () => {
  it("create and get round-trip", async () => {
    const repo = new SqliteSimulationRepository(db);
    const input = makeSimulationInput("sim1");

    const created = await repo.create(input);

    expect(created.id).toBe("sim1");
    expect(created.name).toBe("Sim sim1");
    expect(created.status).toBe("initializing");
    expect(created.agentIds).toEqual(["a1", "a2"]);
    expect(created.channelIds).toEqual(["ch1"]);
    expect(created.seed).toBe(42);
    expect(created.settings.pulseIntervalMs).toBe(3000);
    expect(typeof created.createdAt).toBe("number");

    const fetched = await repo.get("sim1");
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe("sim1");
    expect(fetched?.agentIds).toEqual(["a1", "a2"]);
  });

  it("get returns null for missing simulation", async () => {
    const repo = new SqliteSimulationRepository(db);
    const result = await repo.get("nonexistent");
    expect(result).toBeNull();
  });

  it("create on an existing id rejects (simulations.id PK)", async () => {
    const repo = new SqliteSimulationRepository(db);
    await repo.create(makeSimulationInput("sim1"));

    // create is a sync method: the SqliteError throws before a promise
    // exists, so the async wrapper turns it into a rejection.
    await expect(async () => repo.create(makeSimulationInput("sim1"))).rejects.toThrow();
  });

  it("updateStatus changes status", async () => {
    const repo = new SqliteSimulationRepository(db);
    await repo.create(makeSimulationInput("sim1"));
    await repo.updateStatus("sim1", "running");

    const sim = await repo.get("sim1");
    expect(sim?.status).toBe("running");
  });

  it("updateSettings merges partial settings", async () => {
    const repo = new SqliteSimulationRepository(db);
    await repo.create(makeSimulationInput("sim1"));
    await repo.updateSettings("sim1", { omniscientSpectatorMode: true, pulseIntervalMs: 5000 });

    const sim = await repo.get("sim1");
    expect(sim?.settings.omniscientSpectatorMode).toBe(true);
    expect(sim?.settings.pulseIntervalMs).toBe(5000);
    // Other settings preserved
    expect(sim?.settings.maxMessagesPerMinutePerAgent).toBe(10);
  });

  it("updateSettings on missing sim is a no-op", async () => {
    const repo = new SqliteSimulationRepository(db);
    await expect(repo.updateSettings("ghost", { pulseIntervalMs: 1 })).resolves.toBeUndefined();
  });

  it("list returns all simulations", async () => {
    const repo = new SqliteSimulationRepository(db);
    await repo.create(makeSimulationInput("s1"));
    await repo.create(makeSimulationInput("s2"));

    const all = await repo.list();
    expect(all).toHaveLength(2);
    expect(all.map(s => s.id)).toContain("s1");
    expect(all.map(s => s.id)).toContain("s2");
  });

  it("list returns empty array when no simulations", async () => {
    const repo = new SqliteSimulationRepository(db);
    const all = await repo.list();
    expect(all).toHaveLength(0);
  });
});


runSimulationRepositoryContract(async () => {
  const db = openDatabase(":memory:");
  return {
    repo: new SqliteSimulationRepository(db),
    teardown: async () => closeDatabase(db),
  };
});
