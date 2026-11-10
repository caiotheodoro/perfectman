import { describe, expect, it } from "vitest";
import { parseConfig } from "../config.js";
import {
  ADAPTIVE_MIN_SAMPLES,
  ADAPTIVE_TIMEOUT_CAP_MS,
  DEFAULT_LINK_TIMEOUT_MS,
  EXPERIMENTAL_CAST_WARN,
  linkTimeoutMs,
  modelTier,
  paramsBillions,
  parseChain,
} from "../llm/chain-config.js";
import { pickTier, withPickedModel } from "../llm/run-model.js";
import type { LlmLink } from "../llm/chain-config.js";

describe("the size a model id states", () => {
  it.each([
    ["sao10k/l3-lunaris-8b", 8],
    ["gryphe/mythomax-l2-13b", 13],
    ["qwen/qwen3-30b-a3b", 30],
    ["meta-llama/llama-3.1-405b-instruct", 405],
    ["google/gemma-2-9b-it:free", 9],
    ["liquid/lfm-1.5b", 1.5],
  ])("%s is %sB", (id, billions) => {
    expect(paramsBillions(id)).toBe(billions);
  });

  it.each(["deepseek/deepseek-v4.1-flash-1017", "deepseek-v4.1-flash", "glm-5.3-flash", "minimax/minimax-m3.1-flash", "anthropic/claude-haiku-4.5", "openai/gpt-4o-mini", "x/model-v4b"])("%s states none", (id) => {
    expect(paramsBillions(id)).toBeUndefined();
  });
});

describe("a model's tier", () => {
  it("is experimental for an 8B model or a window of 8K or less, whichever is said first", () => {
    expect(modelTier({ id: "sao10k/l3-lunaris-8b", context: 8192 })).toBe("experimental");
    expect(modelTier({ id: "sao10k/l3-lunaris-8b" })).toBe("experimental");
    expect(modelTier({ id: "some/big-model", context: 8192 })).toBe("experimental");
    expect(modelTier({ id: "gryphe/mythomax-l2-13b", context: 4096 })).toBe("experimental");
    expect(modelTier({ id: "x/tiny-3b", context: 1_000_000 })).toBe("experimental");
  });

  it("is fast for a mid-size model or a window up to 32K", () => {
    expect(modelTier({ id: "google/gemma-2-27b-it", context: 8193 })).toBe("fast");
    expect(modelTier({ id: "qwen/qwen3-30b-a3b", context: 131_072 })).toBe("fast");
    expect(modelTier({ id: "some/model", context: 32_768 })).toBe("fast");
    expect(modelTier({ id: "x/model-14b" })).toBe("fast");
  });

  it("is recommended for the rest, and for a model whose window and size are not known", () => {
    expect(modelTier({ id: "deepseek-v4.1-flash" })).toBe("recommended");
    expect(modelTier({ id: "minimax/minimax-m3.1-flash", context: 1_048_576 })).toBe("recommended");
    expect(modelTier({ id: "meta-llama/llama-3.1-405b-instruct", context: 131_072 })).toBe("recommended");
    expect(modelTier({ id: "deepseek-v4.1-flash", context: null })).toBe("recommended");
  });

  it("is what the config says when it says one", () => {
    expect(modelTier({ id: "sao10k/l3-lunaris-8b", context: 8192, tier: "recommended" })).toBe("recommended");
    expect(modelTier({ id: "deepseek-v4.1-flash", tier: "experimental" })).toBe("experimental");
  });

  it("marks a picked model from the hotel's window, not from the 32K the link assumes when the window is unknown", () => {
    expect(pickTier({ id: "sao10k/l3-lunaris-8b", context: 8192 })).toBe("experimental");
    expect(pickTier({ id: "deepseek/deepseek-v4.1-flash-1017", context: null })).toBe("recommended");
    expect(pickTier({ id: "deepseek/deepseek-v4.1-flash-1017" })).toBe("recommended");
    expect(withPickedModel([], { id: "x/model" })).toEqual([]);
    const links = withPickedModel([{ name: "or", baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "K", model: "m" }], { id: "deepseek/deepseek-v4.1-flash-1017" });
    expect(links[0]).toMatchObject({ name: "pick", tier: "recommended", maxContextTokens: 32_768 });
  });

  it("warns for a cast of 3 or more", () => {
    expect(EXPERIMENTAL_CAST_WARN).toBe(3);
  });
});

