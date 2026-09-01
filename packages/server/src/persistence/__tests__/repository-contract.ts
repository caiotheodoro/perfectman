/**
 * Repository contract test factory.
 *
 * Export factory functions that Dev2 can import to validate their in-memory
 * store implementations against the same behavioral contract as SQLite.
 *
 * Usage:
 *   import { runEventRepositoryContract } from "../persistence/__tests__/repository-contract.js";
 *   runEventRepositoryContract(async () => ({
 *     repo: new InMemoryEventRepository(),
 *     teardown: async () => {},
 *   }));
 *
 * NOT a test file itself — no describe/it at module level, only exports.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  SimulationEvent,
  AgentState,
  Memory,
  Channel,
  ChannelMembership,
  CoreMood,
  SocialEmotions,
} from "@perfectman/shared";
import type {
  IEventRepository,
  IAgentStateRepository,
  IMemoryRepository,
  ISimulationRepository,
  IChannelRepository,
  CreateSimulationInput,
} from "../repositories.js";

// ── Shared fixture builders ────────────────────────────────────────────────────

function makeSimulationInput(id: string): CreateSimulationInput {
  return {
    id,
    name: `Sim ${id}`,
    agentIds: ["a1", "a2"],
    channelIds: ["ch1"],
    settings: {
      omniscientSpectatorMode: false,
      allowPrivateChannels: true,
      maxPrivateChannelsPerAgent: 3,
      maxMessagesPerMinutePerAgent: 10,
      llmCallBudgetPerMinute: 20,
      pulseIntervalMs: 3000,
      tokenBudgetPerHour: 50000,
    },
    seed: 42,
  };
}

function makeEventInput(
  channelId = "ch1",
  actorId = "a1",
  type: SimulationEvent["type"] = "message_sent",
): SimulationEvent {
  return {
    simulationId: "sim1",
    channelId,
    actorId,
    type,
    payload: { text: "hello" },
    sourceEventIds: [],
    emotionalSalience: "medium",
    visibility: {
      visibleToAgents: [],
      visibleToSpectators: true,
      visibleToOperators: true,
      visibilityReason: "public_channel",
    },
  };
}

const BASE_MOOD: CoreMood = {
  valence: 0.1, arousal: 0.4, stability: 0.6, energy: 0.6,
  circumplexAngle: 0.5, circumplexRadius: 0.4,
  momentumValence: 0, momentumArousal: 0,
};

const ZERO_SOCIAL: SocialEmotions = {
  jealousy: 0, envy: 0, humiliation: 0, pride: 0, shame: 0,
  affection: 0, resentment: 0, suspicion: 0, admiration: 0,
  contempt: 0, neediness: 0, socialAnxiety: 0, fearOfExclusion: 0,
  desireForStatus: 0, desireForIntimacy: 0,
};

function makeAgentState(agentId: string, simulationId = "sim1"): AgentState {
  return {
    agentId,
    simulationId,
    personaId: agentId,
    presence: "active",
    coreMood: BASE_MOOD,
    socialEmotions: ZERO_SOCIAL,
    relationalStates: new Map(),
    memories: [],
    initiativeAccumulators: [],
    lastProcessedEventId: null,
    lastActionAt: null,
    lastRuminationPulse: null,
    arrivalPulse: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

function makeMemory(id: string, agentId: string, simulationId = "sim1", subjectIds: string[] = []): Memory {
  return {
    id,
    agentId,
    simulationId,
    type: "episodic",
    subjectAgentIds: subjectIds,
    sourceEventIds: [],
    summary: `Memory ${id}`,
    emotionalTone: "neutral",
    confidence: 0.8,
    intensity: 0,
    unresolved: false,
    createdAt: 1700000000000,
    lastReinforcedAt: 1700000000000,
  };
}

function makeChannel(id: string, simulationId = "sim1"): Channel {
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
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
  };
}

// ── Event Repository Contract ──────────────────────────────────────────────────

export type EventRepoFactory = () => Promise<{
  repo: IEventRepository;
  teardown: () => Promise<void>;
}>;

export function runEventRepositoryContract(factory: EventRepoFactory): void {
  describe("IEventRepository contract", () => {
    let repo: IEventRepository;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
      const result = await factory();
      repo = result.repo;
      teardown = result.teardown;
    });

    afterEach(async () => {
      await teardown();
    });

    it("append assigns id, createdAt, and pulseIndex to returned events", async () => {
      const events = [makeEventInput()];
      const committed = await repo.append("sim1", events);

      expect(committed).toHaveLength(1);
      expect(committed[0]!.id).toBeTruthy();
      expect(committed[0]!.createdAt).toBeGreaterThan(0);
      expect(committed[0]!.pulseIndex).toBeGreaterThan(0);
      expect(committed[0]!.simulationId).toBe("sim1");
    });

    it("append preserves pre-assigned id and createdAt", async () => {
      const preId = "evt_custom_001";
      const preTime = 1700000000000;
      const event: SimulationEvent = {
        ...makeEventInput(),
        id: preId,
        createdAt: preTime,
      };
      const committed = await repo.append("sim1", [event]);

      expect(committed[0]!.id).toBe(preId);
      expect(committed[0]!.createdAt).toBe(preTime);
    });

    it("getById returns the event that was appended", async () => {
      const committed = await repo.append("sim1", [makeEventInput()]);
      const found = await repo.getById("sim1", committed[0]!.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(committed[0]!.id);
    });

    it("getById returns null for unknown id", async () => {
      const result = await repo.getById("sim1", "nonexistent");
      expect(result).toBeNull();
    });

    it("getAfter without cursor returns all events in ascending order", async () => {
      await repo.append("sim1", [makeEventInput(), makeEventInput(), makeEventInput()]);
      const all = await repo.getAfter("sim1");

      expect(all.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < all.length; i++) {
        expect(all[i]!.createdAt).toBeGreaterThanOrEqual(all[i - 1]!.createdAt);
      }
    });

    it("getAfter with cursor returns events strictly after it", async () => {
      const first = await repo.append("sim1", [makeEventInput()]);
      await repo.append("sim1", [makeEventInput(), makeEventInput()]);

      const after = await repo.getAfter("sim1", first[0]!.id);
      expect(after.length).toBeGreaterThanOrEqual(2);
      for (const e of after) {
        expect(e.id).not.toBe(first[0]!.id);
      }
    });

    it("getAfter with unknown cursor returns empty array", async () => {
      await repo.append("sim1", [makeEventInput()]);
      const result = await repo.getAfter("sim1", "nonexistent_pivot");
      expect(result).toHaveLength(0);
    });

    it("getCommittedThrough returns events up to and including pulseIndex", async () => {
      const first = await repo.append("sim1", [makeEventInput()]);
      await repo.append("sim1", [makeEventInput()]);

      const pulse1 = first[0]!.pulseIndex;
      const through = await repo.getCommittedThrough("sim1", pulse1);
      for (const e of through) {
        expect(e.pulseIndex).toBeLessThanOrEqual(pulse1);
      }
    });

    it("getRecent returns N most recent events in ascending order", async () => {
      await repo.append("sim1", [
        makeEventInput(), makeEventInput(), makeEventInput(),
        makeEventInput(), makeEventInput(),
      ]);

      const recent = await repo.getRecent("sim1", 3);
      expect(recent.length).toBeLessThanOrEqual(3);
      for (let i = 1; i < recent.length; i++) {
        expect(recent[i]!.createdAt).toBeGreaterThanOrEqual(recent[i - 1]!.createdAt);
      }
    });

    it("pulseIndex increments between separate append calls", async () => {
      const first = await repo.append("sim1", [makeEventInput()]);
      const second = await repo.append("sim1", [makeEventInput()]);

      expect(second[0]!.pulseIndex).toBeGreaterThan(first[0]!.pulseIndex);
    });

    it("append to different simulationIds is isolated", async () => {
      await repo.append("simA", [makeEventInput()]);
      await repo.append("simB", [makeEventInput()]);

      const a = await repo.getAfter("simA");
      const b = await repo.getAfter("simB");

      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
      expect(a[0]!.id).not.toBe(b[0]!.id);
    });
  });
}

// ── Agent State Repository Contract ──────────────────────────────────────────

export type AgentStateRepoFactory = () => Promise<{
  repo: IAgentStateRepository;
  teardown: () => Promise<void>;
}>;

export function runAgentStateRepositoryContract(factory: AgentStateRepoFactory): void {
  describe("IAgentStateRepository contract", () => {
    let repo: IAgentStateRepository;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
      const result = await factory();
      repo = result.repo;
      teardown = result.teardown;
    });

    afterEach(async () => {
      await teardown();
    });

    it("get returns null for unknown agent", async () => {
      const result = await repo.get("sim1", "unknown");
      expect(result).toBeNull();
    });

    it("upsert then get returns the same agent state", async () => {
      const state = makeAgentState("a1");
      await repo.upsert(state);

      const found = await repo.get("sim1", "a1");
      expect(found).not.toBeNull();
      expect(found!.agentId).toBe("a1");
      expect(found!.simulationId).toBe("sim1");
    });

    it("upsert updates existing agent state", async () => {
      const state = makeAgentState("a1");
      await repo.upsert(state);

      const updated: AgentState = {
        ...state,
        coreMood: { ...state.coreMood, valence: 0.9 },
        updatedAt: Date.now(),
      };
      await repo.upsert(updated);

      const found = await repo.get("sim1", "a1");
      expect(found!.coreMood.valence).toBeCloseTo(0.9, 3);
    });

    it("listBySimulation returns all agents for simulation", async () => {
      await repo.upsert(makeAgentState("a1"));
      await repo.upsert(makeAgentState("a2"));

      const list = await repo.listBySimulation("sim1");
      expect(list.length).toBeGreaterThanOrEqual(2);
      const ids = list.map(s => s.agentId);
      expect(ids).toContain("a1");
      expect(ids).toContain("a2");
    });

    it("listBySimulation is isolated per simulation", async () => {
      await repo.upsert(makeAgentState("a1", "simA"));
      await repo.upsert(makeAgentState("a1", "simB"));

      const listA = await repo.listBySimulation("simA");
      const listB = await repo.listBySimulation("simB");

      expect(listA.every(s => s.simulationId === "simA")).toBe(true);
      expect(listB.every(s => s.simulationId === "simB")).toBe(true);
    });
  });
}

// ── Memory Repository Contract ─────────────────────────────────────────────────

export type MemoryRepoFactory = () => Promise<{
  repo: IMemoryRepository;
  teardown: () => Promise<void>;
}>;

export function runMemoryRepositoryContract(factory: MemoryRepoFactory): void {
  describe("IMemoryRepository contract", () => {
    let repo: IMemoryRepository;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
      const result = await factory();
      repo = result.repo;
      teardown = result.teardown;
    });

    afterEach(async () => {
      await teardown();
    });

    it("getByAgent returns empty array for unknown agent", async () => {
      const result = await repo.getByAgent("sim1", "unknown");
      expect(result).toHaveLength(0);
    });

    it("upsert then getByAgent returns memory", async () => {
      const mem = makeMemory("m1", "a1");
      await repo.upsert(mem);

      const found = await repo.getByAgent("sim1", "a1");
      expect(found).toHaveLength(1);
      expect(found[0]!.id).toBe("m1");
    });

    it("upsert updates existing memory", async () => {
      const mem = makeMemory("m1", "a1");
      await repo.upsert(mem);
      await repo.upsert({ ...mem, summary: "Updated summary", confidence: 0.99 });

      const found = await repo.getByAgent("sim1", "a1");
      expect(found[0]!.summary).toBe("Updated summary");
      expect(found[0]!.confidence).toBeCloseTo(0.99, 3);
    });

    it("getBySubject returns memories where agent is a subject", async () => {
      const mem = makeMemory("m1", "a1", "sim1", ["a2", "a3"]);
      await repo.upsert(mem);

      const byA2 = await repo.getBySubject("sim1", "a2");
      expect(byA2.map(m => m.id)).toContain("m1");

      const byA3 = await repo.getBySubject("sim1", "a3");
      expect(byA3.map(m => m.id)).toContain("m1");
    });

    it("getBySubject does not return memories where agent is not a subject", async () => {
      const mem = makeMemory("m1", "a1", "sim1", ["a2"]);
      await repo.upsert(mem);

      const byA3 = await repo.getBySubject("sim1", "a3");
      expect(byA3.map(m => m.id)).not.toContain("m1");
    });

    it("memories are isolated by simulationId", async () => {
      await repo.upsert(makeMemory("m1", "a1", "simA"));
      await repo.upsert(makeMemory("m2", "a1", "simB"));

      const simA = await repo.getByAgent("simA", "a1");
      const simB = await repo.getByAgent("simB", "a1");

      expect(simA.map(m => m.id)).toContain("m1");
      expect(simA.map(m => m.id)).not.toContain("m2");
      expect(simB.map(m => m.id)).toContain("m2");
    });
  });
}

// ── Simulation Repository Contract ────────────────────────────────────────────

export type SimulationRepoFactory = () => Promise<{
  repo: ISimulationRepository;
  teardown: () => Promise<void>;
}>;

export function runSimulationRepositoryContract(factory: SimulationRepoFactory): void {
  describe("ISimulationRepository contract", () => {
    let repo: ISimulationRepository;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
      const result = await factory();
      repo = result.repo;
      teardown = result.teardown;
    });

    afterEach(async () => {
      await teardown();
    });

    it("create then get returns simulation", async () => {
      const input = makeSimulationInput("sim1");
      await repo.create(input);

      const found = await repo.get("sim1");
      expect(found).not.toBeNull();
      expect(found!.id).toBe("sim1");
      expect(found!.name).toBe("Sim sim1");
      expect(found!.status).toBe("initializing");
    });

    it("get returns null for unknown simulation", async () => {
      const result = await repo.get("unknown");
      expect(result).toBeNull();
    });

    it("updateStatus changes simulation status", async () => {
      await repo.create(makeSimulationInput("sim1"));
      await repo.updateStatus("sim1", "paused");

      const found = await repo.get("sim1");
      expect(found!.status).toBe("paused");
    });

    it("updateSettings merges partial settings", async () => {
      await repo.create(makeSimulationInput("sim1"));
      await repo.updateSettings("sim1", { pulseIntervalMs: 5000 });

      const found = await repo.get("sim1");
      expect(found!.settings.pulseIntervalMs).toBe(5000);
      expect(found!.settings.allowPrivateChannels).toBe(true); // unchanged
    });

    it("list returns all created simulations", async () => {
      await repo.create(makeSimulationInput("simA"));
      await repo.create(makeSimulationInput("simB"));

      const list = await repo.list();
      const ids = list.map(s => s.id);
      expect(ids).toContain("simA");
      expect(ids).toContain("simB");
    });
  });
}

// ── Channel Repository Contract ────────────────────────────────────────────────

export type ChannelRepoFactory = () => Promise<{
  repo: IChannelRepository;
  teardown: () => Promise<void>;
}>;

export function runChannelRepositoryContract(factory: ChannelRepoFactory): void {
  describe("IChannelRepository contract", () => {
    let repo: IChannelRepository;
    let teardown: () => Promise<void>;

    beforeEach(async () => {
      const result = await factory();
      repo = result.repo;
      teardown = result.teardown;
    });

    afterEach(async () => {
      await teardown();
    });

    it("create then getById returns channel", async () => {
      const ch = makeChannel("ch1");
      await repo.create(ch);

      const found = await repo.getById("ch1");
      expect(found).not.toBeNull();
      expect(found!.id).toBe("ch1");
      expect(found!.type).toBe("public_channel");
    });

    it("getById returns null for unknown channel", async () => {
      const result = await repo.getById("unknown");
      expect(result).toBeNull();
    });

    it("listBySimulation returns all channels for simulation", async () => {
      await repo.create(makeChannel("ch1"));
      await repo.create(makeChannel("ch2"));

      const list = await repo.listBySimulation("sim1");
      const ids = list.map(c => c.id);
      expect(ids).toContain("ch1");
      expect(ids).toContain("ch2");
    });

    it("updateMembers changes memberAgentIds", async () => {
      const ch = makeChannel("ch1");
      await repo.create(ch);
      await repo.updateMembers("ch1", ["a1", "a2", "a3"]);

      const found = await repo.getById("ch1");
      expect(found!.memberAgentIds).toContain("a3");
    });

    it("archive sets channel status to archived", async () => {
      const ch = makeChannel("ch1");
      await repo.create(ch);
      await repo.archive("ch1");

      const found = await repo.getById("ch1");
      expect(found!.status).toBe("archived");
    });

    it("addMembership then getMembership returns the membership", async () => {
      const ch = makeChannel("ch1");
      await repo.create(ch);

      const membership: ChannelMembership = {
        channelId: "ch1",
        agentId: "a99",
        joinedAt: 1700000000000,
      };
      await repo.addMembership(membership);

      const memberships = await repo.getMembership("ch1");
      const ids = memberships.map(m => m.agentId);
      expect(ids).toContain("a99");
    });

    it("removeMembership sets leftAt on the membership", async () => {
      const ch = makeChannel("ch1");
      await repo.create(ch);

      const membership: ChannelMembership = {
        channelId: "ch1",
        agentId: "a1",
        joinedAt: 1700000000000,
      };
      await repo.addMembership(membership);
      await repo.removeMembership("ch1", "a1");

      const memberships = await repo.getMembership("ch1");
      const a1 = memberships.find(m => m.agentId === "a1");
      // Either removed entirely or leftAt is set
      if (a1) {
        expect(a1.leftAt).toBeTruthy();
      }
    });
  });
}
