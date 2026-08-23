import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildConfiguredSimulation,
  findDefaultSimulationConfigPath,
  loadSimulationConfig,
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

  it("parses an optional judge section with a jury", () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      judge: {
        providerType: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        modelName: "deepseek-chat",
        apiKeyEnv: "DEEPSEEK_API_KEY",
        temperature: 0,
        timeoutMs: 90000,
        retryCount: 1,
        jury: [
          { providerType: "openai-compatible", modelName: "qwen3:8b", label: "local-qwen" },
        ],
      },
    });
    expect(parsed.judge?.providerType).toBe("openai-compatible");
    expect(parsed.judge?.jury).toHaveLength(1);
    expect(parsed.judge?.jury![0]!.label).toBe("local-qwen");
  });

  it("rejects an invalid judge section with the same error style", () => {
    const config = baseConfig();
    expect(() => parseSimulationConfig({
      ...config,
      judge: { providerType: "deepseek", modelName: "x" },
    })).toThrow(/judge: /);
  });

  it("rejects duplicate jury labels inside the judge section", () => {
    const config = baseConfig();
    expect(() => parseSimulationConfig({
      ...config,
      judge: {
        providerType: "openai-compatible",
        modelName: "deepseek-chat",
        jury: [
          { providerType: "openai-compatible", modelName: "a", label: "same" },
          { providerType: "openai-compatible", modelName: "b", label: "same" },
        ],
      },
    })).toThrow(/Duplicate jury judge labels: same/);
  });

  it("accepts the generic qwen3 provider type", () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      agents: [{
        ...config.agents[0],
        llm: {
          ...llm,
          providerType: "qwen3_8b",
          baseUrl: "http://localhost:11434/v1",
          modelName: "qwen3:1.7b",
          extraBody: { stream: false },
        },
      }],
    });

    expect(parsed.agents[0]?.llm.providerType).toBe("qwen3_8b");
    expect(parsed.agents[0]?.llm.modelName).toBe("qwen3:1.7b");
  });

  it("defaults extraBody.think to false for the ollama provider when omitted", () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      agents: [{
        ...config.agents[0],
        llm: {
          ...llm,
          providerType: "ollama",
          baseUrl: "http://localhost:11434/v1",
          modelName: "qwen3:1.7b",
          // no extraBody at all — this is the real-world gap: a config
          // that doesn't know to opt into think:false previously hit the
          // exact same 100%-fallback bug the eval harness had.
        },
      }],
    });

    expect(parsed.agents[0]?.llm.extraBody).toEqual({ think: false });
  });

  it("does not override an explicit extraBody.think for the ollama provider", () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      agents: [{
        ...config.agents[0],
        llm: {
          ...llm,
          providerType: "ollama",
          baseUrl: "http://localhost:11434/v1",
          modelName: "qwen3:1.7b",
          extraBody: { think: true, top_p: 0.9 },
        },
      }],
    });

    expect(parsed.agents[0]?.llm.extraBody).toEqual({ think: true, top_p: 0.9 });
  });

  it("does not inject think for non-ollama providers", () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      agents: [{
        ...config.agents[0],
        llm: {
          ...llm,
          providerType: "qwen3_8b",
          baseUrl: "http://localhost:11434/v1",
          modelName: "qwen3:1.7b",
        },
      }],
    });

    expect(parsed.agents[0]?.llm.extraBody).toBeUndefined();
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

  it("loads an agent persona and prompt profile from a local personaFile", async () => {
    const dir = await mkdtemp(join(tmpdir(), "perfectman-config-"));
    try {
      const personaPath = join(dir, "ana.persona.json");
      const configPath = join(dir, "simulation.config.json");
      await writeFile(
        personaPath,
        JSON.stringify({ persona, promptProfile }, null, 2),
      );
      await writeFile(
        configPath,
        JSON.stringify({
          simulation: {
            id: "persona_file_test",
            name: "Persona File Test",
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
            personaFile: "ana.persona.json",
            llm,
          }],
        }, null, 2),
      );

      const config = await loadSimulationConfig(configPath);

      expect(config.agents[0]?.persona).toEqual(persona);
      expect(config.agents[0]?.promptProfile.displayName).toBe("Ana");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("finds the default config path from a nested workspace directory", () => {
    const fixturesDir = new URL("./fixtures", import.meta.url).pathname;
    const path = findDefaultSimulationConfigPath(fixturesDir);
    expect(path.endsWith("config/index.json")).toBe(true);
  });
});
