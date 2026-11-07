import type { BuiltPrompt, LLMConfig, LLMProvider, LLMProviderResult } from "@perfectman/server/hotel";
import { LLMHttpError } from "@perfectman/server/hotel";
import { describe, expect, it } from "vitest";
import { ManualClock } from "../testing/manual-clock.js";
import { LlmChain } from "../llm/chain.js";
import type { MakeProvider } from "../llm/chain.js";
import type { LlmLink } from "../llm/chain-config.js";
import { hostLlmConfig } from "../llm/env.js";
import { LlmGovernor } from "../llm/governor.js";
import { pricesWithPick, reasoningBody, withPickedModel } from "../llm/run-model.js";
import type { PickedModel } from "../llm/run-model.js";
import { roomFiles } from "@perfectman/shared";
import { compilePersonaMarkdown } from "@perfectman/server/hotel";
import { formToDraft } from "../authoring/scenario-form.js";

const LUNARIS: LlmLink = { name: "lunaris", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OR_KEY", model: "sao10k/l3-lunaris-8b", maxContextTokens: 8192 };
const GO: LlmLink = { name: "opencode", baseUrl: "https://opencode.ai/zen/go/v1", apiKeyEnv: "OC_KEY", model: "glm-5.3-flash" };
const PRICES = { "sao10k/l3-lunaris-8b": { inUsdPerMTok: 0.04, outUsdPerMTok: 0.05 }, "glm-5.3-flash": { inUsdPerMTok: 0, outUsdPerMTok: 0 } };
const ENV = { OR_KEY: "or-test", OC_KEY: "oc-test" } as NodeJS.ProcessEnv;
const BIG: PickedModel = { id: "minimax/minimax-m3.1-flash", context: 1_048_576, price_in: 0.075, price_out: 0.3, reasoning: "mandatory" };

const prompt = (): BuiltPrompt => ({ system: "s", user: "u", inputTokensEstimate: 1000, purpose: "action_intent", version: "v", templateVersion: "t" });
const ok = (): LLMProviderResult => ({ content: "{}", usage: { inputTokens: 1000, outputTokens: 50 }, latencyMs: 400, model: "x" });

describe("a model picked for one run (D54)", () => {
  it("becomes link 1 on OpenRouter with the configured key, and the configured chain stays behind it", () => {
    const links = withPickedModel([LUNARIS, GO], BIG);
    expect(links.map((l) => l.model)).toEqual([BIG.id, LUNARIS.model, GO.model]);
    expect(links[0]).toMatchObject({ name: "pick", baseUrl: LUNARIS.baseUrl, apiKeyEnv: "OR_KEY", maxContextTokens: 1_048_576, promptStyle: "full", extraBody: { reasoning: { effort: "low" } } });
  });

  it("is not tried twice when the chain already has that model, and a mock run (no links) is left alone", () => {
    expect(withPickedModel([LUNARIS, GO], { id: LUNARIS.model, context: 8192 }).map((l) => l.model)).toEqual([LUNARIS.model, GO.model]);
    expect(withPickedModel([], BIG)).toEqual([]);
    expect(withPickedModel([LUNARIS], null)).toEqual([LUNARIS]);
  });

  it("gets the compact prompt at 8K or less, the full one above, and a thinking switch by what the model allows", () => {
    expect(withPickedModel([LUNARIS], { id: "a/small", context: 8192 })[0]?.promptStyle).toBe("compact");
    expect(withPickedModel([LUNARIS], { id: "a/mid", context: 8193 })[0]?.promptStyle).toBe("full");
    expect(reasoningBody("optional")).toEqual({ reasoning: { enabled: false } });
    expect(reasoningBody("none")).toBeUndefined();
  });

  it("is metered at OpenRouter's listed price unless the table already has one", () => {
    expect(pricesWithPick(PRICES, BIG)[BIG.id]).toEqual({ inUsdPerMTok: 0.075, outUsdPerMTok: 0.3 });
    expect(pricesWithPick(PRICES, { id: LUNARIS.model, price_in: 9, price_out: 9 })[LUNARIS.model]).toEqual({ inUsdPerMTok: 0.04, outUsdPerMTok: 0.05 });
    expect(pricesWithPick(PRICES, { id: "a/unpriced" })["a/unpriced"]).toBeUndefined();
  });

  it("serves the call first, and when it fails the configured chain still answers", async () => {
    const calls: Array<{ model: string; extra: unknown }> = [];
    let pickFails = false;
    const make: MakeProvider = (config: LLMConfig) => {
      const provider: LLMProvider = {
        generateIntent: async () => {
          calls.push({ model: config.modelName, extra: config.extraBody });
          if (config.modelName === BIG.id && pickFails) throw new LLMHttpError(503, "upstream down");
          return ok();
        },
      };
      return provider;
    };
    const clock = new ManualClock();
    const links = withPickedModel([LUNARIS, GO], BIG);
    const base = hostLlmConfig({ provider: "openai-compatible", baseUrl: LUNARIS.baseUrl, apiKeyEnv: "OR_KEY", models: [LUNARIS.model, GO.model], chain: [LUNARIS, GO], prices: PRICES, concurrency: 3, softCallsPerMin: 1, softTokensPerHour: 1 });
    const chain = new LlmChain({ links, clock, runId: 7, simulationId: "sim", governor: new LlmGovernor(clock, () => 0.5), prices: pricesWithPick(PRICES, BIG), env: ENV, makeProvider: make });
    const p = chain.provider(base, "duda");
    const generate = () => p.generateIntent(undefined as never, undefined as never, prompt());

    await generate();
    expect(calls).toEqual([{ model: BIG.id, extra: { reasoning: { effort: "low" } } }]);

    pickFails = true;
    calls.length = 0;
    const served = await generate();
    expect(calls.map((c) => c.model)).toEqual([BIG.id, LUNARIS.model]);
    // The failover link does not inherit the pick's thinking switch.
    expect(calls[1]?.extra ?? {}).not.toHaveProperty("reasoning");
    expect(served.content).toBe("{}");
    expect(chain.snapshot().failovers).toBe(1);
  });
});

describe("the builder's persona fields reach the persona file", () => {
  const form = {
    title: "Noite no lounge", situation: "Uma noite no lounge do hotel.", language: "pt-BR" as const,
    cast: ["Goulart", "Enzo"].map((name, i) => ({
      name, role: i ? "connector" : "performer", goal: "Fazer alguém aceitar a aposta.", voice: "Fala alto e rápido.",
      identity: "Barbudo de relógio no pulso.", delay: (i ? "slow" : "quick") as "slow" | "quick",
      triggers: [{ trigger: "Alguém duvida dele", behavior: "Dobra a aposta." }], lines: ["Duvido que vocês aguentem.", "Bora animar isso aqui!", "Quem topa?"],
    })),
  };

  it("carries identity, triggers and reply speed into the compiled persona, in Portuguese", () => {
    const { draft } = formToDraft(form);
    const { personas, scenario } = roomFiles(draft);
    const compiled = compilePersonaMarkdown(personas[0]!.text, personas[0]!.filename);
    expect(compiled.diagnostics.filter((d) => d.level === "error")).toEqual([]);
    expect(compiled.pack?.identityFrame).toMatch(/^Você é Goulart\. Barbudo de relógio no pulso\./);
    expect(compiled.pack?.edgeProfile.triggers[0]).toMatchObject({ trigger: "Alguém duvida dele", behavior: "Dobra a aposta." });
    expect(compiled.pack?.presenceProfile.responseDelayMs).toEqual([400, 2000]);
    expect(compilePersonaMarkdown(personas[1]!.text, personas[1]!.filename).pack?.presenceProfile.responseDelayMs).toEqual([2500, 8000]);
    expect(scenario.text).toContain("Objetivo secreto: Fazer alguém aceitar a aposta.");
    expect(scenario.text).not.toMatch(/Expectant|Private goal/);
  });

  it("holds a cast of twelve", () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ name: `Pessoa${i + 1}`, role: "connector", goal: "Passar a noite." }));
    expect(() => roomFiles(formToDraft({ ...form, cast: twelve }).draft)).not.toThrow();
    expect(() => roomFiles(formToDraft({ ...form, cast: [...twelve, ...twelve.slice(0, 1).map((p) => ({ ...p, name: "Treze" }))] }).draft)).toThrow(/between two and 12/);
  });
});
