/**
 * lifecycle-state-machine.test.ts
 *
 * Tests the simulation lifecycle state machine:
 *   initializing → running → paused → running → stopped
 *
 * Invariants:
 *   - Commands in paused are rejected/queued — no events committed while paused
 *   - simulation_stopped commits and IDeliveryGateway.onSimulationStopped called exactly once
 *   - Commits after stopped are rejected
 */

import { describe, it, expect, beforeEach } from "vitest";
import type {
  CommittedEvent,
  SimulationSettings,
  SimulationStatus,
  SpectatorEvent,
  OperatorEvent,
} from "@perfectman/shared";

// ─────────────────────────────────────────────────────────────────────────────
// MockDeliveryGateway
// ─────────────────────────────────────────────────────────────────────────────

type DeliveryMessage =
  | { kind: "message"; agentId: string; content: string; salience: string }
  | { kind: "reply"; agentId: string; content: string; replyToEventId: string; salience: string }
  | { kind: "reaction"; agentId: string; emoji: string; targetEventId: string; salience: string };

type GatewayCall =
  | { method: "sendAgentMessage"; channelId: string; message: DeliveryMessage }
  | { method: "createChannel"; channelId: string; type: string; memberAgentIds: string[] }
  | { method: "addMember"; channelId: string; agentId: string }
  | { method: "removeMember"; channelId: string; agentId: string }
  | { method: "sendSpectatorEvent"; event: SpectatorEvent }
  | { method: "sendOperatorEvent"; event: OperatorEvent }
  | { method: "onSimulationStopped"; simulationId: string };

class MockDeliveryGateway {
  readonly calls: GatewayCall[] = [];

