import { describe, it, expect } from "vitest";
import { PersonaLoader } from "../persona-loader.js";
import { GENERIC_PROMPT_PROFILE } from "../persona-prompt-profile.js";

describe("PersonaLoader", () => {
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

  it("should default LlmConfig to mock settings", () => {
    const config = PersonaLoader.getLlmConfig("example-friend");
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
    const config = PersonaLoader.getLlmConfig("example-friend", overrides);
    expect(config).toBeDefined();
    expect(config.providerType).toBe("local_uncensored");
    expect(config.modelName).toBe("qwen-3-special");
    expect(config.temperature).toBe(0.9);
    expect(config.timeoutMs).toBe(5000); // kept default from base mock
  });
});
