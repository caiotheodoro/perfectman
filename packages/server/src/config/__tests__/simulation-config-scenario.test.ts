import { describe, it, expect } from "vitest";
import { parseSimulationConfig } from "../simulation-config.js";
import { llm, persona, promptProfile } from "./fixtures.js";

const scenarioContext = {
  roomContext: "Você é Íris, sócia da Cerne.",
  startingMood: "Apressada.",
  introBehaviorInstruction: "Anuncie a proposta.",
  displayName: "Íris",
  castMap: { bruno: "bruno" },
};
const hiddenObjective = {
  description: "ser a diretora criativa única",
  scarceResourceId: "adamantis_deal_timeline",
  constraint: "admitir que quero o cargo",
};

function configWith(profileExtras: Record<string, unknown>): unknown {
  return {
    simulation: {
      id: "sim_scenario_test",
      name: "Scenario Test",
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
    agents: [{ id: "ana", persona, promptProfile: { ...promptProfile, ...profileExtras }, llm }],
  };
}

describe("simulation config — scenario context and hidden objective parity", () => {
  it("carries scenarioContext and hiddenObjective from a file config onto the prompt profile", () => {
    const config = parseSimulationConfig(configWith({ scenarioContext, hiddenObjective }));
    expect(config.agents[0]!.promptProfile.scenarioContext).toEqual(scenarioContext);
    expect(config.agents[0]!.promptProfile.hiddenObjective).toEqual(hiddenObjective);
  });

  it("leaves both undefined when absent, and rejects a hiddenObjective without a scarceResourceId", () => {
    const plain = parseSimulationConfig(configWith({}));
    expect(plain.agents[0]!.promptProfile.scenarioContext).toBeUndefined();
    expect(plain.agents[0]!.promptProfile.hiddenObjective).toBeUndefined();
    expect(() => parseSimulationConfig(configWith({ hiddenObjective: { description: "x" } }))).toThrow(/scarceResourceId/);
  });
});
