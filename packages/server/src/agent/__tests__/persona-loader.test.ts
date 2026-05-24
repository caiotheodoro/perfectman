import { describe, it, expect } from "vitest";
import { PersonaLoader } from "../persona-loader.js";

describe("PersonaLoader", () => {
  it("always returns a generic profile with the given personaId", () => {
    const profile = PersonaLoader.getProfile("goulart");
    expect(profile).toBeDefined();
    expect(profile.personaId).toBe("goulart");
    expect(profile.displayName).toBe("Goulart");
    expect(profile.language).toBe("en");
    expect(profile.identityFrame).toContain("standard chat room participant");
  });

  it("capitalises the displayName from the personaId", () => {
    const profile = PersonaLoader.getProfile("BRUNO");
    expect(profile.displayName).toBe("BRUNO");
    expect(profile.personaId).toBe("BRUNO");
  });

  it("returns a generic profile for any unknown persona ID", () => {
    const profile = PersonaLoader.getProfile("unknown-persona");
    expect(profile).toBeDefined();
    expect(profile.personaId).toBe("unknown-persona");
    expect(profile.displayName).toBe("Unknown-persona");
    expect(profile.language).toBe("en");
    expect(profile.identityFrame).toContain("standard chat room participant");
  });

  it("should default LlmConfig to mock settings", () => {
    const config = PersonaLoader.getLlmConfig("bruno");
    expect(config).toBeDefined();
    expect(config.providerType).toBe("mock");
    expect(config.modelName).toBe("mock-model");
    expect(config.timeoutMs).toBe(5000);
  });

  it("should apply custom overrides to resolved LlmConfig", () => {
    const overrides = {
      providerType: "local_uncensored" as const,
      modelName: "qwen-3-special",
      temperature: 0.9,
    };
    const config = PersonaLoader.getLlmConfig("goulart", overrides);
    expect(config).toBeDefined();
    expect(config.providerType).toBe("local_uncensored");
    expect(config.modelName).toBe("qwen-3-special");
    expect(config.temperature).toBe(0.9);
    expect(config.timeoutMs).toBe(5000); // kept default from base mock
  });
});
