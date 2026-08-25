import { describe, expect, it } from "vitest";
import { createLLMProvider, resolveEndpointShape } from "../provider-factory.js";
import { MockLLMProvider } from "../mock-llm-provider.js";
import { OllamaProvider } from "../ollama-provider.js";
import { OpenAiCompatibleProvider } from "../openai-compatible-provider.js";
import type { LLMConfig } from "../llm-config.js";

function baseConfig(providerType: LLMConfig["providerType"]): LLMConfig {
  return {
    providerType,
    baseUrl: "http://localhost:11434/v1",
    modelName: "test-model",
    maxInputTokens: 1000,
    maxOutputTokens: 200,
    temperature: 0.7,
    timeoutMs: 5000,
    retryCount: 0,
  };
}

describe("createLLMProvider (single dispatch site)", () => {
  it("maps mock to MockLLMProvider", () => {
    expect(createLLMProvider(baseConfig("mock"))).toBeInstanceOf(MockLLMProvider);
  });

  it("maps ollama to OllamaProvider", () => {
    expect(createLLMProvider(baseConfig("ollama"))).toBeInstanceOf(OllamaProvider);
  });

  it("maps openai-compatible to OpenAiCompatibleProvider", () => {
    expect(createLLMProvider(baseConfig("openai-compatible"))).toBeInstanceOf(
      OpenAiCompatibleProvider,
    );
  });

  it("ignores the agentId argument (mock provider is the shared seam)", () => {
    expect(createLLMProvider(baseConfig("mock"), "any-agent")).toBeInstanceOf(MockLLMProvider);
  });
});

describe("resolveEndpointShape", () => {
  it("returns the native ollama shape only for the ollama provider type", () => {
    expect(resolveEndpointShape(baseConfig("ollama"))).toBe("ollama");
    expect(resolveEndpointShape(baseConfig("openai-compatible"))).toBe("openai-compatible");
    expect(resolveEndpointShape(baseConfig("mock"))).toBe("openai-compatible");
  });
});