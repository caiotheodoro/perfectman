import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSimulationConfig } from "../../config/simulation-config.js";
import type { LLMConfig } from "../../llm/llm-config.js";
import { assembleSimulationConfig } from "../assemble-config.js";
import { compilePersonaMarkdown, type CompiledPersona } from "../persona-md-compiler.js";
import { compileScenarioMarkdown } from "../scenario-md-compiler.js";

const dir = join(__dirname, "fixtures");
const PERSONA_MD = readFileSync(join(dir, "iris.persona.md"), "utf8");
const SCENARIO_MD = readFileSync(join(dir, "dinner.scenario.md"), "utf8");

const MOCK_LLM: LLMConfig = {
  providerType: "mock",
  modelName: "mock",
  maxInputTokens: 2048,
  maxOutputTokens: 512,
  temperature: 0.7,
  timeoutMs: 5000,
  retryCount: 1,
};

/** The fixture's cast names three personas; give them all the same pack. */
function personaMap(): Map<string, CompiledPersona> {
  const iris = compilePersonaMarkdown(PERSONA_MD, "iris.persona.md");
  const generic = compilePersonaMarkdown(
    PERSONA_MD.replace("personaId: iris", "personaId: bruno").replace("displayName: Íris", "displayName: Bruno"),
    "bruno.persona.md",
  );
  return new Map([
    ["iris.persona.md", iris],
    ["bruno", generic],
  ]);
}

function assemble() {
  const { scenario } = compileScenarioMarkdown(SCENARIO_MD, "dinner.scenario.md");
  if (!scenario) throw new Error("fixture scenario failed to compile");
  return assembleSimulationConfig({
    scenario,
    personas: personaMap(),
    llm: MOCK_LLM,
    simulationId: "run_test_1",
  });
}

