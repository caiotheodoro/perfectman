import { describe, expect, it } from "vitest";
import { buildConfiguredSimulation, parseSimulationConfig, type SimulationAppConfig } from "../simulation-config.js";
import { llm, persona, promptProfile } from "./fixtures.js";

function baseConfig(): SimulationAppConfig {
  return parseSimulationConfig({
    simulation: {
      id: "sim_hotel_config_test",
      name: "Hotel Config Test",
      seed: 1,
      settings: {
        omniscientSpectatorMode: false,
        allowPrivateChannels: true,
        maxPrivateChannelsPerAgent: 3,
        maxMessagesPerMinutePerAgent: 30,
        llmCallBudgetPerMinute: 100,
        pulseIntervalMs: 1000,
        tokenBudgetPerHour: 1_000_000,
      },
    },
    persistence: { type: "memory" },
    deliveryGateways: [{ id: "mock", type: "mock" }],
    channels: [{ id: "general", type: "public_channel", name: "general", default: true, memberAgentIds: ["ana"] }],
    agents: [{ id: "ana", persona, promptProfile, llm }],
  });
}

describe("hotel mode in the config builder", () => {
  it("registers the simulation's own warn-mode budget on the tracker and forgets it on close", async () => {
    const handle = await buildConfiguredSimulation(baseConfig(), { hotel: { pulseMode: "split", budget: { callsPerMinute: 7 } } });
    const limits = handle.budget.getLimits(handle.simulationId);
    expect(limits).toMatchObject({ mode: "warn", softLimits: { callsPerMinute: 7 } });
    expect(limits.llmCallBudgetPerMinute).toBeGreaterThan(100_000);
    await handle.close();
    // The registered limits are gone: the tracker falls back to its defaults.
    expect(handle.budget.getLimits(handle.simulationId).mode).toBeUndefined();
  });

  it("without hotel mode the scenario's own settings are the budget, as ever", async () => {
    const handle = await buildConfiguredSimulation(baseConfig());
    try {
      expect(handle.budget.getLimits(handle.simulationId)).toMatchObject({ llmCallBudgetPerMinute: 100, tokenBudgetPerHour: 1_000_000 });
      expect(handle.budget.getLimits(handle.simulationId).mode).toBeUndefined();
    } finally {
      await handle.close();
    }
  });
});
