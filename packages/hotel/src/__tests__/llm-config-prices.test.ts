import { describe, expect, it } from "vitest";
import { parseConfig } from "../config.js";
import { linkPromptStyle, parseChain } from "../llm/chain-config.js";
import type { LlmLink } from "../llm/chain-config.js";
import { hostLlmConfig } from "../llm/env.js";

const MYTHO: LlmLink = { name: "mythomax", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "gryphe/mythomax-l2-13b", maxContextTokens: 4096 };
const LUNARIS: LlmLink = { name: "lunaris", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "sao10k/l3-lunaris-8b", maxContextTokens: 8192 };
const GO: LlmLink = { name: "opencode", baseUrl: "https://opencode.ai/zen/go/v1", apiKeyEnv: "OC_KEY", model: "glm-5.3-flash", sessionHeader: "x-opencode-session" };
const PRICES = { "gryphe/mythomax-l2-13b": { inUsdPerMTok: 0.08, outUsdPerMTok: 0.11 }, "sao10k/l3-lunaris-8b": { inUsdPerMTok: 0.04, outUsdPerMTok: 0.05 }, "glm-5.3-flash": { inUsdPerMTok: 0, outUsdPerMTok: 0 } };
const BASE = hostLlmConfig({ provider: "openai-compatible", baseUrl: MYTHO.baseUrl, apiKeyEnv: "OR_KEY", models: [MYTHO.model], chain: [MYTHO, LUNARIS, GO], prices: PRICES, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 });
const good = JSON.stringify([MYTHO, LUNARIS, GO]);

describe("prompt style, prices and the disabled sidecar", () => {
  it("picks the compact hotel prompt for a window of 4K or less, unless the link says otherwise", () => {
    expect(linkPromptStyle(MYTHO)).toBe("compact");
    expect(linkPromptStyle(LUNARIS)).toBe("full");
    expect(linkPromptStyle(GO)).toBe("full");
    expect(linkPromptStyle({ ...LUNARIS, promptStyle: "compact" })).toBe("compact");
    expect(linkPromptStyle({ ...MYTHO, promptStyle: "full" })).toBe("full");
    // The runtime writes the first link's style, and says compact to the transport config.
    expect(BASE.promptStyle).toBe("compact");
    expect(hostLlmConfig({ provider: "openai-compatible", baseUrl: LUNARIS.baseUrl, apiKeyEnv: "OR_KEY", models: [LUNARIS.model], chain: [LUNARIS, GO], prices: PRICES, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 }).promptStyle).toBe("full");
    const problems: string[] = [];
    expect(parseChain(JSON.stringify([{ ...LUNARIS, promptStyle: "tiny" }]), problems)).toEqual([]);
    expect(problems.join(";")).toContain("promptStyle");
    expect(parseChain(JSON.stringify([{ ...LUNARIS, promptStyle: "compact" }]), [])[0]?.promptStyle).toBe("compact");
  });


  it("refuses to start with a link that has no price, naming it, and accepts a subscription link that declares 0", () => {
    const env = { PERFECTMAN_ENABLED: "1", PERFECTMAN_SECRET: "s".repeat(32), PERFECTMAN_DIRECTOR_URL: "ws://d/x", PERFECTMAN_INTERNAL_URL: "http://d", PERFECTMAN_LLM_CHAIN: good, OR_KEY: "k", OC_KEY: "k" };
    expect(() => parseConfig(env)).toThrow(/link "opencode" \(model glm-5\.3-flash\) has no price/);
    expect(() => parseConfig({ ...env, PERFECTMAN_LLM_PRICES: JSON.stringify({ [GO.model]: { inUsdPerMTok: 0, outUsdPerMTok: 0 } }) })).not.toThrow();
    expect(() => parseConfig({ PERFECTMAN_ENABLED: "1", PERFECTMAN_SECRET: "s".repeat(32), PERFECTMAN_DIRECTOR_URL: "ws://d/x", PERFECTMAN_INTERNAL_URL: "http://d", PERFECTMAN_LLM_BASE_URL: "https://llm.example/v1", PERFECTMAN_LLM_API_KEY: "k", PERFECTMAN_LLM_MODELS: "fast" })).toThrow(/model fast has no price/);
  });


  it("does not read the chain at all when the sidecar is disabled", () => {
    expect(() => parseConfig({ PERFECTMAN_ENABLED: "0", PERFECTMAN_LLM_CHAIN: "not json" })).not.toThrow();
    expect(parseConfig({ PERFECTMAN_ENABLED: "false", PERFECTMAN_LLM_CHAIN: '[{"name":1}]' }).llm.chain).toBeUndefined();
  });
});
