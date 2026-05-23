/**
 * SQLite repository round-trip tests.
 * Uses :memory: database — no file I/O.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  Simulation,
  SimulationSettings,
  Channel,
  ChannelMembership,
  CommittedEvent,
  SimulationEvent,
  AgentState,
  Memory,
  CoreMood,
  SocialEmotions,
  RelationalState,
  InitiativeAccumulator,
} from "@perfectman/shared";
import { openDatabase, closeDatabase } from "../sqlite/database.js";
import type { DB } from "../sqlite/database.js";
import { SqliteSimulationRepository } from "../sqlite/simulation-repository.js";
import { SqliteChannelRepository } from "../sqlite/channel-repository.js";
import { SqliteEventRepository } from "../sqlite/event-repository.js";
import { SqliteAgentStateRepository } from "../sqlite/agent-state-repository.js";
import { SqliteMemoryRepository } from "../sqlite/memory-repository.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 10,
  llmCallBudgetPerMinute: 20,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 50000,
};

function makeSimulationInput(id: string) {
  return {
    id,
    name: `Sim ${id}`,
    agentIds: ["a1", "a2"],
    channelIds: ["ch1"],
    settings: DEFAULT_SETTINGS,
    seed: 42,
  };
}

function makeChannel(id: string, simulationId: string): Channel {
  return {
    id,
    simulationId,
    type: "public_channel",
    name: `#${id}`,
    createdBy: "system",
    memberAgentIds: ["a1", "a2"],
    spectatorVisible: true,
    operatorVisible: true,
    createdForMotives: [],
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

const BASE_MOOD: CoreMood = {
  valence: 0.2,
  arousal: 0.4,
  stability: 0.7,
  energy: 0.6,
  circumplexAngle: 0.3,
  circumplexRadius: 0.4,
  momentumValence: 0,
  momentumArousal: 0,
};

const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0.3, resentment: 0, suspicion: 0, admiration: 0.2,
  contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
  desireForStatus: 0, desireForIntimacy: 0,
};

function makeRelationalState(targetAgentId: string): RelationalState {
  return {
    targetAgentId,
    trust: 0.5,
    affection: 0.4,
    resentment: 0.1,
    attraction: 0.2,
    suspicion: 0.1,
    admiration: 0.3,
    envy: 0,
    comfort: 0.6,
    threat: 0,
    curiosity: 0.4,
    desireForCloseness: 0.5,
    desireForDistance: 0.1,
    interactionCount: 5,
    lastInteractionAt: Date.now() - 60000,
    lastPositiveAt: Date.now() - 30000,
    lastNegativeAt: null,
  };
}

function makeAgentState(agentId: string, simulationId: string): AgentState {
  return {
    agentId,
    simulationId,
    personaId: "caio",
    presence: "active",
    coreMood: { ...BASE_MOOD },
    socialEmotions: { ...ZERO_SOCIAL },
    relationalStates: new Map([
      ["a2", makeRelationalState("a2")],
      ["a3", makeRelationalState("a3")],
    ]),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function makeMemory(id: string, agentId: string, simulationId: string): Memory {
  return {
    id,
    agentId,
    simulationId,
    type: "episodic",
    subjectAgentIds: ["a2"],
    sourceEventIds: ["evt1"],
    summary: "a2 was friendly to me",
    emotionalTone: "positive",
    confidence: 0.9,
    unresolved: false,
    createdAt: Date.now(),
    lastReinforcedAt: Date.now(),
  };
}

function makeEvent(
  simulationId: string,
  channelId: string = "ch1",
  actorId: string = "a1",
  type: SimulationEvent["type"] = "message_sent",
): SimulationEvent {
  return {
    simulationId,
    channelId,
    actorId,
    type,
    payload: { content: "hello" },
    sourceEventIds: [],
    emotionalSalience: "low",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public_channel",
    },
  };
}

// ── Test Setup ────────────────────────────────────────────────────────────────

let db: DB;

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  closeDatabase(db);
});

// ── Simulation Repository ─────────────────────────────────────────────────────

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

// ── Channel Repository ────────────────────────────────────────────────────────

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

// ── Event Repository ──────────────────────────────────────────────────────────

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

// ── AgentState Repository ─────────────────────────────────────────────────────

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

// ── Memory Repository ─────────────────────────────────────────────────────────

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

    const updated: Memory = { ...memory, confidence: 0.5, unresolved: true, summary: "updated" };
    await repo.upsert(updated);

    const memories = await repo.getByAgent("sim1", "a1");
    expect(memories).toHaveLength(1);
    expect(memories[0]?.confidence).toBeCloseTo(0.5);
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

// ── Cross-repository cascade / FK tests ──────────────────────────────────────

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
