import { describe, it, expect } from "vitest";
import { PersonaLoader } from "../persona-loader.js";
import { BRUNO_PROMPT_PROFILE, GOULART_PROMPT_PROFILE } from "../persona-prompt-profile.js";

describe("PersonaLoader", () => {
  it("resolves the Goulart prompt profile from the registry", () => {
    const profile = PersonaLoader.getProfile("goulart");

    expect(profile).toBe(GOULART_PROMPT_PROFILE);
    expect(profile.personaId).toBe("goulart");
    expect(profile.displayName).toBe("Goulart");
    expect(profile.language).toBe("pt-BR");
    expect(profile.identityFrame).not.toContain("standard chat room participant");
  });

  it("resolves the Bruno prompt profile from the registry case-insensitively", () => {
    const profile = PersonaLoader.getProfile("BRUNO");

    expect(profile).toBe(BRUNO_PROMPT_PROFILE);
    expect(profile.personaId).toBe("bruno");
    expect(profile.displayName).toBe("Bruno");
    expect(profile.language).toBe("pt-BR");
  });

  it("returns a generic fallback profile for any unknown persona ID", () => {
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
