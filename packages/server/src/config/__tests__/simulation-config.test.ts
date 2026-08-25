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
import { MockDeliveryGateway } from "../../delivery/index.js";

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

  it("parses a valid full goalLayer section", () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      goalLayer: {
        enabled: true,
        reviewEveryPulses: 5,
        delusionWeightsByAgent: {
          ana: { wSignal: 0.5, wSocial: 0.3, wIdentity: 0.2, revisionThreshold: 0.6 },
        },
        ending: { offerAcceptPulses: 2 },
        synthesizer: { mode: "deterministic", intervalPulses: 5, maxCandidatesPerReview: 2 },
        acceptance: { mode: "auto" },
      },
    });
    expect(parsed.goalLayer?.enabled).toBe(true);
    expect(parsed.goalLayer?.reviewEveryPulses).toBe(5);
    expect(parsed.goalLayer?.delusionWeightsByAgent?.["ana"]?.revisionThreshold).toBe(0.6);
    expect(parsed.goalLayer?.ending?.offerAcceptPulses).toBe(2);
    expect(parsed.goalLayer?.synthesizer).toEqual({
      mode: "deterministic",
      intervalPulses: 5,
      maxCandidatesPerReview: 2,
    });
    expect(parsed.goalLayer?.acceptance?.mode).toBe("auto");
  });

  it("allows delusionWeightsByAgent keys for unknown agents (defaults apply at resolve time)", () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      goalLayer: {
        enabled: true,
        delusionWeightsByAgent: {
          ghost: {
            wSignal: 0.4,
            wSocial: 0.4,
            wIdentity: 0.2,
            revisionThreshold: 0.5,
          },
        },
      },
    });
    expect(parsed.goalLayer?.enabled).toBe(true);
    expect(parsed.goalLayer?.delusionWeightsByAgent?.["ghost"]?.wSignal).toBe(0.4);
  });

  it("rejects invalid goalLayer values with the goalLayer error path", () => {
    const config = baseConfig();
    const invalidSections = [
      { reviewEveryPulses: -1 },
      {
        delusionWeightsByAgent: {
          ana: { wSignal: 1.5, wSocial: 0.3, wIdentity: 0.2, revisionThreshold: 0.6 },
        },
      },
      { synthesizer: { mode: "deterministic", intervalPulses: 0, maxCandidatesPerReview: 2 } },
      { synthesizer: { mode: "deterministic", intervalPulses: 5, maxCandidatesPerReview: 0 } },
    ];
    for (const goalLayer of invalidSections) {
      expect(() => parseSimulationConfig({ ...config, goalLayer })).toThrow(/goalLayer: /);
    }
  });

  it("parses a config without the goalLayer section to goalLayer: undefined and still builds", async () => {
    const config = baseConfig();
    expect(config.goalLayer).toBeUndefined();
    const handle = await buildConfiguredSimulation(config);
    try {
      await handle.runtime.start(handle.simulationId);
      await handle.runtime.stop(handle.simulationId);
    } finally {
      await handle.close();
    }
  });

  it("parses llm/agent synthesizer and acceptance modes as contract-defined (build rejects them later)", () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      goalLayer: {
        enabled: true,
        synthesizer: { mode: "llm", intervalPulses: 10, maxCandidatesPerReview: 3 },
        acceptance: { mode: "agent" },
      },
    });
    expect(parsed.goalLayer?.synthesizer?.mode).toBe("llm");
    expect(parsed.goalLayer?.acceptance?.mode).toBe("agent");
  });

  it("build rejects unwired synthesizer.mode llm with the D-13 deferral message", async () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      goalLayer: {
        enabled: true,
        synthesizer: { mode: "llm", intervalPulses: 10, maxCandidatesPerReview: 3 },
      },
    });
    await expect(buildConfiguredSimulation(parsed)).rejects.toThrow(
      /synthesizer\.mode "llm" is not wired in this slice; lands with the LLM synthesizer slice/,
    );
  });

  it("build rejects unwired acceptance.mode agent with the D-13 deferral message", async () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      goalLayer: { enabled: true, acceptance: { mode: "agent" } },
    });
    await expect(buildConfiguredSimulation(parsed)).rejects.toThrow(
      /acceptance\.mode "agent" is not wired in this slice; lands with the LLM synthesizer slice/,
    );
  });

  it("builds unchanged when goalLayer is disabled even with unwired modes", async () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      goalLayer: {
        enabled: false,
        synthesizer: { mode: "llm", intervalPulses: 10, maxCandidatesPerReview: 3 },
      },
    });
    const handle = await buildConfiguredSimulation(parsed);
    try {
      await handle.runtime.start(handle.simulationId);
      await handle.runtime.stop(handle.simulationId);
    } finally {
      await handle.close();
    }
  });

  it("accepts the generic openai-compatible provider type", () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      agents: [{
        ...config.agents[0],
        llm: {
          ...llm,
          providerType: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          modelName: "qwen3:1.7b",
          extraBody: { stream: false },
        },
      }],
    });

    expect(parsed.agents[0]?.llm.providerType).toBe("openai-compatible");
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
          providerType: "openai-compatible",
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

  it("injects runtime metadata into mock gateway construction (US-003 ACC-1)", async () => {
    const handle = await buildConfiguredSimulation(baseConfig());
    try {
      const meta = (handle.gateways["mock"] as MockDeliveryGateway).runtimeMetadata;
      expect(meta).toEqual({
        simulationId: "sim_config_test",
        simulationName: "Config Test",
        agents: { ana: { name: "Ana", archetype: "observer" } },
        channels: { general: { name: "general" } },
      });
    } finally {
      await handle.close();
    }
  });

  it("maps a 4-persona scenario's names and archetypes into metadata (US-003 ACC-2)", async () => {
    const config = baseConfig();
    const fourPersona = parseSimulationConfig({
      ...config,
      agents: [
        config.agents[0],
        { id: "bruno", persona: { ...persona, id: "bruno", name: "Bruno" }, promptProfile: { ...promptProfile, personaId: "bruno", displayName: "Bruno" }, llm },
        { id: "carla", persona: { ...persona, id: "carla", name: "Carla", archetype: "provocateur" }, promptProfile: { ...promptProfile, personaId: "carla", displayName: "Carla" }, llm },
        { id: "diego", persona: { ...persona, id: "diego", name: "Diego", archetype: "strategist" }, promptProfile: { ...promptProfile, personaId: "diego", displayName: "Diego" }, llm },
      ],
    });
    const handle = await buildConfiguredSimulation(fourPersona);
    try {
      const meta = (handle.gateways["mock"] as MockDeliveryGateway).runtimeMetadata;
      expect(meta?.agents).toEqual({
        ana: { name: "Ana", archetype: "observer" },
        bruno: { name: "Bruno", archetype: "observer" },
        carla: { name: "Carla", archetype: "provocateur" },
        diego: { name: "Diego", archetype: "strategist" },
      });
      expect(meta?.channels).toEqual({ general: { name: "general" } });
      expect(meta?.simulationId).toBe("sim_config_test");
    } finally {
      await handle.close();
    }
  });

  it("parses an html-snapshot gateway with a required outputPath (US-004 ACC-1)", () => {
    const config = baseConfig();
    const parsed = parseSimulationConfig({
      ...config,
      deliveryGateways: [
        { id: "mock", type: "mock" },
        { id: "html", type: "html-snapshot", outputPath: "tmp/out.html" },
      ],
    });
    expect(parsed.deliveryGateways).toContainEqual({
      id: "html",
      type: "html-snapshot",
      outputPath: "tmp/out.html",
    });
  });

  it("rejects an html-snapshot gateway without an outputPath", () => {
    const config = baseConfig();
    expect(() => parseSimulationConfig({
      ...config,
      deliveryGateways: [{ id: "html", type: "html-snapshot" }],
    })).toThrow("deliveryGateways[0].outputPath must be a non-empty string");
  });

  it("still rejects unknown gateway types", () => {
    const config = baseConfig();
    expect(() => parseSimulationConfig({
      ...config,
      deliveryGateways: [{ id: "x", type: "smoke-signals" }],
    })).toThrow("Unsupported deliveryGateways[0].type: smoke-signals");
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