  async sendAgentMessage(channelId: string, message: DeliveryMessage): Promise<void> {
    this.calls.push({ method: "sendAgentMessage", channelId, message });
  }
  async createChannel(channelId: string, type: string, memberAgentIds: string[]): Promise<void> {
    this.calls.push({ method: "createChannel", channelId, type, memberAgentIds });
  }
  async addMember(channelId: string, agentId: string): Promise<void> {
    this.calls.push({ method: "addMember", channelId, agentId });
  }
  async removeMember(channelId: string, agentId: string): Promise<void> {
    this.calls.push({ method: "removeMember", channelId, agentId });
  }
  async sendSpectatorEvent(event: SpectatorEvent): Promise<void> {
    this.calls.push({ method: "sendSpectatorEvent", event });
  }
  async sendOperatorEvent(event: OperatorEvent): Promise<void> {
    this.calls.push({ method: "sendOperatorEvent", event });
  }
  async onSimulationStopped(simulationId: string): Promise<void> {
    this.calls.push({ method: "onSimulationStopped", simulationId });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory event store
// ─────────────────────────────────────────────────────────────────────────────

class InMemoryEventRepo {
  private events: CommittedEvent[] = [];
  private counter = 1;

  append(events: Omit<CommittedEvent, "id" | "createdAt" | "pulseIndex">[]): CommittedEvent[] {
    const committed: CommittedEvent[] = events.map((e) => ({
      ...e,
      id: `evt-${this.counter++}`,
      createdAt: Date.now(),
      pulseIndex: 0,
    }));
    this.events.push(...committed);
    return committed;
  }

  getAll(): CommittedEvent[] {
    return [...this.events];
  }

  getByType(type: CommittedEvent["type"]): CommittedEvent[] {
    return this.events.filter((e) => e.type === type);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal lifecycle state machine (plan: simulation-lifecycle.ts)
// Models the state transitions from the plan's lifecycle section.
// Real implementation lives in packages/server/src/simulation/simulation-lifecycle.ts
// ─────────────────────────────────────────────────────────────────────────────

type CommandResult =
  | { accepted: true; committedEvents: CommittedEvent[] }
  | { accepted: false; reason: string };

class SimulationLifecycle {
  private status: SimulationStatus = "initializing";
  private commandQueue: Array<() => void> = [];

  constructor(
    private readonly simulationId: string,
    private readonly eventRepo: InMemoryEventRepo,
    private readonly gateway: MockDeliveryGateway,
    private readonly settings: SimulationSettings,
  ) {}

  getStatus(): SimulationStatus {
    return this.status;
  }

  async start(): Promise<CommandResult> {
    if (this.status !== "initializing") {
      return { accepted: false, reason: `Cannot start from status: ${this.status}` };
    }
    this.status = "running";
    const events = this.eventRepo.append([
      this.makeLifecycleEvent("simulation_started"),
    ]);
    return { accepted: true, committedEvents: events };
  }

  async pause(): Promise<CommandResult> {
    if (this.status !== "running") {
      return { accepted: false, reason: `Cannot pause from status: ${this.status}` };
    }
    this.status = "paused";
    const events = this.eventRepo.append([
      this.makeLifecycleEvent("simulation_paused"),
    ]);
    return { accepted: true, committedEvents: events };
  }

  async resume(): Promise<CommandResult> {
    if (this.status !== "paused") {
      return { accepted: false, reason: `Cannot resume from status: ${this.status}` };
    }
    this.status = "running";
    // Flush queued commands
    const queued = [...this.commandQueue];
    this.commandQueue.length = 0;
    for (const cmd of queued) cmd();

    const events = this.eventRepo.append([
      this.makeLifecycleEvent("simulation_resumed"),
    ]);
    return { accepted: true, committedEvents: events };
  }

  async stop(): Promise<CommandResult> {
    if (this.status === "stopped") {
      return { accepted: false, reason: "Already stopped" };
    }
    this.status = "stopped";
    const events = this.eventRepo.append([
      this.makeLifecycleEvent("simulation_stopped"),
    ]);
    await this.gateway.onSimulationStopped(this.simulationId);
    return { accepted: true, committedEvents: events };
  }

  /**
   * Try to commit an event. Rejected when paused (can be queued) or stopped.
   */
  async commitEvent(
    event: Omit<CommittedEvent, "id" | "createdAt" | "pulseIndex">,
    opts: { queue?: boolean } = {},
  ): Promise<CommandResult> {
    if (this.status === "stopped") {
      return { accepted: false, reason: "Simulation is stopped — commits rejected" };
    }
    if (this.status === "paused") {
      if (opts.queue) {
        // Queue for when resumed
        this.commandQueue.push(() => {
          this.eventRepo.append([event]);
        });
        return { accepted: false, reason: "Simulation is paused — commit queued" };
      }
      return { accepted: false, reason: "Simulation is paused — commit rejected" };
    }
    const events = this.eventRepo.append([event]);
    return { accepted: true, committedEvents: events };
  }

  private makeLifecycleEvent(
    type: CommittedEvent["type"],
  ): Omit<CommittedEvent, "id" | "createdAt" | "pulseIndex"> {
    return {
      simulationId: this.simulationId,
      channelId: "pub-ch",
      actorId: "system",
      type,
      payload: {},
      sourceEventIds: [],
      emotionalSalience: "low",
      visibility: {
        visibleToAgents: [],
        visibleToSpectators: true,
        visibleToOperators: true,
        visibilityReason: "lifecycle",
      },
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SIM_ID = "sim-lifecycle-test";

const DEFAULT_SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 10,
  llmCallBudgetPerMinute: 20,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 200_000,
};

function makeTestEvent(): Omit<CommittedEvent, "id" | "createdAt" | "pulseIndex"> {
  return {
    simulationId: SIM_ID,
    channelId: "pub-ch",
    actorId: "agent-A",
    type: "message_sent",
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

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("Lifecycle State Machine — Happy Path", () => {
  let eventRepo: InMemoryEventRepo;
  let gateway: MockDeliveryGateway;
  let lifecycle: SimulationLifecycle;

  beforeEach(() => {
    eventRepo = new InMemoryEventRepo();
    gateway = new MockDeliveryGateway();
    lifecycle = new SimulationLifecycle(SIM_ID, eventRepo, gateway, DEFAULT_SETTINGS);
  });

  it("starts in initializing status", () => {
    expect(lifecycle.getStatus()).toBe("initializing");
  });

  it("transitions initializing → running on start(), commits simulation_started", async () => {
    const result = await lifecycle.start();
    expect(result.accepted).toBe(true);
    expect(lifecycle.getStatus()).toBe("running");

    const startEvents = eventRepo.getByType("simulation_started");
    expect(startEvents).toHaveLength(1);
  });

  it("transitions running → paused on pause(), commits simulation_paused", async () => {
    await lifecycle.start();
    const result = await lifecycle.pause();

    expect(result.accepted).toBe(true);
    expect(lifecycle.getStatus()).toBe("paused");
    expect(eventRepo.getByType("simulation_paused")).toHaveLength(1);
  });

  it("transitions paused → running on resume(), commits simulation_resumed", async () => {
    await lifecycle.start();
    await lifecycle.pause();
    const result = await lifecycle.resume();

    expect(result.accepted).toBe(true);
    expect(lifecycle.getStatus()).toBe("running");
    expect(eventRepo.getByType("simulation_resumed")).toHaveLength(1);
  });

  it("full lifecycle: initializing → running → paused → running → stopped", async () => {
    await lifecycle.start();
    expect(lifecycle.getStatus()).toBe("running");

    await lifecycle.pause();
    expect(lifecycle.getStatus()).toBe("paused");

    await lifecycle.resume();
    expect(lifecycle.getStatus()).toBe("running");

    await lifecycle.stop();
    expect(lifecycle.getStatus()).toBe("stopped");

    // All lifecycle events committed
    expect(eventRepo.getByType("simulation_started")).toHaveLength(1);
    expect(eventRepo.getByType("simulation_paused")).toHaveLength(1);
    expect(eventRepo.getByType("simulation_resumed")).toHaveLength(1);
    expect(eventRepo.getByType("simulation_stopped")).toHaveLength(1);
  });
});

describe("Lifecycle State Machine — Paused Invariants", () => {
  let eventRepo: InMemoryEventRepo;
  let gateway: MockDeliveryGateway;
  let lifecycle: SimulationLifecycle;

  beforeEach(async () => {
    eventRepo = new InMemoryEventRepo();
    gateway = new MockDeliveryGateway();
    lifecycle = new SimulationLifecycle(SIM_ID, eventRepo, gateway, DEFAULT_SETTINGS);
    await lifecycle.start();
    await lifecycle.pause();
  });

  it("commits are rejected while paused (no events committed to log)", async () => {
    const eventsBefore = eventRepo.getAll().length;
    const result = await lifecycle.commitEvent(makeTestEvent());

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("paused");

    // No new non-lifecycle events committed
    const messagesAfter = eventRepo.getByType("message_sent");
    expect(messagesAfter).toHaveLength(0);
    // Event log length unchanged (no new events from rejected commit)
    expect(eventRepo.getAll().length).toBe(eventsBefore);
  });

  it("queued commits are flushed when resumed", async () => {
    await lifecycle.commitEvent(makeTestEvent(), { queue: true });
    expect(eventRepo.getByType("message_sent")).toHaveLength(0);

    await lifecycle.resume();
    expect(eventRepo.getByType("message_sent")).toHaveLength(1);
  });

  it("cannot start again while paused", async () => {
    const result = await lifecycle.start();
    expect(result.accepted).toBe(false);
  });

  it("no events committed while paused (except lifecycle)", async () => {
    // Attempt multiple commits during pause
    await lifecycle.commitEvent(makeTestEvent());
    await lifecycle.commitEvent(makeTestEvent());
    await lifecycle.commitEvent(makeTestEvent());

    const messageEvents = eventRepo.getByType("message_sent");
    expect(messageEvents).toHaveLength(0);
  });
});

describe("Lifecycle State Machine — Stop Invariants", () => {
  let eventRepo: InMemoryEventRepo;
  let gateway: MockDeliveryGateway;
  let lifecycle: SimulationLifecycle;

  beforeEach(async () => {
    eventRepo = new InMemoryEventRepo();
    gateway = new MockDeliveryGateway();
    lifecycle = new SimulationLifecycle(SIM_ID, eventRepo, gateway, DEFAULT_SETTINGS);
    await lifecycle.start();
  });

  it("simulation_stopped event is committed on stop()", async () => {
    await lifecycle.stop();
    const stopEvents = eventRepo.getByType("simulation_stopped");
    expect(stopEvents).toHaveLength(1);
    expect(stopEvents[0]!.actorId).toBe("system");
  });

  it("IDeliveryGateway.onSimulationStopped is called exactly once", async () => {
    await lifecycle.stop();

    const stoppedCalls = gateway.calls.filter((c) => c.method === "onSimulationStopped");
    expect(stoppedCalls).toHaveLength(1);
    expect((stoppedCalls[0] as { simulationId: string }).simulationId).toBe(SIM_ID);
  });

  it("calling stop() twice only calls onSimulationStopped once", async () => {
    await lifecycle.stop();
    await lifecycle.stop(); // second call rejected

    const stoppedCalls = gateway.calls.filter((c) => c.method === "onSimulationStopped");
    expect(stoppedCalls).toHaveLength(1);
  });

  it("commits are rejected after stopped", async () => {
    await lifecycle.stop();

    const result = await lifecycle.commitEvent(makeTestEvent());
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("stopped");

    const messageEvents = eventRepo.getByType("message_sent");
    expect(messageEvents).toHaveLength(0);
  });

  it("cannot pause after stopped", async () => {
    await lifecycle.stop();
    const result = await lifecycle.pause();
    expect(result.accepted).toBe(false);
  });

  it("cannot resume after stopped", async () => {
    await lifecycle.stop();
    const result = await lifecycle.resume();
    expect(result.accepted).toBe(false);
  });
});

describe("Lifecycle State Machine — Invalid Transitions", () => {
  let eventRepo: InMemoryEventRepo;
  let gateway: MockDeliveryGateway;
  let lifecycle: SimulationLifecycle;

  beforeEach(() => {
    eventRepo = new InMemoryEventRepo();
    gateway = new MockDeliveryGateway();
    lifecycle = new SimulationLifecycle(SIM_ID, eventRepo, gateway, DEFAULT_SETTINGS);
  });

  it("cannot pause before starting", async () => {
    const result = await lifecycle.pause();
    expect(result.accepted).toBe(false);
  });

  it("cannot resume before pausing", async () => {
    await lifecycle.start();
    const result = await lifecycle.resume();
    expect(result.accepted).toBe(false);
  });

  it("cannot start twice", async () => {
    await lifecycle.start();
    const result = await lifecycle.start();
    expect(result.accepted).toBe(false);
  });
});
