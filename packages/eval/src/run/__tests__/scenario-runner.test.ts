import { describe, it, expect } from "vitest";
import { getScenario } from "@perfectman/shared";
import { scenarioToConfig } from "../scenario-runner.js";

describe("scenarioToConfig — hidden objective threading", () => {
  it("carries an agent's seeded hiddenObjective onto its promptProfile", () => {
    const base = getScenario("motive_gossip");
    if (!base) throw new Error("motive_gossip missing from the scenario registry");

    const objective = { description: "quero ser escolhido líder do grupo", scarceResourceId: "group_leadership" };
    const scenario = {
      ...base,
      agents: base.agents.map((a, i) => (i === 0 ? { ...a, hiddenObjective: objective } : a)),
    };

    const config = scenarioToConfig(scenario, "mock");

    expect(config.agents[0]!.promptProfile.hiddenObjective).toEqual(objective);
    expect(config.agents[1]!.promptProfile.hiddenObjective).toBeUndefined();
  });

  it("carries an agent's seeded scenarioContext onto its promptProfile", () => {
    const base = getScenario("motive_gossip");
    if (!base) throw new Error("motive_gossip missing from the scenario registry");

    const scenarioContext = {
      roomContext: "Você é um sócio de uma empresa em processo de venda.",
      startingMood: "Alerta.",
      introBehaviorInstruction: "Questione o prazo apertado.",
    };
    const scenario = {
      ...base,
      agents: base.agents.map((a, i) => (i === 0 ? { ...a, scenarioContext } : a)),
    };

    const config = scenarioToConfig(scenario, "mock");

    expect(config.agents[0]!.promptProfile.scenarioContext).toEqual(scenarioContext);
    expect(config.agents[1]!.promptProfile.scenarioContext).toBeUndefined();
  });
});
