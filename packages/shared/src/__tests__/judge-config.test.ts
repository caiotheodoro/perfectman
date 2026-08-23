import { describe, expect, it } from "vitest";
import {
  JudgeAppConfigSchema,
  JudgeEntryConfigSchema,
  JudgeProviderTypeSchema,
} from "../judge/judge-config.schema.js";
import type { JudgeAppConfig } from "../judge/judge-config.types.js";

describe("JudgeProviderTypeSchema", () => {
  it("accepts exactly the three provider types", () => {
    expect(JudgeProviderTypeSchema.parse("openai-compatible")).toBe("openai-compatible");
    expect(JudgeProviderTypeSchema.parse("rule")).toBe("rule");
    expect(JudgeProviderTypeSchema.parse("mock")).toBe("mock");
    expect(JudgeProviderTypeSchema.safeParse("deepseek").success).toBe(false);
    expect(JudgeProviderTypeSchema.safeParse("ollama").success).toBe(false);
  });
});

describe("JudgeAppConfigSchema", () => {
  it("parses a full judge section with a cross-family jury", () => {
    const config = JudgeAppConfigSchema.parse({
      providerType: "openai-compatible",
      baseUrl: "https://api.deepseek.com/v1",
      modelName: "deepseek-chat",
      apiKeyEnv: "DEEPSEEK_API_KEY",
      temperature: 0,
      timeoutMs: 90000,
      retryCount: 1,
      responseFormatJson: true,
      jury: [
        {
          providerType: "openai-compatible",
          baseUrl: "http://localhost:11434/v1",
          modelName: "qwen3:8b",
          temperature: 0,
          label: "local-qwen",
        },
        {
          providerType: "openai-compatible",
          baseUrl: "https://api.deepseek.com/v1",
          modelName: "deepseek-chat",
          apiKeyEnv: "DEEPSEEK_API_KEY",
          temperature: 0,
          label: "deepseek",
        },
      ],
    });

    expect(config.providerType).toBe("openai-compatible");
    expect(config.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
    expect(config.jury).toHaveLength(2);
    expect(config.jury![1]!.apiKeyEnv).toBe("DEEPSEEK_API_KEY");
  });

  it("accepts a minimal judge section (only providerType + modelName)", () => {
    const config = JudgeAppConfigSchema.parse({ providerType: "rule", modelName: "rule" });
    expect(config.baseUrl).toBeUndefined();
    expect(config.jury).toBeUndefined();
  });

  it("accepts a jury entry without a label (runtime defaults judge-N)", () => {
    const config = JudgeAppConfigSchema.parse({
      providerType: "openai-compatible",
      modelName: "qwen3:8b",
      jury: [{ providerType: "openai-compatible", modelName: "qwen3:8b" }],
    });
    expect(config.jury![0]!.label).toBeUndefined();
  });

  it("rejects an unsupported providerType (deepseek is an endpoint, not a type)", () => {
    const result = JudgeAppConfigSchema.safeParse({ providerType: "deepseek", modelName: "x" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing modelName", () => {
    const result = JudgeAppConfigSchema.safeParse({ providerType: "openai-compatible" });
    expect(result.success).toBe(false);
  });

  it("rejects raw secrets in the section (must use apiKeyEnv by name)", () => {
    const result = JudgeAppConfigSchema.safeParse({
      providerType: "openai-compatible",
      modelName: "deepseek-chat",
      apiKey: "sk-secret",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/secrets through env field names only/);
    }
  });

  it("rejects raw secrets inside jury entries too", () => {
    const result = JudgeAppConfigSchema.safeParse({
      providerType: "openai-compatible",
      modelName: "deepseek-chat",
      jury: [{ providerType: "openai-compatible", modelName: "qwen3:8b", token: "sk" }],
    });
    expect(result.success).toBe(false);
  });

  it("mirrors the runtime guard: duplicate jury labels throw", () => {
    const result = JudgeAppConfigSchema.safeParse({
      providerType: "openai-compatible",
      modelName: "deepseek-chat",
      jury: [
        { providerType: "openai-compatible", modelName: "a", label: "same" },
        { providerType: "openai-compatible", modelName: "b", label: "same" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/Duplicate jury judge labels: same/);
    }
  });

  it("accepts unique jury labels", () => {
    const result = JudgeAppConfigSchema.safeParse({
      providerType: "openai-compatible",
      modelName: "deepseek-chat",
      jury: [
        { providerType: "openai-compatible", modelName: "a", label: "one" },
        { providerType: "openai-compatible", modelName: "b", label: "two" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed field types", () => {
    expect(JudgeAppConfigSchema.safeParse({ providerType: "rule", modelName: "", }).success).toBe(false);
    expect(JudgeAppConfigSchema.safeParse({ providerType: "rule", modelName: "x", temperature: "0" }).success).toBe(false);
    expect(JudgeAppConfigSchema.safeParse({ providerType: "rule", modelName: "x", timeoutMs: 1.5 }).success).toBe(false);
    expect(JudgeAppConfigSchema.safeParse({ providerType: "rule", modelName: "x", retryCount: -1 }).success).toBe(false);
    expect(JudgeAppConfigSchema.safeParse({ providerType: "rule", modelName: "x", responseFormatJson: "yes" }).success).toBe(false);
  });

  it("types JudgeAppConfig through the shared export", () => {
    const config: JudgeAppConfig = {
      providerType: "mock",
      modelName: "mock",
    };
    expect(config.providerType).toBe("mock");
    expect(JudgeEntryConfigSchema.parse({ providerType: "mock", modelName: "mock", label: "l" }).label).toBe("l");
  });
});