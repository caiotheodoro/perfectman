import type { BuiltPrompt } from "@perfectman/server/hotel";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../testing/manual-clock.js";
import { ConfigError, parseConfig } from "../config.js";
import { LlmChain } from "../llm/chain.js";
import { RESERVED_EXTRA_BODY_KEYS, linkSampling, parseChain } from "../llm/chain-config.js";
import type { LlmLink } from "../llm/chain-config.js";
import { hostLlmConfig } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";

const GO = { name: "opencode-go", baseUrl: "https://opencode.ai/zen/go/v1", apiKeyEnv: "OPENCODE_KEY", model: "deepseek-v4.1-flash", sessionHeader: "x-opencode-session", timeoutMs: 60000 };
const PRICES = { [GO.model]: { inUsdPerMTok: 0, outUsdPerMTok: 0 } };
const THINKING_OFF = { thinking: { type: "disabled" } };

const parse = (links: unknown[]): { links: LlmLink[]; problems: string[] } => {
  const problems: string[] = [];
  return { links: parseChain(JSON.stringify(links), problems), problems };
};

describe("extraBody in PERFECTMAN_LLM_CHAIN", () => {
  it("is read onto the link", () => {
    const { links, problems } = parse([{ ...GO, extraBody: THINKING_OFF }]);
    expect(problems).toEqual([]);
    expect(links[0]?.extraBody).toEqual(THINKING_OFF);
  });

  it("stays absent when the entry has none, and null counts as none", () => {
    expect(parse([GO]).links[0]).not.toHaveProperty("extraBody");
    expect(parse([{ ...GO, extraBody: null }]).links[0]).not.toHaveProperty("extraBody");
  });

  it("refuses anything but a plain object, naming the link and the key", () => {
    for (const bad of ["thinking", 3, true, ["thinking"], [{ thinking: 1 }]]) {
      const { links, problems } = parse([{ ...GO, extraBody: bad }]);
      expect(links).toEqual([]);
      expect(problems.join("\n")).toMatch(/PERFECTMAN_LLM_CHAIN\[0\]\.extraBody must be a JSON object/);
    }
  });

  it.each([...RESERVED_EXTRA_BODY_KEYS])("refuses the runtime's own field %s", (key) => {
    const { links, problems } = parse([{ ...GO, extraBody: { ok: 1, [key]: "x" } }]);
    expect(links).toEqual([]);
    expect(problems.join("\n")).toContain(`PERFECTMAN_LLM_CHAIN[0].extraBody.${key} is set by the runtime`);
  });

  it("refuses the snake_case reasoning_effort, which the transport drops, and says to write reasoningEffort", () => {
    const { links, problems } = parse([{ ...GO, extraBody: { reasoning_effort: "none" } }]);
    expect(links).toEqual([]);
    expect(problems.join("\n")).toContain('PERFECTMAN_LLM_CHAIN[0].extraBody.reasoning_effort is dropped by the transport; write "reasoningEffort"');
  });

  it("covers the fields the request builder sets", () => {
    for (const key of ["model", "messages", "stream", "max_tokens", "tools", "n", "temperature", "response_format", "frequency_penalty", "presence_penalty"]) {
      expect(RESERVED_EXTRA_BODY_KEYS).toContain(key);
    }
  });

  it("fails the whole config as an invalid sidecar configuration", () => {
    const env = { PERFECTMAN_ENABLED: "1", PERFECTMAN_SECRET: "s".repeat(32), PERFECTMAN_DIRECTOR_URL: "ws://d/x", PERFECTMAN_INTERNAL_URL: "http://d", PERFECTMAN_LLM_PRICES: JSON.stringify(PRICES), OPENCODE_KEY: "k" };
    const ok = parseConfig({ ...env, PERFECTMAN_LLM_CHAIN: JSON.stringify([{ ...GO, extraBody: THINKING_OFF }]) });
    expect(ok.llm.chain?.[0]?.extraBody).toEqual(THINKING_OFF);
    const run = () => parseConfig({ ...env, PERFECTMAN_LLM_CHAIN: JSON.stringify([{ ...GO, extraBody: { model: "other" } }]) });
    expect(run).toThrow(ConfigError);
    expect(run).toThrow(/Invalid sidecar configuration[\s\S]*PERFECTMAN_LLM_CHAIN\[0\]\.extraBody\.model/);
  });

  it("reaches the request body sent for that link, next to the sampling fields", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 2 }, model: GO.model }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const { links } = parse([{ ...GO, frequencyPenalty: 0.3, extraBody: { ...THINKING_OFF, top_p: 0.9 } }]);
    const clock = new ManualClock();
    const base = hostLlmConfig({ provider: "openai-compatible", baseUrl: GO.baseUrl, apiKeyEnv: GO.apiKeyEnv, models: [GO.model], chain: links, prices: PRICES, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 });
    const chain = new LlmChain({ links, clock, runId: 7, simulationId: "sim", governor: new LlmGovernor(clock, () => 0.5), prices: PRICES, env: { OPENCODE_KEY: "k" } as NodeJS.ProcessEnv, fetchImpl });
    const prompt: BuiltPrompt = { system: "s", user: "u", inputTokensEstimate: 100, purpose: "action_intent", version: "v", templateVersion: "t" };
    await chain.provider({ ...base, extraBody: { fromBase: true } }, "duda").generateIntent({} as never, undefined as never, prompt);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({ model: GO.model, thinking: { type: "disabled" }, top_p: 0.9, ...linkSampling(links[0]!, false) });
    // the link's own extras replace the base's, as a code-built link's already do
    expect(bodies[0]).not.toHaveProperty("fromBase");
  });

  it("sends reasoningEffort on the wire as reasoning_effort", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 2 }, model: GO.model }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const { links } = parse([{ ...GO, extraBody: { reasoningEffort: "none" } }]);
    const clock = new ManualClock();
    const base = hostLlmConfig({ provider: "openai-compatible", baseUrl: GO.baseUrl, apiKeyEnv: GO.apiKeyEnv, models: [GO.model], chain: links, prices: PRICES, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 });
    const chain = new LlmChain({ links, clock, runId: 7, simulationId: "sim", governor: new LlmGovernor(clock, () => 0.5), prices: PRICES, env: { OPENCODE_KEY: "k" } as NodeJS.ProcessEnv, fetchImpl });
    const prompt: BuiltPrompt = { system: "s", user: "u", inputTokensEstimate: 100, purpose: "action_intent", version: "v", templateVersion: "t" };
    await chain.provider(base, "duda").generateIntent({} as never, undefined as never, prompt);
    expect(sent["reasoning_effort"]).toBe("none");
    expect(sent).not.toHaveProperty("reasoningEffort");
  });
});
