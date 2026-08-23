import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  loadJudgeConfig,
  loadJudgeSectionFromSimulationConfig,
  parseJudgeConfig,
} from "../judge-config.js";
import { getJudgeConfigPath } from "../../cli/config-path.js";

const validJudgeConfig = {
  providerType: "openai-compatible",
  baseUrl: "https://api.deepseek.com/v1",
  modelName: "deepseek-chat",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  temperature: 0,
  timeoutMs: 90000,
  retryCount: 1,
  jury: [
    {
      providerType: "openai-compatible",
      baseUrl: "http://localhost:11434/v1",
      modelName: "qwen3:8b",
      temperature: 0,
      label: "local-qwen",
    },
  ],
};

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "judge-config-test-"));
  return dir;
}

describe("parseJudgeConfig", () => {
  it("parses a full judge config", () => {
    const config = parseJudgeConfig(validJudgeConfig);
    expect(config.providerType).toBe("openai-compatible");
    expect(config.jury).toHaveLength(1);
    expect(config.jury![0]!.label).toBe("local-qwen");
  });

  it("rejects an invalid judge config with a path-prefixed error", () => {
    expect(() => parseJudgeConfig({ providerType: "deepseek", modelName: "x" }, "judge")).toThrow(
      /judge: /,
    );
    expect(() => parseJudgeConfig({ providerType: "deepseek", modelName: "x" }, "judge")).toThrow(
      /deepseek/,
    );
  });
});

describe("loadJudgeConfig", () => {
  it("loads a judge config file (readFile → JSON.parse → schema)", async () => {
    const dir = await tempDir();
    const path = join(dir, "judge.json");
    await writeFile(path, JSON.stringify(validJudgeConfig));
    try {
      const config = await loadJudgeConfig(path);
      expect(config.providerType).toBe("openai-compatible");
      expect(config.jury![0]!.modelName).toBe("qwen3:8b");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails loudly on a missing judge config file", async () => {
    const dir = await tempDir();
    try {
      await expect(loadJudgeConfig(join(dir, "nope.json"))).rejects.toThrow(/Unable to read judge config/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails loudly on invalid judge config JSON, naming the path", async () => {
    const dir = await tempDir();
    const path = join(dir, "judge.json");
    await writeFile(path, "{ not json");
    try {
      await expect(loadJudgeConfig(path)).rejects.toThrow(
        new RegExp(`Invalid judge config JSON at ${path}`),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails loudly on a schema-invalid judge config", async () => {
    const dir = await tempDir();
    const path = join(dir, "judge.json");
    await writeFile(path, JSON.stringify({ providerType: "bogus", modelName: "x" }));
    try {
      await expect(loadJudgeConfig(path)).rejects.toThrow(/Invalid judge config at /);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("loadJudgeSectionFromSimulationConfig", () => {
  it("returns undefined when no config/index.json exists in the walk-up", async () => {
    const dir = await tempDir();
    try {
      const section = await loadJudgeSectionFromSimulationConfig(dir);
      expect(section).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns undefined when config/index.json has no judge section", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "config"), { recursive: true });
    await writeFile(join(dir, "config", "index.json"), JSON.stringify({ simulation: {}, agents: [] }));
    try {
      const section = await loadJudgeSectionFromSimulationConfig(dir);
      expect(section).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns the judge section from config/index.json (walk-up from nested cwd)", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "config"), { recursive: true });
    await writeFile(
      join(dir, "config", "index.json"),
      JSON.stringify({ simulation: {}, agents: [], judge: validJudgeConfig }),
    );
    const nested = join(dir, "a", "b");
    await mkdir(nested, { recursive: true });
    try {
      const section = await loadJudgeSectionFromSimulationConfig(nested);
      expect(section?.providerType).toBe("openai-compatible");
      expect(section?.jury).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("fails loudly when config/index.json carries an invalid judge section", async () => {
    const dir = await tempDir();
    await mkdir(join(dir, "config"), { recursive: true });
    await writeFile(
      join(dir, "config", "index.json"),
      JSON.stringify({ simulation: {}, agents: [], judge: { providerType: "bogus", modelName: "x" } }),
    );
    try {
      await expect(loadJudgeSectionFromSimulationConfig(dir)).rejects.toThrow(/judge: /);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("getJudgeConfigPath", () => {
  it("resolves --judge-config to an absolute path", () => {
    expect(getJudgeConfigPath(["--judge-config", "/abs/judge.json"])).toBe("/abs/judge.json");
  });

  it("throws when --judge-config has no value", () => {
    expect(() => getJudgeConfigPath(["--judge-config"])).toThrow(/--judge-config requires a path/);
  });

  it("returns undefined when the flag is absent (walk-up section is the next tier)", () => {
    expect(getJudgeConfigPath(["--mode", "mock"])).toBeUndefined();
  });

  it("resolves relative --judge-config against the start dir", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "judge.json"), JSON.stringify(validJudgeConfig));
    try {
      expect(getJudgeConfigPath(["--judge-config", "judge.json"], dir)).toBe(join(dir, "judge.json"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});