import { describe, it, expect } from "vitest";
import { PersonaLoader, personaPackToProfile } from "../persona-loader.js";
import { getPersonaPackById } from "@perfectman/shared";
import { GENERIC_PROMPT_PROFILE } from "../persona-prompt-profile.js";

describe("PersonaLoader", () => {
  it("resolves the authored persona pack for a canonical persona", () => {
    const profile = PersonaLoader.getProfile("goulart");
    expect(profile).toBeDefined();
    expect(profile.personaId).toBe("goulart");
    expect(profile.displayName).toBe("Goulart");
    expect(profile.language).toBe("pt-BR");
    expect(profile.identityFrame.length).toBeGreaterThan(40);
    expect(profile.voiceGuidelines.length).toBeGreaterThanOrEqual(3);
    expect(profile.styleExamples.default.length).toBeGreaterThanOrEqual(5);
    expect(Object.keys(profile.relationshipBiases).length).toBeGreaterThanOrEqual(1);
  });

  it("capitalises the displayName from the personaId", () => {
    const profile = PersonaLoader.getProfile("BRUNO");
    expect(profile.displayName).toBe("BRUNO");
    expect(profile.personaId).toBe("BRUNO");
  });

  it("returns a generic fallback profile for any persona ID not supplied by local config", () => {
    const profile = PersonaLoader.getProfile("unknown-persona");

    expect(profile).toBeDefined();
    expect(profile).not.toBe(GENERIC_PROMPT_PROFILE);
    expect(profile.personaId).toBe("unknown-persona");
    expect(profile.displayName).toBe("Unknown-persona");
    expect(profile.language).toBe("en");
    expect(profile.identityFrame).toContain("standard chat room participant");
  });

  it("does not ship versioned real-person profiles by persona ID", () => {
    const profile = PersonaLoader.getProfile("real-person-id");

    expect(profile.personaId).toBe("real-person-id");
    expect(profile.displayName).toBe("Real-person-id");
    expect(profile.identityFrame).toContain("standard chat room participant");
  });

  it("should default LLMConfig to mock settings", () => {
    const config = PersonaLoader.getLLMConfig("example-friend");
    expect(config).toBeDefined();
    expect(config.providerType).toBe("mock");
    expect(config.modelName).toBe("mock-model");
    expect(config.timeoutMs).toBe(5000);
  });

  it("should apply persona-tuned sampling for canonical personas", () => {
    const config = PersonaLoader.getLLMConfig("bruno");
    expect(config.temperature).toBe(0.7);
    expect(config.extraBody).toMatchObject({ top_p: 0.9 });
  });

  it("should apply custom overrides to resolved LLMConfig", () => {
    const overrides = {
      providerType: "openai-compatible" as const,
      modelName: "qwen-3-special",
      temperature: 0.9,
    };
    const config = PersonaLoader.getLLMConfig("example-friend", overrides);
    expect(config).toBeDefined();
    expect(config.providerType).toBe("openai-compatible");
    expect(config.modelName).toBe("qwen-3-special");
    expect(config.temperature).toBe(0.9);
    expect(config.timeoutMs).toBe(5000); // kept default from base mock
  });
});

describe("personaPackToProfile — scenario re-skin", () => {
  const pack = getPersonaPackById("goulart");
  if (!pack) throw new Error("goulart pack missing");
  const cast = ["iris", "bruno", "marcela", "theo"];
  const scenarioContext = {
    roomContext: "Você é Íris.",
    startingMood: "Apressada.",
    introBehaviorInstruction: "Anuncie a proposta.",
    displayName: "Íris",
    castMap: { bruno: "bruno", mariana: "marcela", caio: "theo" },
  };
  const castDisplayNames = { iris: "Íris", bruno: "Bruno", marcela: "Marcela", theo: "Théo" };

  it("lets the scenario's displayName win over the pack's and says so in the identity frame", () => {
    const profile = personaPackToProfile(pack, { scenarioContext, castAgentIds: cast, castDisplayNames });
    expect(profile.displayName).toBe("Íris");
    expect(profile.identityFrame.startsWith("In this scene you are Íris")).toBe(true);
    expect(profile.identityFrame).toContain(pack.identityFrame);
    // Without a re-skin nothing changes.
    expect(personaPackToProfile(pack).displayName).toBe("Goulart");
  });

  it("remaps relationship biases through castMap and drops peers outside the cast", () => {
    const profile = personaPackToProfile(pack, { scenarioContext, castAgentIds: cast, castDisplayNames });
    expect(Object.keys(profile.relationshipBiases).sort()).toEqual(["bruno", "marcela", "theo"]);
    expect(profile.relationshipBiases["marcela"]?.view).toBe(pack.relationshipBiases["mariana"]);
    expect(Object.keys(personaPackToProfile(pack).relationshipBiases)).toContain("leo");
  });

  it("drops pack-derived unresolved memory lines when the scenario seeds its own memories", () => {
    const seeded = personaPackToProfile(pack, { scenarioContext, castAgentIds: cast, castDisplayNames, replacesMemories: true });
    expect(seeded.emotionalPatterns).toEqual([]);
    const unseeded = personaPackToProfile(pack, { scenarioContext, castAgentIds: cast, castDisplayNames });
    expect(unseeded.emotionalPatterns.length).toBeGreaterThan(0);
  });
});
