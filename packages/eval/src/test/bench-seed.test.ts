import { describe, it, expect, afterEach, vi } from "vitest";
import { benchSeed, localLLMConfig } from "../run/scenario-runner.js";

describe("bench seed wiring (#45)", () => {
  afterEach(() => {
    delete process.env.PERFECTMAN_LLM_SEED;
    delete process.env.PERFECTMAN_LLM_PROVIDER;
    delete process.env.PERFECTMAN_LLM_MODEL;
    delete process.env.PERFECTMAN_LLM_BASE_URL;
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
    const config = localLLMConfig(undefined);
    expect(config.providerType).toBe("ollama");
    expect(config.extraBody?.["seed"]).toBe(benchSeed());
    expect(config.extraBody?.["thinking"]).toBeUndefined();
  });

  it("pins seed into the deepseek-path extraBody", () => {
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    const config = localLLMConfig(undefined);
    expect(config.providerType).toBe("openai-compatible");
    expect(config.extraBody?.["seed"]).toBe(benchSeed());
    // The default deepseek-provider model (deepseek-chat) never had the
    // reasoning-block problem the `thinking` override exists for — see the
    // next two tests, which pin the actual scope.
    expect(config.extraBody?.["thinking"]).toBeUndefined();
  });

  it("uses json_object, not json_schema, for deepseek-v4 (schema mode runs it to the cap and drops memoryWrites); other paths keep constrained decoding", () => {
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    process.env.PERFECTMAN_LLM_MODEL = "deepseek/deepseek-v4-flash";
    expect(localLLMConfig(undefined).responseFormatJsonSchema).toBe(false);
    process.env.PERFECTMAN_LLM_MODEL = "z-ai/glm-5.3-flash";
    expect(localLLMConfig(undefined).responseFormatJsonSchema).toBeUndefined();
    delete process.env.PERFECTMAN_LLM_PROVIDER;
    expect(localLLMConfig(undefined).responseFormatJsonSchema).toBeUndefined();
  });

  it("caps deepseek-v4 output at 2500 tokens with a 0.6 frequency-penalty floor; other cloud models keep 8000", () => {
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    process.env.PERFECTMAN_LLM_MODEL = "deepseek/deepseek-v4-flash";
    const v4 = localLLMConfig(undefined);
    expect(v4.maxOutputTokens).toBe(2500);
    expect(v4.extraBody?.["frequency_penalty"]).toBe(0.6);
    process.env.PERFECTMAN_LLM_MODEL = "z-ai/glm-5.3-flash";
    const other = localLLMConfig(undefined);
    expect(other.maxOutputTokens).toBe(8000);
    expect(other.extraBody?.["frequency_penalty"]).toBeLessThan(0.6);
  });

  it("disables `thinking` only for deepseek-v4-* models, not other openai-compatible endpoints", () => {
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    process.env.PERFECTMAN_LLM_MODEL = "deepseek-v4-flash";
    const config = localLLMConfig(undefined);
    expect(config.extraBody?.["thinking"]).toEqual({ type: "disabled" });
  });

  it("does not send `thinking` to a non-deepseek-v4 model on the openai-compatible path (e.g. a Groq/OpenRouter override), which rejects the unrecognized field with HTTP 400", () => {
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    process.env.PERFECTMAN_LLM_MODEL = "openai/gpt-oss-20b";
    const config = localLLMConfig(undefined);
    expect(config.extraBody?.["thinking"]).toBeUndefined();
  });

  // Root-caused via a live probe against OrcaRouter: its deepseek-v4 models
  // are namespaced ("deepseek/deepseek-v4-flash-free"), so a `startsWith`
  // check never matches and thinking stays enabled — the model burns its
  // whole token budget on reasoning_content and finish_reason:"length" with
  // empty content, the exact failure mode this override exists to prevent.
  it("disables `thinking` for a namespaced deepseek-v4 model id (e.g. a router prefixing it with the provider name)", () => {
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    process.env.PERFECTMAN_LLM_MODEL = "deepseek/deepseek-v4-flash-free";
    const config = localLLMConfig(undefined);
    expect(config.extraBody?.["thinking"]).toEqual({ type: "disabled" });
  });

  // Root-caused via a live capture + isolated raw-response diagnostic:
  // reasoning-capable cloud models (GLM-5.3-flash confirmed; likely others
  // routed through third-party OpenAI-compatible gateways) spend THOUSANDS
  // of output tokens on a hidden reasoning phase before ever emitting the
  // visible JSON — some (e.g. glm-5.3-flash) have no way to disable this at
  // all. The old budget (tuned for small local models, `max(600,
  // sampling.maxTokens*2)`) silently produced empty content: the model hit
  // maxOutputTokens mid-reasoning and never reached the JSON payload. A
  // real capture with the packet schema + persona prompt needed 3272 output
  // tokens to complete — the openai-compatible path needs a ceiling an
  // order of magnitude above the local-model tuning, plus a timeout that
  // accommodates the extra generation time.
  // Since `thinking: {type: "disabled"}` (below) deepseek-v4 no longer spends
  // the budget on a reasoning block, so its ceiling is sized for the intent
  // JSON alone (2500); the reasoning headroom stays for cloud models that
  // cannot switch reasoning off.
  it("gives cloud models a much larger maxOutputTokens ceiling than the local-model tuning; deepseek-v4 (thinking off) sits in between", () => {
    const localConfig = localLLMConfig(undefined);
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    process.env.PERFECTMAN_LLM_MODEL = "z-ai/glm-5.3-flash";
    const cloudConfig = localLLMConfig(undefined);
    expect(cloudConfig.maxOutputTokens).toBeGreaterThanOrEqual(6000);
    expect(cloudConfig.maxOutputTokens).toBeGreaterThan(localConfig.maxOutputTokens);
    process.env.PERFECTMAN_LLM_MODEL = "deepseek-v4-flash";
    const v4 = localLLMConfig(undefined);
    expect(v4.maxOutputTokens).toBe(2500);
    expect(v4.maxOutputTokens).toBeGreaterThan(localConfig.maxOutputTokens);
  });

  // Root-caused via a live capture against Groq specifically: its free
  // `on_demand` tier caps at 8000 tokens-PER-MINUTE and counts the
  // *requested* max_tokens against that budget, not actual usage — a real
  // call needed only ~500 output tokens but the flat 8000 ceiling burned
  // almost the whole per-minute budget on ONE call, 429-ing every other
  // agent's turn for the rest of the run. This is a Groq-specific account
  // limit, not a property of "non-deepseek-v4 models" in general — keying
  // the small budget off the model name (an earlier version of this fix)
  // starved a genuinely reasoning-heavy model (qwen3.8-27b via OrcaRouter,
  // root-caused via a live capture: mostly "Empty or missing content",
  // confirmed via an isolated diagnostic needing 929 output tokens for one
  // real call) that happens not to have "deepseek-v4" in its name. The small
  // ceiling belongs to Groq's endpoint, not to an arbitrary model-name list.
  it("keeps a moderate maxOutputTokens ceiling specifically for Groq, to avoid tripping its token-per-minute limit", () => {
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    process.env.PERFECTMAN_LLM_BASE_URL = "https://api.groq.com/openai/v1";
    process.env.PERFECTMAN_LLM_MODEL = "openai/gpt-oss-120b";
    const config = localLLMConfig(undefined);
    expect(config.maxOutputTokens).toBeLessThan(4000);
    expect(config.maxOutputTokens).toBeGreaterThanOrEqual(1500);
  });

  it("gives a non-Groq, non-deepseek-v4 cloud model the large reasoning-headroom budget too, since hidden reasoning isn't unique to the deepseek-v4 name", () => {
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    process.env.PERFECTMAN_LLM_BASE_URL = "https://api.orcarouter.ai/v1";
    process.env.PERFECTMAN_LLM_MODEL = "qwen/qwen3.8-27b-free";
    const config = localLLMConfig(undefined);
    expect(config.maxOutputTokens).toBeGreaterThanOrEqual(6000);
  });

  it("gives the openai-compatible (cloud) path a longer timeout than the local-model default, to accommodate reasoning-model generation latency", () => {
    const localConfig = localLLMConfig(undefined);
    process.env.PERFECTMAN_LLM_PROVIDER = "deepseek";
    const cloudConfig = localLLMConfig(undefined);
    expect(cloudConfig.timeoutMs).toBeGreaterThan(localConfig.timeoutMs);
  });
});