describe("tier in PERFECTMAN_LLM_CHAIN", () => {
  const entry = { name: "a", baseUrl: "https://x.test/v1", apiKeyEnv: "K", model: "m" };
  const parse = (links: unknown[]): { links: LlmLink[]; problems: string[] } => {
    const problems: string[] = [];
    return { links: parseChain(JSON.stringify(links), problems), problems };
  };

  it("is read onto the link, and absent when unset", () => {
    expect(parse([{ ...entry, tier: "recommended" }]).links[0]?.tier).toBe("recommended");
    expect(parse([entry]).links[0]).not.toHaveProperty("tier");
    expect(parse([{ ...entry, tier: null }]).links[0]).not.toHaveProperty("tier");
  });

  it.each(["best", 3, true, ["fast"]])("refuses %j and names the link", (bad) => {
    const { links, problems } = parse([{ ...entry, tier: bad }]);
    expect(links).toEqual([]);
    expect(problems.join("\n")).toContain('PERFECTMAN_LLM_CHAIN[0].tier must be one of "recommended", "fast", "experimental"');
  });

  it("goes through the sidecar config", () => {
    const env = { PERFECTMAN_ENABLED: "1", PERFECTMAN_SECRET: "s".repeat(32), PERFECTMAN_DIRECTOR_URL: "ws://d/x", PERFECTMAN_INTERNAL_URL: "http://d", PERFECTMAN_LLM_PRICES: JSON.stringify({ m: { inUsdPerMTok: 0, outUsdPerMTok: 0 } }), K: "k" };
    const c = parseConfig({ ...env, PERFECTMAN_LLM_CHAIN: JSON.stringify([{ ...entry, tier: "fast" }]) });
    expect(c.llm.chain?.[0]?.tier).toBe("fast");
  });
});

describe("what one attempt on a link may take", () => {
  const D = DEFAULT_LINK_TIMEOUT_MS;

  it("is the link's own timeoutMs as written, cut to what is left of the deadline", () => {
    expect(linkTimeoutMs({ timeoutMs: 60_000 }, 9000, 100, 13_000)).toBe(13_000);
    expect(linkTimeoutMs({ timeoutMs: 2000 }, 9000, 100, 13_000)).toBe(2000);
    // an explicit value wins over a p95 that would raise it, and over one that would lower it
    expect(linkTimeoutMs({ timeoutMs: 5000 }, 5900, 100, 13_000)).toBe(5000);
    expect(linkTimeoutMs({ timeoutMs: 8000 }, 1000, 100, 13_000)).toBe(8000);
  });

  it("is the 5 s default for a link with no history, or too little of it", () => {
    expect(linkTimeoutMs({}, undefined, 0, 13_000)).toBe(D);
    expect(linkTimeoutMs({}, 9000, ADAPTIVE_MIN_SAMPLES - 1, 13_000)).toBe(D);
  });

  it("is 1.5 times the link's p95 once it has the samples, never under the default and never over the cap", () => {
    expect(linkTimeoutMs({}, 5900, ADAPTIVE_MIN_SAMPLES, 13_000)).toBe(8850);
    expect(linkTimeoutMs({}, 2000, 50, 13_000)).toBe(D);
    expect(linkTimeoutMs({}, 3300, 50, 13_000)).toBe(D);
    expect(linkTimeoutMs({}, 3400, 50, 13_000)).toBe(5100);
    expect(linkTimeoutMs({}, 20_000, 50, 13_000)).toBe(ADAPTIVE_TIMEOUT_CAP_MS);
  });

  it("is always bounded by what is left of the deadline", () => {
    expect(linkTimeoutMs({}, 5900, 50, 3000)).toBe(3000);
    expect(linkTimeoutMs({}, undefined, 0, 1800)).toBe(1800);
    expect(linkTimeoutMs({}, 8000, 50, 0)).toBe(0);
  });
});
