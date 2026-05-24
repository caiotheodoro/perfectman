import { describe, it, expect } from "vitest";
import { PersonaLoader } from "../persona-loader.js";

describe("PersonaLoader", () => {
  it("should successfully resolve Goulart profile by ID", () => {
    const profile = PersonaLoader.getProfile("goulart");
    expect(profile).toBeDefined();
    expect(profile.displayName).toBe("Goulart");
    expect(profile.identityFrame).toContain("Provocateur");
    expect(profile.language).toBe("pt-BR");
    expect(profile.voiceGuidelines.length).toBeGreaterThan(0);
  });

  it("should successfully resolve Bruno profile by ID (case-insensitive)", () => {
    const profile = PersonaLoader.getProfile("BRUNO");
    expect(profile).toBeDefined();
    expect(profile.displayName).toBe("Bruno");
    expect(profile.identityFrame).toContain("Observer");
    expect(profile.language).toBe("pt-BR");
  });

  it("should safely fall back to a generic profile for an unknown persona ID", () => {
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
