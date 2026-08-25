import { describe, it, expect } from "vitest";
import { SimulationManager } from "../simulation-manager.js";
import { InMemorySimulationRepository, InMemoryChannelRepository, InMemoryEventRepository } from "../in-memory-stores.js";
import { ChannelRegistry } from "../channel-registry.js";
import { EventLog } from "../event-log.js";
import { MockDeliveryGateway } from "../../delivery/mock-delivery-gateway.js";
import type { SimulationSettings } from "@perfectman/shared";

const SETTINGS: SimulationSettings = {
  omniscientSpectatorMode: false,
  allowPrivateChannels: true,
  maxPrivateChannelsPerAgent: 3,
  maxMessagesPerMinutePerAgent: 20,
  llmCallBudgetPerMinute: 10,
  pulseIntervalMs: 3000,
  tokenBudgetPerHour: 1_000_000,
};

describe("SimulationManager", () => {
  it("rejects non-positive pulseIntervalMs", async () => {
    const manager = new SimulationManager(
      new InMemorySimulationRepository(),
      new ChannelRegistry(new InMemoryChannelRepository()),
      new EventLog(new InMemoryEventRepository()),
      new MockDeliveryGateway(),
    );

    await expect(manager.create({
      name: "bad interval",
      agentIds: ["agent_1"],
      settings: { ...SETTINGS, pulseIntervalMs: 0 },
      seed: 1,
    })).rejects.toThrow("pulseIntervalMs must be greater than 0");
  });

  it("stop threads endReason and endingOffer into the committed payload", async () => {
    const eventLog = new EventLog(new InMemoryEventRepository());
    const manager = new SimulationManager(
      new InMemorySimulationRepository(),
      new ChannelRegistry(new InMemoryChannelRepository()),
      eventLog,
      new MockDeliveryGateway(),
    );

    const { simulation } = await manager.create({
      name: "stop payload",
      agentIds: ["agent_1"],
      settings: SETTINGS,
      seed: 1,
    });
    await manager.start(simulation.id);
    await manager.stop(simulation.id, 5, "goal_end_offered", {
      goalId: "goal_1",
      reasons: ["story complete"],
      epilogue: "Ana found her footing.",
      status: "pending",
    });

    const events = await eventLog.getAfter(simulation.id);
    const stopped = events.find(e => e.type === "simulation_stopped");
    expect(stopped?.payload).toMatchObject({
      simulationId: simulation.id,
      endReason: "goal_end_offered",
      endingOffer: {
        goalId: "goal_1",
        reasons: ["story complete"],
        epilogue: "Ana found her footing.",
        status: "pending",
      },
    });
  });

  it("stop without reason/offer keeps the stopped payload minimal", async () => {
    const eventLog = new EventLog(new InMemoryEventRepository());
    const manager = new SimulationManager(
      new InMemorySimulationRepository(),
      new ChannelRegistry(new InMemoryChannelRepository()),
      eventLog,
      new MockDeliveryGateway(),
    );

    const { simulation } = await manager.create({
      name: "stop plain",
      agentIds: ["agent_1"],
      settings: SETTINGS,
      seed: 1,
    });
    await manager.start(simulation.id);
    await manager.stop(simulation.id, 5);

    const events = await eventLog.getAfter(simulation.id);
    const stopped = events.find(e => e.type === "simulation_stopped");
    expect(stopped?.payload).toEqual({ simulationId: simulation.id });
  });

  it("double stop commits a single stopped event (fresh status refetch each call)", async () => {
    const eventLog = new EventLog(new InMemoryEventRepository());
    const manager = new SimulationManager(
      new InMemorySimulationRepository(),
      new ChannelRegistry(new InMemoryChannelRepository()),
      eventLog,
      new MockDeliveryGateway(),
    );

    const { simulation } = await manager.create({
      name: "stop twice",
      agentIds: ["agent_1"],
      settings: SETTINGS,
      seed: 1,
    });
    await manager.start(simulation.id);
    await manager.stop(simulation.id, 5, "goal_end_offered", {
      goalId: "goal_1",
      reasons: [],
      epilogue: "ep",
      status: "pending",
    });
    await manager.stop(simulation.id, 6, "operator_command");

    const events = await eventLog.getAfter(simulation.id);
    expect(events.filter(e => e.type === "simulation_stopped")).toHaveLength(1);
    const stopped = events.find(e => e.type === "simulation_stopped");
    expect(stopped?.payload.endReason).toBe("goal_end_offered");
  });
});
