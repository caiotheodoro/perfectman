import { describe, expect, it } from "vitest";
import {
  buildConfiguredSimulation,
  findDefaultSimulationConfigPath,
  parseSimulationConfig,
  type SimulationAppConfig,
} from "../simulation-config.js";

const persona = {
  id: "ana",
  name: "Ana",
  archetype: "observer",
  writingStyle: "brief and careful",
  styleExamples: ["oi", "entendi"],
};

const promptProfile = {
  personaId: "ana",
  displayName: "Ana",
  identityFrame: "You are Ana.",
  voiceGuidelines: ["Keep it short."],
  styleExamples: ["oi"],
  relationshipBiases: {},
  language: "pt-BR",
};

const llm = {
  providerType: "mock",
  modelName: "mock-model",
  maxInputTokens: 2048,
  maxOutputTokens: 512,
  temperature: 0.7,
  timeoutMs: 5000,
  retryCount: 1,
};

function baseConfig(): SimulationAppConfig {
  return parseSimulationConfig({
    simulation: {
      id: "sim_config_test",
      name: "Config Test",
      seed: 42,
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
    channels: [{
      id: "general",
      type: "public_channel",
      name: "general",
      default: true,
      memberAgentIds: ["ana"],
    }],
    agents: [{
      id: "ana",
      persona,
      promptProfile,
      llm,
    }],
  });
}

describe("simulation config", () => {
  it("parses a complete config", () => {
    const config = baseConfig();
    expect(config.simulation.id).toBe("sim_config_test");
    expect(config.agents[0]?.persona.id).toBe("ana");
  });

  it("rejects duplicate agent ids", () => {
    const config = baseConfig();
    expect(() => parseSimulationConfig({
      ...config,
      agents: [config.agents[0], config.agents[0]],
    })).toThrow("Duplicate agent id");
  });

  it("rejects raw LLM secrets", () => {
    const config = baseConfig();
    expect(() => parseSimulationConfig({
      ...config,
      agents: [{
        ...config.agents[0],
        llm: { ...llm, apiKey: "secret" },
      }],
    })).toThrow("env field names only");
  });

  it("rejects simulation calibration fields in persona config", () => {
    const config = baseConfig();
    expect(() => parseSimulationConfig({
      ...config,
      agents: [{
        ...config.agents[0],
        persona: { ...persona, baselineValence: 0.1 },
      }],
    })).toThrow("simulation calibration");
  });

  it("builds a memory-backed configured runtime", async () => {
    const handle = await buildConfiguredSimulation(baseConfig());
    try {
      await handle.runtime.start(handle.simulationId);
      await handle.runtime.stop(handle.simulationId);
      const events = await handle.runtime.getEventLog().getAfter(handle.simulationId);
      expect(events.map(event => event.type)).toContain("simulation_started");
      expect(events.map(event => event.type)).toContain("simulation_stopped");
    } finally {
      await handle.close();
    }
  });

  it("finds the default config path from a nested workspace directory", () => {
    const fixturesDir = new URL("./fixtures", import.meta.url).pathname;
    const path = findDefaultSimulationConfigPath(fixturesDir);
    expect(path.endsWith("config/index.json")).toBe(true);
  });
});
