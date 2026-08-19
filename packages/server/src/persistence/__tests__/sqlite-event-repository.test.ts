/**
 * SQLite EventRepository round-trip + contract tests (:memory:, no file I/O).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, closeDatabase, type DB } from "../sqlite/database.js";
import { SqliteEventRepository } from "../sqlite/event-repository.js";
import { SqliteSimulationRepository } from "../sqlite/simulation-repository.js";
import { makeEvent, makeSimulationInput, makeSqliteFactory } from "./sqlite-test-helpers.js";
import { runEventRepositoryContract } from "./repository-contract.js";

let db: DB;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  closeDatabase(db);
});

describe("SqliteEventRepository", () => {
  beforeEach(async () => {
    const simRepo = new SqliteSimulationRepository(db);
    await simRepo.create(makeSimulationInput("sim1"));
  });

  it("append returns committed events with assigned fields", async () => {
    const repo = new SqliteEventRepository(db);
    const evts = [makeEvent("sim1"), makeEvent("sim1", "ch1", "a2")];
    const committed = await repo.append("sim1", evts);

    expect(committed).toHaveLength(2);
    for (const c of committed) {
      expect(c.id).toBeTypeOf("string");
      expect(c.createdAt).toBeTypeOf("number");
      expect(c.pulseIndex).toBeTypeOf("number");
    }
  });

  it("append empty array returns empty array", async () => {
    const repo = new SqliteEventRepository(db);
    const result = await repo.append("sim1", []);
    expect(result).toHaveLength(0);
  });

  it("getById retrieves event", async () => {
    const repo = new SqliteEventRepository(db);
    const [c] = await repo.append("sim1", [makeEvent("sim1")]);
    const fetched = await repo.getById("sim1", c!.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.actorId).toBe("a1");
    expect(fetched?.type).toBe("message_sent");
  });

  it("getById returns null for missing event", async () => {
    const repo = new SqliteEventRepository(db);
    expect(await repo.getById("sim1", "ghost")).toBeNull();
  });

  it("getAfter without cursor returns all events in order", async () => {
    const repo = new SqliteEventRepository(db);
    await repo.append("sim1", [makeEvent("sim1", "ch1", "a1"), makeEvent("sim1", "ch1", "a2")]);
    const all = await repo.getAfter("sim1");
    expect(all).toHaveLength(2);
  });

  it("getAfter with cursor returns only newer events", async () => {
    const repo = new SqliteEventRepository(db);
    const [e1, e2, e3] = await repo.append("sim1", [
      makeEvent("sim1", "ch1", "a1"),
      makeEvent("sim1", "ch1", "a2"),
      makeEvent("sim1", "ch1", "a3"),
    ]);

    const after = await repo.getAfter("sim1", e1!.id);
    expect(after).toHaveLength(2);
    expect(after.map(e => e.id)).toContain(e2!.id);
    expect(after.map(e => e.id)).toContain(e3!.id);
    expect(after.map(e => e.id)).not.toContain(e1!.id);
  });

  it("getAfter with unknown cursor returns empty", async () => {
    const repo = new SqliteEventRepository(db);
    await repo.append("sim1", [makeEvent("sim1")]);
    const after = await repo.getAfter("sim1", "nonexistent-id");
    expect(after).toHaveLength(0);
  });

  it("getCommittedThrough returns events up to pulseIndex", async () => {
    const repo = new SqliteEventRepository(db);

    // Append batch 1 → pulseIndex 1
    const [e1] = await repo.append("sim1", [makeEvent("sim1", "ch1", "a1")]);
    // Append batch 2 → pulseIndex 2
    const [e2] = await repo.append("sim1", [makeEvent("sim1", "ch1", "a2")]);
    // Append batch 3 → pulseIndex 3
    await repo.append("sim1", [makeEvent("sim1", "ch1", "a3")]);

    const through2 = await repo.getCommittedThrough("sim1", 2);
    expect(through2.map(e => e.id)).toContain(e1!.id);
    expect(through2.map(e => e.id)).toContain(e2!.id);
    expect(through2).toHaveLength(2);
  });

  it("getRecent returns N most recent events in ascending order", async () => {
    const repo = new SqliteEventRepository(db);
    await repo.append("sim1", [
      makeEvent("sim1", "ch1", "a1"),
      makeEvent("sim1", "ch1", "a2"),
      makeEvent("sim1", "ch1", "a3"),
      makeEvent("sim1", "ch1", "a4"),
      makeEvent("sim1", "ch1", "a5"),
    ]);

    const recent = await repo.getRecent("sim1", 3);
    expect(recent).toHaveLength(3);
    // Last 3 actors should be a3, a4, a5 (in ascending order)
    expect(recent[0]?.actorId).toBe("a3");
    expect(recent[1]?.actorId).toBe("a4");
    expect(recent[2]?.actorId).toBe("a5");
  });

  it("payload round-trips through JSON", async () => {
    const repo = new SqliteEventRepository(db);
    const evt = { ...makeEvent("sim1"), payload: { content: "hello world", reactions: ["👍", "❤️"], count: 3 } };
    const [c] = await repo.append("sim1", [evt]);
    const fetched = await repo.getById("sim1", c!.id);
    expect(fetched?.payload).toEqual({ content: "hello world", reactions: ["👍", "❤️"], count: 3 });
  });

  it("visibility round-trips", async () => {
    const repo = new SqliteEventRepository(db);
    const evt = {
      ...makeEvent("sim1"),
      visibility: {
        visibleToAgents: ["a1"],
        visibleToSpectators: false,
        visibleToOperators: true,
        visibilityReason: "private_channel",
      },
    };
    const [c] = await repo.append("sim1", [evt]);
    const fetched = await repo.getById("sim1", c!.id);
    expect(fetched?.visibility.visibleToAgents).toEqual(["a1"]);
    expect(fetched?.visibility.visibleToSpectators).toBe(false);
    expect(fetched?.visibility.visibilityReason).toBe("private_channel");
  });

  it("events from separate appends have incrementing pulseIndex", async () => {
    const repo = new SqliteEventRepository(db);
    const [e1] = await repo.append("sim1", [makeEvent("sim1")]);
    const [e2] = await repo.append("sim1", [makeEvent("sim1")]);
    const [e3] = await repo.append("sim1", [makeEvent("sim1")]);

    expect(e2!.pulseIndex).toBeGreaterThan(e1!.pulseIndex);
    expect(e3!.pulseIndex).toBeGreaterThan(e2!.pulseIndex);
  });

  it("pre-assigned id and createdAt are preserved", async () => {
    const repo = new SqliteEventRepository(db);
    const evt: SimulationEvent = { ...makeEvent("sim1"), id: "my-custom-id", createdAt: 9999999 };
    const [c] = await repo.append("sim1", [evt]);

    expect(c!.id).toBe("my-custom-id");
    expect(c!.createdAt).toBe(9999999);
  });
});


runEventRepositoryContract(
  makeSqliteFactory(db => new SqliteEventRepository(db), ["sim1", "simA", "simB"]),
);
