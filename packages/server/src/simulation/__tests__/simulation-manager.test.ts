import { describe, it, expect } from "vitest";
import { SimulationManager } from "../simulation-manager.js";
import { InMemorySimulationRepository, InMemoryChannelRepository, InMemoryEventRepository } from "../in-memory-stores.js";
import { ChannelRegistry } from "../channel-registry.js";
import { EventLog } from "../event-log.js";
import { MockDeliveryGateway } from "./mock-delivery-gateway.js";
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
});