describe("assembleSimulationConfig", () => {
  const { config, seeds, diagnostics } = assemble();

  it("produces a config the real validator accepts — the assertion that matters", () => {
    expect(diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(config).not.toBeNull();
    expect(() => parseSimulationConfig(config, { allowNoGateways: true })).not.toThrow();
  });

  it("survives the validator without being changed by it", () => {
    const parsed = parseSimulationConfig(config, { allowNoGateways: true });
    expect(parsed.agents.map((a) => a.id)).toEqual(["iris", "bruno", "marcela"]);
    expect(parsed.channels.map((c) => c.id)).toEqual(["geral", "iris_marcela"]);
  });

  it("uses the caller's simulation id, never the config's pinned local-dev", () => {
    expect(config?.simulation.id).toBe("run_test_1");
  });

  it("runs in memory with no delivery gateways — the web run injects its own", () => {
    expect(config?.persistence).toEqual({ type: "memory" });
    expect(config?.deliveryGateways).toEqual([]);
  });

  it("turns operator events on, since thinking and emotion ride on them", () => {
    expect(config?.debug).toMatchObject({ operatorEvents: true, pulseMetrics: true });
  });

  it("fills all seven required settings, honouring authored overrides", () => {
    expect(config?.simulation.settings).toMatchObject({
      pulseIntervalMs: 3000,
      omniscientSpectatorMode: false,
      allowPrivateChannels: true,
      maxPrivateChannelsPerAgent: 3,
      maxMessagesPerMinutePerAgent: 30,
      llmCallBudgetPerMinute: 200,
      tokenBudgetPerHour: 1_000_000,
    });
  });

  it("expands the familiarity matrix into complete relational states", () => {
    const iris = config?.agents.find((a) => a.id === "iris");
    // close_friends with marcela, acquaintances with bruno.
    expect(iris?.relationalStates?.["marcela"]).toMatchObject({ trust: 0.85, comfort: 0.9 });
    expect(iris?.relationalStates?.["bruno"]).toMatchObject({ trust: 0.35 });
    expect(Object.keys(iris?.relationalStates ?? {})).toEqual(["bruno", "marcela"]);
  });

  it("completes a partial authored mood instead of resetting the rest to zero", () => {
    const iris = config?.agents.find((a) => a.id === "iris");
    expect(iris?.initialCoreMood).toMatchObject({ valence: -0.2, arousal: 0.6 });
    expect(iris?.initialCoreMood?.stability).toBeGreaterThan(0);
    expect(iris?.initialCoreMood?.energy).toBeGreaterThan(0);
  });

  it("completes partial social emotions from rest", () => {
    const iris = config?.agents.find((a) => a.id === "iris");
    expect(iris?.initialSocialEmotions).toMatchObject({ desireForStatus: 0.7, jealousy: 0, shame: 0 });
  });

  it("threads the scene's prose into every agent's scenario context", () => {
    for (const agent of config?.agents ?? []) {
      expect(agent.promptProfile.scenarioContext?.startingMood).toBe("tenso, educado demais");
    }
  });

  it("lets a per-agent room context override the scene-wide one", () => {
    const bruno = config?.agents.find((a) => a.id === "bruno");
    const iris = config?.agents.find((a) => a.id === "iris");
    expect(bruno?.promptProfile.scenarioContext?.roomContext).toContain("achando que era só um papo");
    expect(iris?.promptProfile.scenarioContext?.roomContext).toContain("Três sócios");
  });

  it("attaches the host message only to the agent it was written under", () => {
    const iris = config?.agents.find((a) => a.id === "iris");
    const bruno = config?.agents.find((a) => a.id === "bruno");
    expect(iris?.promptProfile.scenarioContext?.hostStartingMessage).toContain("sábado");
    expect(bruno?.promptProfile.scenarioContext?.hostStartingMessage).toBeUndefined();
  });

  it("carries hidden objectives, keeping the shared resource that creates the conflict", () => {
    const iris = config?.agents.find((a) => a.id === "iris");
    const bruno = config?.agents.find((a) => a.id === "bruno");
    expect(iris?.promptProfile.hiddenObjective?.scarceResourceId).toBe("o_convite");
    expect(bruno?.promptProfile.hiddenObjective?.scarceResourceId).toBe("o_convite");
  });

  it("returns seed memories separately, since config drops initialMemories", () => {
    expect(config?.agents.every((a) => a.initialMemories === undefined)).toBe(true);
    expect(seeds.memoriesByAgent["bruno"]?.some((m) => m.summary.includes("investidor"))).toBe(true);
  });

  it("merges the persona's own memories with the scene's", () => {
    // iris has one from the pack and none from the scene; bruno has both.
    expect(seeds.memoriesByAgent["iris"]).toHaveLength(1);
    expect(seeds.memoriesByAgent["bruno"]?.length).toBeGreaterThan(1);
  });

  it("returns prior events separately too", () => {
    expect(seeds.priorEvents).toHaveLength(1);
    expect(seeds.priorEvents[0]).toMatchObject({ actorId: "bruno", channelId: "geral" });
  });

  it("reports which calibration source each persona actually got", () => {
    const info = diagnostics.filter((d) => d.level === "info").map((d) => d.message).join(" ");
    expect(info).toContain("calibration");
  });
});

describe("assembleSimulationConfig — failure modes", () => {
  it("errors when the cast names a persona that was not supplied", () => {
    const { scenario } = compileScenarioMarkdown(SCENARIO_MD, "s.md");
    const result = assembleSimulationConfig({
      scenario: scenario!,
      personas: new Map(),
      llm: MOCK_LLM,
      simulationId: "r1",
    });
    expect(result.config).toBeNull();
    const error = result.diagnostics.find((d) => d.level === "error");
    expect(error?.message).toContain("which was not supplied");
    expect(error?.hint).toContain("Upload a persona file");
  });

  it("warns on an unknown setting rather than passing it to the validator", () => {
    const { scenario } = compileScenarioMarkdown(SCENARIO_MD, "s.md");
    const result = assembleSimulationConfig({
      scenario: { ...scenario!, settings: { nonsense: 1 } },
      personas: personaMap(),
      llm: MOCK_LLM,
      simulationId: "r1",
    });
    expect(result.diagnostics.some((d) => d.message.includes("Unknown setting"))).toBe(true);
    expect(() => parseSimulationConfig(result.config, { allowNoGateways: true })).not.toThrow();
  });

  it("rejects a pulse interval outside the schema's bounds before the validator sees it", () => {
    const { scenario } = compileScenarioMarkdown(SCENARIO_MD, "s.md");
    const result = assembleSimulationConfig({
      scenario: { ...scenario!, settings: { pulseIntervalMs: 50 } },
      personas: personaMap(),
      llm: MOCK_LLM,
      simulationId: "r1",
    });
    expect(result.config?.simulation.settings.pulseIntervalMs).toBe(3000);
    expect(() => parseSimulationConfig(result.config, { allowNoGateways: true })).not.toThrow();
  });
});
