import { describe, it, expect, afterEach, vi } from "vitest";
import { benchSeed, localLlmConfig } from "../run/scenario-runner.js";

describe("bench seed wiring (#45)", () => {
  afterEach(() => {
    delete process.env.PERFECTMAN_LLM_SEED;
    delete process.env.PERFECTMAN_LLM_PROVIDER;
    vi.restoreAllMocks();
  });

  it("defaults to a fixed seed of 42", () => {
    expect(benchSeed()).toBe(42);
  });

  it("honors the PERFECTMAN_LLM_SEED override", () => {
    process.env.PERFECTMAN_LLM_SEED = "1234";
    expect(benchSeed()).toBe(1234);
  });

  it("falls back to 42 on a non-numeric override", () => {
    process.env.PERFECTMAN_LLM_SEED = "not-a-number";
    expect(benchSeed()).toBe(42);
  });

  it("falls back to 42 on a blank override", () => {
    process.env.PERFECTMAN_LLM_SEED = "   ";
    expect(benchSeed()).toBe(42);
  });

  it("respects an explicit zero seed", () => {
    process.env.PERFECTMAN_LLM_SEED = "0";
    expect(benchSeed()).toBe(0);
  });

  it("pins seed into the ollama-path extraBody", () => {
    const config = localLlmConfig(undefined);
    expect(config.providerType).toBe("ollama");
    expect(config.extraBody?.["seed"]).toBe(benchSeed());
  });

  it("pins seed into the deepseek-path extraBody", () => {
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    const config = localLlmConfig(undefined);
    expect(config.providerType).toBe("qwen3_8b");
    expect(config.extraBody?.["seed"]).toBe(benchSeed());
  });
});
