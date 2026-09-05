import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import {
  JudgeAppConfigSchema,
  JudgeEntryConfigSchema,
  JudgeProviderTypeSchema,
} from "../judge/judge-config.schema.js";
import type {
  JudgeAppConfig,
  JudgeConfigBase,
  JudgeEntryConfig,
  JudgeProviderType,
} from "../judge/judge-config.types.js";

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

  it("accepts a per-entry maxTokens and rejects a non-positive one", () => {
    const ok = JudgeAppConfigSchema.parse({
      providerType: "openai-compatible",
      modelName: "m",
      jury: [{ providerType: "openai-compatible", modelName: "glm", label: "glm", maxTokens: 4000 }],
    });
    expect(ok.jury![0]!.maxTokens).toBe(4000);
    expect(
      JudgeAppConfigSchema.safeParse({ providerType: "openai-compatible", modelName: "m", maxTokens: 0 }).success,
    ).toBe(false);
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

  it("mirrors the runtime label defaulting: a partially-labeled jury colliding with a judge-N default is rejected", () => {
    // Entry 0 unlabeled → runtime would call it judge-0; entry 1 labels
    // itself judge-0 — the runtime duplicate guard would throw mid-bench,
    // so the parse-time mirror must reject the file.
    const result = JudgeAppConfigSchema.safeParse({
      providerType: "openai-compatible",
      modelName: "deepseek-chat",
      jury: [
        { providerType: "openai-compatible", modelName: "a" },
        { providerType: "openai-compatible", modelName: "b", label: "judge-0" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(/Duplicate jury judge labels: judge-0/);
    }
  });

  it("does not reject a fully-unlabeled jury (judge-N defaults are position-unique)", () => {
    const result = JudgeAppConfigSchema.safeParse({
      providerType: "openai-compatible",
      modelName: "deepseek-chat",
      jury: [
        { providerType: "openai-compatible", modelName: "a" },
        { providerType: "openai-compatible", modelName: "b" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("mirrors the runtime endpoint guard: duplicate (baseUrl, modelName) jury entries are rejected", () => {
    const result = JudgeAppConfigSchema.safeParse({
      providerType: "openai-compatible",
      modelName: "deepseek-chat",
      jury: [
        { providerType: "openai-compatible", baseUrl: "http://localhost:11434/v1", modelName: "qwen3:8b", label: "one" },
        { providerType: "openai-compatible", baseUrl: "http://localhost:11434/v1", modelName: "qwen3:8b", label: "two" },
      ],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toMatch(
        /Duplicate jury judge endpoint \(http:\/\/localhost:11434\/v1, qwen3:8b\)/,
      );
    }
  });

  it("accepts same-endpoint-different-model and same-model-different-endpoint juries", () => {
    const result = JudgeAppConfigSchema.safeParse({
      providerType: "openai-compatible",
      modelName: "deepseek-chat",
      jury: [
        { providerType: "openai-compatible", baseUrl: "http://localhost:11434/v1", modelName: "qwen3:8b", label: "one" },
        { providerType: "openai-compatible", baseUrl: "http://localhost:11434/v1", modelName: "qwen3:1.7b", label: "two" },
        { providerType: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", modelName: "qwen3:8b", label: "three" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("leaves baseUrl-less entries to the runtime guard (env resolves them at load)", () => {
    const result = JudgeAppConfigSchema.safeParse({
      providerType: "openai-compatible",
      modelName: "deepseek-chat",
      jury: [
        { providerType: "openai-compatible", modelName: "qwen3:8b", label: "one" },
        { providerType: "openai-compatible", modelName: "qwen3:8b", label: "two" },
      ],
    });
    expect(result.success).toBe(true);
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

  it("derives the config types from the schemas (no hand-written drift)", () => {
    expectTypeOf<JudgeProviderType>().toEqualTypeOf<z.infer<typeof JudgeProviderTypeSchema>>();
    expectTypeOf<JudgeConfigBase>().toEqualTypeOf<z.infer<typeof JudgeConfigBaseSchema>>();
    expectTypeOf<JudgeEntryConfig>().toEqualTypeOf<z.infer<typeof JudgeEntryConfigSchema>>();
    expectTypeOf<JudgeAppConfig>().toEqualTypeOf<z.infer<typeof JudgeAppConfigSchema>>();
    // Required-vs-optional surface, pinned explicitly.
    expectTypeOf<JudgeProviderType>().toEqualTypeOf<"openai-compatible" | "rule" | "mock">();
    expectTypeOf<JudgeConfigBase["modelName"]>().toEqualTypeOf<string>();
    expectTypeOf<JudgeConfigBase["baseUrl"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<JudgeEntryConfig["label"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<JudgeAppConfig["jury"]>().toEqualTypeOf<JudgeEntryConfig[] | undefined>();
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
