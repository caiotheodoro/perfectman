import { LLMTimeoutError } from "@perfectman/server/hotel";
import type { BuiltPrompt, LLMConfig, LLMProvider, LLMProviderResult } from "@perfectman/server/hotel";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../testing/manual-clock.js";
import { LlmChain } from "../llm/chain.js";
import type { MakeProvider } from "../llm/chain.js";
import type { LlmLink } from "../llm/chain-config.js";
import { hostLlmConfig } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";

const MYTHO: LlmLink = { name: "mythomax", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "gryphe/mythomax-l2-13b", maxContextTokens: 4096 };
const LUNARIS: LlmLink = { name: "lunaris", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "sao10k/l3-lunaris-8b", maxContextTokens: 8192 };
const GO: LlmLink = { name: "opencode", baseUrl: "https://opencode.ai/zen/go/v1", apiKeyEnv: "OC_KEY", model: "glm-5.3-flash", sessionHeader: "x-opencode-session" };
const PRICES = { "gryphe/mythomax-l2-13b": { inUsdPerMTok: 0.08, outUsdPerMTok: 0.11 }, "sao10k/l3-lunaris-8b": { inUsdPerMTok: 0.04, outUsdPerMTok: 0.05 }, "glm-5.3-flash": { inUsdPerMTok: 0, outUsdPerMTok: 0 } };
const ENV = { OR_KEY: "or-test", OC_KEY: "oc-test" } as NodeJS.ProcessEnv;

const BASE: LLMConfig = hostLlmConfig({ provider: "openai-compatible", baseUrl: MYTHO.baseUrl, apiKeyEnv: "OR_KEY", models: [MYTHO.model], chain: [MYTHO, LUNARIS, GO], prices: PRICES, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 });
const prompt = (estimate = 2000): BuiltPrompt => ({ system: "s", user: "u", inputTokensEstimate: estimate, purpose: "action_intent", version: "v", templateVersion: "t" });
const ok = (over: Partial<LLMProviderResult> = {}): LLMProviderResult => ({ content: "{}", usage: { inputTokens: 2400, outputTokens: 100 }, latencyMs: 1500, model: "x", ...over });

type Script = Record<string, Array<LLMProviderResult | Error | (() => Promise<LLMProviderResult>)>>;

function scripted(script: Script): { make: MakeProvider; calls: string[]; configs: LLMConfig[] } {
  const calls: string[] = [];
  const configs: LLMConfig[] = [];
  const make: MakeProvider = (config) => {
    const provider: LLMProvider = {
      generateIntent: async () => {
        calls.push(config.modelName);
        configs.push(config);
        const steps = script[config.modelName] ?? [ok()];
        const step = steps.length > 1 ? steps.shift()! : steps[0]!;
        if (step instanceof Error) throw step;
        return typeof step === "function" ? step() : step;
      },
    };
    return provider;
  };
  return { make, calls, configs };
}

function chain(script: Script, links: LlmLink[], clock: ManualClock) {
  const s = scripted(script);
  const c = new LlmChain({ links, clock, runId: 42, simulationId: "sim", governor: new LlmGovernor(clock, () => 0.5), prices: PRICES, env: ENV, makeProvider: s.make });
  const p = c.provider(BASE, "duda");
  return { call: () => p.generateIntent(undefined as never, undefined as never, prompt()), ...s };
}

