/**
 * SQLite ChannelRepository round-trip + contract tests (:memory:, no file I/O).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase, closeDatabase, type DB } from "../sqlite/database.js";
import { SqliteChannelRepository } from "../sqlite/channel-repository.js";
import { SqliteSimulationRepository } from "../sqlite/simulation-repository.js";
import { makeChannel, makeSimulationInput, makeSqliteFactory } from "./sqlite-test-helpers.js";
import { runChannelRepositoryContract } from "./repository-contract.js";

let db: DB;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  closeDatabase(db);
});

describe("SqliteChannelRepository", () => {
  beforeEach(async () => {
    const simRepo = new SqliteSimulationRepository(db);
    await simRepo.create(makeSimulationInput("sim1"));
  });

  it("create and getById round-trip", async () => {
    const repo = new SqliteChannelRepository(db);
    const ch = makeChannel("ch1", "sim1");
    const created = await repo.create(ch);

    expect(created.id).toBe("ch1");
    expect(created.type).toBe("public_channel");
    expect(created.memberAgentIds).toEqual(["a1", "a2"]);
    expect(created.spectatorVisible).toBe(true);

    const fetched = await repo.getById("ch1");
    expect(fetched).not.toBeNull();
    expect(fetched?.simulationId).toBe("sim1");
  });

  it("getById returns null for missing channel", async () => {
    const repo = new SqliteChannelRepository(db);
    expect(await repo.getById("ghost")).toBeNull();
  });

  it("listBySimulation returns channels for simulation", async () => {
    const repo = new SqliteChannelRepository(db);
    await repo.create(makeChannel("ch1", "sim1"));
    await repo.create(makeChannel("ch2", "sim1"));

    const channels = await repo.listBySimulation("sim1");
    expect(channels).toHaveLength(2);
    expect(channels.map(c => c.id)).toContain("ch1");
    expect(channels.map(c => c.id)).toContain("ch2");
  });

  it("updateMembers updates member list", async () => {
    const repo = new SqliteChannelRepository(db);
    await repo.create(makeChannel("ch1", "sim1"));
    await repo.updateMembers("ch1", ["a1", "a2", "a3"]);

    const ch = await repo.getById("ch1");
    expect(ch?.memberAgentIds).toEqual(["a1", "a2", "a3"]);
  });

  it("archive sets status to archived", async () => {
    const repo = new SqliteChannelRepository(db);
    await repo.create(makeChannel("ch1", "sim1"));
    await repo.archive("ch1");

    const ch = await repo.getById("ch1");
    expect(ch?.status).toBe("archived");
  });

  it("private channel persists spectatorVisible: false", async () => {
    const repo = new SqliteChannelRepository(db);
    const privateCh: Channel = {
      ...makeChannel("priv1", "sim1"),
      type: "private_channel",
      spectatorVisible: false,
      createdForMotives: ["comfort", "secrecy"],
    };
    await repo.create(privateCh);

    const fetched = await repo.getById("priv1");
    expect(fetched?.spectatorVisible).toBe(false);
    expect(fetched?.type).toBe("private_channel");
    expect(fetched?.createdForMotives).toEqual(["comfort", "secrecy"]);
  });

  it("getMembership returns memberships for channel", async () => {
    const repo = new SqliteChannelRepository(db);
    await repo.create(makeChannel("ch1", "sim1"));

    await repo.addMembership({ channelId: "ch1", agentId: "a1", joinedAt: 1000 });
    await repo.addMembership({ channelId: "ch1", agentId: "a2", joinedAt: 2000 });

    const members = await repo.getMembership("ch1");
    expect(members).toHaveLength(2);
    expect(members.map(m => m.agentId)).toContain("a1");
    expect(members.map(m => m.agentId)).toContain("a2");
  });

  it("removeMembership sets left_at", async () => {
    const repo = new SqliteChannelRepository(db);
    await repo.create(makeChannel("ch1", "sim1"));
    await repo.addMembership({ channelId: "ch1", agentId: "a1", joinedAt: 1000 });
    await repo.removeMembership("ch1", "a1");

    const members = await repo.getMembership("ch1");
    const a1 = members.find(m => m.agentId === "a1");
    expect(a1?.leftAt).toBeTypeOf("number");
    expect(a1?.leftAt).toBeGreaterThan(0);
  });

  it("addMembership with leftAt persists it", async () => {
    const repo = new SqliteChannelRepository(db);
    await repo.create(makeChannel("ch1", "sim1"));
    const m: ChannelMembership = { channelId: "ch1", agentId: "a1", joinedAt: 1000, leftAt: 2000 };
    await repo.addMembership(m);

    const members = await repo.getMembership("ch1");
    expect(members[0]?.leftAt).toBe(2000);
  });
});


runChannelRepositoryContract(
  makeSqliteFactory(db => new SqliteChannelRepository(db)),
);
