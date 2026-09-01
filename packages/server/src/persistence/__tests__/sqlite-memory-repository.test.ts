/**
 * SQLite MemoryRepository round-trip + contract tests (:memory:, no file I/O).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, closeDatabase, type DB } from "../sqlite/database.js";
import { SqliteMemoryRepository } from "../sqlite/memory-repository.js";
import { SqliteSimulationRepository } from "../sqlite/simulation-repository.js";
import { makeMemory, makeSimulationInput, makeSqliteFactory } from "./sqlite-test-helpers.js";
import { runMemoryRepositoryContract } from "./repository-contract.js";

let db: DB;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  closeDatabase(db);
});

describe("SqliteMemoryRepository", () => {
  beforeEach(async () => {
    const simRepo = new SqliteSimulationRepository(db);
    await simRepo.create(makeSimulationInput("sim1"));
  });

  it("upsert + getByAgent round-trip", async () => {
    const repo = new SqliteMemoryRepository(db);
    const memory = makeMemory("m1", "a1", "sim1");
    await repo.upsert(memory);

    const memories = await repo.getByAgent("sim1", "a1");
    expect(memories).toHaveLength(1);
    expect(memories[0]?.id).toBe("m1");
    expect(memories[0]?.summary).toBe("a2 was friendly to me");
    expect(memories[0]?.subjectAgentIds).toEqual(["a2"]);
    expect(memories[0]?.confidence).toBeCloseTo(0.9);
    expect(memories[0]?.unresolved).toBe(false);
  });

  it("getByAgent returns empty for unknown agent", async () => {
    const repo = new SqliteMemoryRepository(db);
    const memories = await repo.getByAgent("sim1", "ghost");
    expect(memories).toHaveLength(0);
  });

  it("upsert updates existing memory", async () => {
    const repo = new SqliteMemoryRepository(db);
    const memory = makeMemory("m1", "a1", "sim1");
    await repo.upsert(memory);

    const updated: Memory = { ...memory, confidence: 0.5, intensity: 0.7, unresolved: true, summary: "updated" };
    await repo.upsert(updated);

    const memories = await repo.getByAgent("sim1", "a1");
    expect(memories).toHaveLength(1);
    expect(memories[0]?.confidence).toBeCloseTo(0.5);
    expect(memories[0]?.intensity).toBeCloseTo(0.7);
    expect(memories[0]?.unresolved).toBe(true);
    expect(memories[0]?.summary).toBe("updated");
  });

  it("getBySubject returns memories where agent is subject", async () => {
    const repo = new SqliteMemoryRepository(db);

    // a1 has memory about a2
    await repo.upsert({ ...makeMemory("m1", "a1", "sim1"), subjectAgentIds: ["a2"] });
    // a1 has memory about a3 (not a2)
    await repo.upsert({ ...makeMemory("m2", "a1", "sim1"), subjectAgentIds: ["a3"] });
    // a2 also has memory about a2 (self as subject — edge case)
    await repo.upsert({ ...makeMemory("m3", "a2", "sim1"), subjectAgentIds: ["a2", "a3"] });

    const aboutA2 = await repo.getBySubject("sim1", "a2");
    expect(aboutA2.map(m => m.id)).toContain("m1");
    expect(aboutA2.map(m => m.id)).toContain("m3");
    expect(aboutA2.map(m => m.id)).not.toContain("m2");
  });

  it("getBySubject returns empty when no matches", async () => {
    const repo = new SqliteMemoryRepository(db);
    await repo.upsert({ ...makeMemory("m1", "a1", "sim1"), subjectAgentIds: ["a2"] });

    const result = await repo.getBySubject("sim1", "a99");
    expect(result).toHaveLength(0);
  });

  it("multiple memories for same agent stored and retrieved", async () => {
    const repo = new SqliteMemoryRepository(db);
    await repo.upsert(makeMemory("m1", "a1", "sim1"));
    await repo.upsert({ ...makeMemory("m2", "a1", "sim1"), type: "social_theory", summary: "a2 often ignores me" });
    await repo.upsert({ ...makeMemory("m3", "a1", "sim1"), type: "self_reflection", summary: "I feel isolated" });

    const memories = await repo.getByAgent("sim1", "a1");
    expect(memories).toHaveLength(3);
  });

  it("unresolved true round-trips", async () => {
    const repo = new SqliteMemoryRepository(db);
    const memory: Memory = { ...makeMemory("m1", "a1", "sim1"), unresolved: true };
    await repo.upsert(memory);

    const fetched = (await repo.getByAgent("sim1", "a1"))[0];
    expect(fetched?.unresolved).toBe(true);
  });

  it("emotionalTone negative round-trips", async () => {
    const repo = new SqliteMemoryRepository(db);
    const memory: Memory = { ...makeMemory("m1", "a1", "sim1"), emotionalTone: "negative" };
    await repo.upsert(memory);

    const fetched = (await repo.getByAgent("sim1", "a1"))[0];
    expect(fetched?.emotionalTone).toBe("negative");
  });
});


runMemoryRepositoryContract(
  makeSqliteFactory(db => new SqliteMemoryRepository(db), ["sim1", "simA", "simB"]),
);
