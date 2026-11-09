import { describe, expect, it } from "vitest";
import { ConfigError, parseBind, parseConfig } from "../config.js";

const GOOD = {
  PERFECTMAN_ENABLED: "1",
  PERFECTMAN_SECRET: "s".repeat(32),
  PERFECTMAN_DIRECTOR_URL: "ws://tilehouse:8081/director",
  PERFECTMAN_INTERNAL_URL: "http://tilehouse:8081",
  PERFECTMAN_LLM_BASE_URL: "https://llm.example/v1",
  PERFECTMAN_LLM_API_KEY: "k",
  PERFECTMAN_LLM_MODELS: "fast-model, other-model",
  PERFECTMAN_LLM_PRICES: JSON.stringify({ "fast-model": { inUsdPerMTok: 1, outUsdPerMTok: 2 }, "other-model": { inUsdPerMTok: 1, outUsdPerMTok: 2 } }),
};

describe("sidecar configuration", () => {
  it("parses a full environment with the plan's defaults", () => {
    const c = parseConfig(GOOD);
    expect(c).toMatchObject({ enabled: true, maxRuns: 3, authoringPort: 9101, healthPort: 9100, dataDir: "/data/perfectman", eventRetention: 5000 });
    expect(c.llm).toMatchObject({ models: ["fast-model", "other-model"], concurrency: 3, apiKeyEnv: "PERFECTMAN_LLM_API_KEY" });
  });

  it("[SAFE-1] reads PERFECTMAN_DRAMA fail-closed: unset leaves the config as it was, on is on, a typo is off with a warning", () => {
    expect(parseConfig(GOOD)).not.toHaveProperty("drama");
    expect(parseConfig({ ...GOOD, PERFECTMAN_DRAMA: "yes" })).toMatchObject({ drama: true });
    expect(parseConfig({ ...GOOD, PERFECTMAN_DRAMA: "off" })).not.toHaveProperty("drama");
    const typo = parseConfig({ ...GOOD, PERFECTMAN_DRAMA: "treu" });
    expect(typo).not.toHaveProperty("drama");
    expect(typo.dramaWarning).toContain("treu");
  });

  it("[DEATH-5] the ghost voice is a flag that is off unless asked, parsed like the drama switch, and means nothing without drama", () => {
    expect(parseConfig({ ...GOOD, PERFECTMAN_DRAMA: "on" })).not.toHaveProperty("dramaGhostVoice");
    expect(parseConfig({ ...GOOD, PERFECTMAN_DRAMA: "on", PERFECTMAN_DRAMA_GHOST_VOICE: "yes" })).toMatchObject({ dramaGhostVoice: true });
    expect(parseConfig({ ...GOOD, PERFECTMAN_DRAMA: "on", PERFECTMAN_DRAMA_GHOST_VOICE: "treu" })).not.toHaveProperty("dramaGhostVoice");
    expect(parseConfig({ ...GOOD, PERFECTMAN_DRAMA_GHOST_VOICE: "on" })).not.toHaveProperty("dramaGhostVoice");
  });

  it("is quiet when disabled: nothing is required", () => {
    expect(parseConfig({ PERFECTMAN_ENABLED: "0" }).enabled).toBe(false);
  });

  it("fails fast naming every missing piece at once", () => {
    const err = (() => {
      try {
        parseConfig({ PERFECTMAN_ENABLED: "1" });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).problems.join("\n")).toMatch(/SECRET[\s\S]*DIRECTOR_URL[\s\S]*INTERNAL_URL[\s\S]*LLM_MODELS[\s\S]*LLM_BASE_URL[\s\S]*LLM_API_KEY/);
  });

  it("rejects a short secret and a bad price table", () => {
    expect(() => parseConfig({ ...GOOD, PERFECTMAN_SECRET: "short" })).toThrow(/at least 32/);
    expect(() => parseConfig({ ...GOOD, PERFECTMAN_LLM_PRICES: "{\"m\":{\"inUsdPerMTok\":1}}" })).toThrow(/PERFECTMAN_LLM_PRICES/);
  });

  it("reads the price table and the mock provider needs no URL or key", () => {
    const c = parseConfig({ ...GOOD, PERFECTMAN_LLM_PRICES: "{\"fast-model\":{\"inUsdPerMTok\":0.2,\"outUsdPerMTok\":0.8},\"other-model\":{\"inUsdPerMTok\":0,\"outUsdPerMTok\":0}}" });
    expect(c.llm.prices["fast-model"]).toEqual({ inUsdPerMTok: 0.2, outUsdPerMTok: 0.8 });
    const mock = parseConfig({ PERFECTMAN_ENABLED: "1", PERFECTMAN_SECRET: GOOD.PERFECTMAN_SECRET, PERFECTMAN_DIRECTOR_URL: GOOD.PERFECTMAN_DIRECTOR_URL, PERFECTMAN_INTERNAL_URL: GOOD.PERFECTMAN_INTERNAL_URL, PERFECTMAN_LLM_PROVIDER: "mock" });
    expect(mock.llm).toMatchObject({ provider: "mock", models: ["mock"] });
    // Compose passes unset settings through as empty strings; that must still mean "the default".
    const blank = parseConfig({ PERFECTMAN_ENABLED: "1", PERFECTMAN_SECRET: GOOD.PERFECTMAN_SECRET, PERFECTMAN_DIRECTOR_URL: GOOD.PERFECTMAN_DIRECTOR_URL, PERFECTMAN_INTERNAL_URL: GOOD.PERFECTMAN_INTERNAL_URL, PERFECTMAN_LLM_PROVIDER: "mock", PERFECTMAN_LLM_MODELS: "", PERFECTMAN_LLM_BASE_URL: "" });
    expect(blank.llm.models).toEqual(["mock"]);
  });

  it.each([
    ["0.0.0.0:9101", { host: "0.0.0.0", port: 9101 }],
    [":9200", { host: "127.0.0.1", port: 9200 }],
    [undefined, { host: "127.0.0.1", port: 9101 }],
  ])("parses the authoring bind %s", (raw, expected) => {
    expect(parseBind(raw, [])).toEqual(expected);
  });
});
