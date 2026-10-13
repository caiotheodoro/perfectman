import { describe, expect, it } from "vitest";
import { buildConfiguredSimulation, parseSimulationConfig, type SimulationAppConfig } from "../simulation-config.js";
import { MockDeliveryGateway } from "../../delivery/index.js";
import { llm, persona, promptProfile } from "./fixtures.js";

function baseConfig(): SimulationAppConfig {
  return parseSimulationConfig({
    simulation: {
      id: "sim_look_test",
      name: "Look Test",
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

describe("scene clock and look in the config", () => {
  it("carries the scene clock and look into the gateway metadata, and rejects a bad setting", async () => {
    const config = baseConfig();
    const withLook = parseSimulationConfig({
      ...config,
      storyClock: { start: "23:40", minutesPerPulse: 4 },
      setting: "rooftop",
      props: ["cat", "notice-board"],
      rooms: ["stairwell"],
    });
    const handle = await buildConfiguredSimulation(withLook);
    try {
      const meta = (handle.gateways["mock"] as MockDeliveryGateway).runtimeMetadata;
      expect(meta?.storyClock).toEqual({ start: "23:40", minutesPerPulse: 4 });
      expect(meta?.look).toEqual({ setting: "rooftop", props: ["cat", "notice-board"], rooms: ["stairwell"] });
    } finally {
      await handle.close();
    }
    expect(() => parseSimulationConfig({ ...config, setting: "moon-base" })).toThrow(/setting must be one of/);
    expect(() => parseSimulationConfig({ ...config, props: ["Bad Prop"] })).toThrow(/props must be/);
  });
});
