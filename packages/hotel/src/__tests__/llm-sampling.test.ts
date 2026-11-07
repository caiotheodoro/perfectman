import type { BuiltPrompt, LLMConfig, LLMProvider, LLMProviderResult } from "@perfectman/server/hotel";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../testing/manual-clock.js";
import { LlmChain } from "../llm/chain.js";
import type { MakeProvider } from "../llm/chain.js";
import { KNOWN_SAMPLING, RETRY_PENALTY_BOOST, linkSampling, parseChain } from "../llm/chain-config.js";
import type { LlmLink } from "../llm/chain-config.js";
import { hostLlmConfig } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";

const LUNARIS: LlmLink = { name: "lunaris", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "sao10k/l3-lunaris-8b", maxContextTokens: 8192 };
const GO: LlmLink = { name: "opencode", baseUrl: "https://opencode.ai/zen/go/v1", apiKeyEnv: "OC_KEY", model: "glm-5.3-flash" };

describe("decoding penalties per link", () => {
  it("a known model carries its entry, an unknown one none, and 0 turns a penalty off", () => {
    expect(linkSampling(LUNARIS, false)).toEqual({ frequency_penalty: KNOWN_SAMPLING[LUNARIS.model]!.frequencyPenalty, presence_penalty: KNOWN_SAMPLING[LUNARIS.model]!.presencePenalty });
    expect(linkSampling(GO, false)).toEqual({});
    expect(linkSampling({ ...LUNARIS, frequencyPenalty: 0 }, false)).toEqual({ presence_penalty: KNOWN_SAMPLING[LUNARIS.model]!.presencePenalty });
    expect(linkSampling({ ...LUNARIS, frequencyPenalty: 0, presencePenalty: 0 }, true)).toEqual({});
  });

  it("the link's own value wins over the model's entry, and the retry of a near-duplicate adds the boost, capped at 2", () => {
    expect(linkSampling({ ...LUNARIS, frequencyPenalty: 0.5 }, false).frequency_penalty).toBe(0.5);
    expect(linkSampling({ ...LUNARIS, frequencyPenalty: 0.5 }, true).frequency_penalty).toBe(Math.round((0.5 + RETRY_PENALTY_BOOST) * 100) / 100);
    expect(linkSampling({ ...LUNARIS, frequencyPenalty: 1.9 }, true).frequency_penalty).toBe(2);
    expect(linkSampling(GO, true)).toEqual({});
  });

  it("parseChain reads both and refuses a value outside -2..2", () => {
    const problems: string[] = [];
    const links = parseChain(JSON.stringify([{ ...LUNARIS, frequencyPenalty: 0.2, presencePenalty: -0.1 }]), problems);
    expect(problems).toEqual([]);
    expect(links[0]).toMatchObject({ frequencyPenalty: 0.2, presencePenalty: -0.1 });
    const bad: string[] = [];
    expect(parseChain(JSON.stringify([{ ...LUNARIS, presencePenalty: 3 }]), bad)).toEqual([]);
    expect(bad[0]).toMatch(/presencePenalty must be a number between -2 and 2/);
  });

  it("reaches the provider's request body root through extraBody, higher on the retry of a near-duplicate", async () => {
    const seen: LLMConfig[] = [];
    const make: MakeProvider = (config) => {
      const provider: LLMProvider = {
        generateIntent: async (): Promise<LLMProviderResult> => {
          seen.push(config);
          return { content: "{}", usage: { inputTokens: 100, outputTokens: 10 }, latencyMs: 100, model: "x" };
        },
      };
      return provider;
    };
    const clock = new ManualClock();
    const prices = { [LUNARIS.model]: { inUsdPerMTok: 0.04, outUsdPerMTok: 0.05 }, [GO.model]: { inUsdPerMTok: 0, outUsdPerMTok: 0 } };
    const base = hostLlmConfig({ provider: "openai-compatible", baseUrl: LUNARIS.baseUrl, apiKeyEnv: "OR_KEY", models: [LUNARIS.model], chain: [LUNARIS], prices, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 });
    const chain = new LlmChain({ links: [LUNARIS], clock, runId: 1, simulationId: "sim", governor: new LlmGovernor(clock, () => 0.5), prices, env: { OR_KEY: "k" } as NodeJS.ProcessEnv, makeProvider: make });
    const provider = chain.provider({ ...base, extraBody: { keep: "me" } }, "duda");
    const prompt: BuiltPrompt = { system: "s", user: "u", inputTokensEstimate: 100, purpose: "action_intent", version: "v", templateVersion: "t" };
    await provider.generateIntent(undefined as never, undefined as never, prompt);
    await provider.generateIntent(undefined as never, undefined as never, { ...prompt, retry: "correction" });
    expect(seen[0]!.extraBody).toEqual({ keep: "me", ...linkSampling(LUNARIS, false) });
    expect(seen[1]!.extraBody).toEqual({ keep: "me", ...linkSampling(LUNARIS, true) });
    expect(seen[1]!.temperature).toBeGreaterThan(seen[0]!.temperature);
    expect(seen[1]!.temperature).toBeLessThanOrEqual(1.1);
    expect(seen[1]!.extraBody!["frequency_penalty"]).toBeGreaterThan(seen[0]!.extraBody!["frequency_penalty"] as number);
  });
});