describe("answers nobody should be left without", () => {
  const SILENT = ok({ content: JSON.stringify({ intentType: "no_op", privateMotiveSummary: "prefiro esperar" }) });
  const SAYS = ok({ content: JSON.stringify({ intentType: "send_message", visibleContent: "Oi!", privateMotiveSummary: "x" }) });

  function waiting(script: Script, addressed: boolean, links: LlmLink[] = [LUNARIS, MYTHO, GO]) {
    const s = scripted(script);
    const clock = new ManualClock();
    const seen: string[] = [];
    const make: MakeProvider = (config, deps) => {
      const inner = s.make(config, deps);
      return { generateIntent: async (a, b, p) => (seen.push(p.system), inner.generateIntent(a, b, p)) };
    };
    const c = new LlmChain({ links, clock, runId: 1, simulationId: "sim", governor: new LlmGovernor(clock, () => 0.5), prices: PRICES, env: ENV, makeProvider: make, addressed: () => addressed });
    const p = c.provider(BASE, "duda");
    return { c, calls: s.calls, seen, call: (retry?: "correction") => p.generateIntent(undefined as never, undefined as never, { ...prompt(), system: "Você fala pt-BR", ...(retry ? { retry } : {}) }) };
  }

  it("asks the next link once when the actor is silent on a line addressed to it, with the reason to speak", async () => {
    const { calls, seen, call } = waiting({ [LUNARIS.model]: [SILENT], [MYTHO.model]: [SAYS] }, true);
    const r = await call();
    expect(calls).toEqual([LUNARIS.model, MYTHO.model]);
    expect(JSON.parse(r.content)).toMatchObject({ intentType: "send_message" });
    expect(r.routedModel).toBe("mythomax");
    expect(seen[0]).not.toContain("espera uma resposta");
    expect(seen[1]).toContain("espera uma resposta");
  });

  it("keeps the silence when every link chooses it, and never asks about an ambient turn", async () => {
    const all = waiting({ [LUNARIS.model]: [SILENT], [MYTHO.model]: [SILENT], [GO.model]: [SILENT] }, true);
    expect(JSON.parse((await all.call()).content).intentType).toBe("no_op");
    expect(all.calls).toHaveLength(2);
    const ambient = waiting({ [LUNARIS.model]: [SILENT] }, false);
    await ambient.call();
    expect(ambient.calls).toEqual([LUNARIS.model]);
  });

  it("a retry of a near-duplicate goes to a different link than the one that just answered, the first one last", async () => {
    const { calls, call } = waiting({ [LUNARIS.model]: [SAYS], [MYTHO.model]: [SAYS], [GO.model]: [SAYS] }, false);
    await call();
    await call("correction");
    await call("correction");
    expect(calls).toEqual([LUNARIS.model, MYTHO.model, GO.model]);
    await call();
    expect(calls.at(-1)).toBe(LUNARIS.model);
  });

  it("a slow link cannot eat the turn: each attempt is clipped to what is left of the chain deadline", async () => {
    const clock = new ManualClock();
    const slow = (): Promise<LLMProviderResult> => clock.advance(5000).then(() => Promise.reject(new LLMTimeoutError("t")));
    const { call, calls, configs } = chain({ [MYTHO.model]: [slow], [LUNARIS.model]: [slow], [GO.model]: [ok()] }, [MYTHO, LUNARIS, GO], clock);
    await call();
    expect(calls).toEqual([MYTHO.model, LUNARIS.model, GO.model]);
    expect(configs.slice(0, 2).map((cfg) => cfg.timeoutMs)).toEqual([5000, 5000]);
    expect(configs[2]?.timeoutMs).toBe(3000);
  });

  it("gives the one link that could answer a second try when it failed on a blip, and not on a refusal", async () => {
    const blip = new Error("Invalid JSON response");
    const a = waiting({ [LUNARIS.model]: [blip, SAYS], [MYTHO.model]: [SAYS] }, false);
    expect(JSON.parse((await a.call()).content).intentType).toBe("send_message");
    expect(a.calls).toEqual([LUNARIS.model, MYTHO.model]);
    const only = chain({ [LUNARIS.model]: [blip, SAYS] }, [LUNARIS], new ManualClock());
    expect(JSON.parse((await only.call()).content).intentType).toBe("send_message");
    expect(only.calls).toEqual([LUNARIS.model, LUNARIS.model]);
    const refused = chain({ [LUNARIS.model]: [new LLMTimeoutError("t")] }, [LUNARIS], new ManualClock());
    await expect(refused.call()).rejects.toThrow();
    expect(refused.calls).toEqual([LUNARIS.model]);
  });

  it("adds the reason to speak to the retry of a copy on a line addressed to the actor, and sends the retry to the link that copies less", async () => {
    const a = waiting({ [LUNARIS.model]: [SAYS], [MYTHO.model]: [SAYS] }, true);
    await a.call();
    await a.call("correction");
    expect(a.seen.at(-1)).toContain("espera uma resposta");
    expect(a.calls.at(-1)).toBe(MYTHO.model);
    // After enough retries that showed mythomax copying far more than lunaris, a retry stays on lunaris.
    const b = waiting({ [LUNARIS.model]: [SAYS], [MYTHO.model]: [SAYS] }, false, [LUNARIS, MYTHO]);
    for (let i = 0; i < 7; i++) {
      await b.call();
      await b.call("correction");
      await b.call("correction");
    }
    const before = b.calls.length;
    await b.call();
    await b.call("correction");
    expect(b.calls.slice(before)).toEqual([LUNARIS.model, LUNARIS.model]);
  });
});
