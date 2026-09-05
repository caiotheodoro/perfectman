import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyJudgeShorthand,
  loadJudgeConfig,
} from "../llm/judge-config.js";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "eval-judge-config-test-"));
}

async function writeSimConfig(dir: string, judge?: unknown): Promise<void> {
  await mkdir(join(dir, "config"), { recursive: true });
  const body: Record<string, unknown> = { simulation: {}, agents: [] };
  if (judge !== undefined) body["judge"] = judge;
  await writeFile(join(dir, "config", "index.json"), JSON.stringify(body));
}

const section = {
  providerType: "openai-compatible",
  modelName: "section-model",
  temperature: 0.25,
};

const standalone = {
  providerType: "openai-compatible",
  modelName: "file-model",
  apiKeyEnv: "DEEPSEEK_API_KEY",
  temperature: 0,
  timeoutMs: 12345,
  jury: [
    { providerType: "openai-compatible", modelName: "jury-model", label: "jury-a" },
    { providerType: "openai-compatible", modelName: "jury-model-2", label: "jury-b", apiKeyEnv: "JURY_KEY" },
  ],
};

describe("loadJudgeConfig precedence", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("tier 1: an explicit --judge-config file wins over the config/index.json section", async () => {
    const dir = await tempDir();
    await writeSimConfig(dir, section);
    const filePath = join(dir, "judge.json");
    await writeFile(filePath, JSON.stringify(standalone));
    try {
      const resolved = await loadJudgeConfig(["--judge-config", filePath], { cwd: dir });
      expect(resolved.config.model).toBe("file-model");
      expect(resolved.config.timeoutMs).toBe(12345);
      expect(resolved.jury?.map((j) => j.label)).toEqual(["jury-a", "jury-b"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("tier 1: --judge-config resolves relative paths against the cwd", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "judge.json"), JSON.stringify(standalone));
    try {
      const resolved = await loadJudgeConfig(["--judge-config", "judge.json"], { cwd: dir });
      expect(resolved.config.model).toBe("file-model");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("tier 2: the walk-up config/index.json judge section is used when no --judge-config", async () => {
    const dir = await tempDir();
    await writeSimConfig(dir, section);
    try {
      const resolved = await loadJudgeConfig([], { cwd: dir });
      expect(resolved.providerType).toBe("openai-compatible");
      expect(resolved.config.model).toBe("section-model");
      expect(resolved.config.temperature).toBe(0.25);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("tier 2: a config/index.json without a judge section falls through to env", async () => {
    const dir = await tempDir();
    await writeSimConfig(dir);
    vi.stubEnv("PERFECTMAN_JUDGE_BASE_URL", "https://api.deepseek.com/v1");
    vi.stubEnv("PERFECTMAN_JUDGE_MODEL", "deepseek-chat");
    try {
      const resolved = await loadJudgeConfig([], { cwd: dir });
      expect(resolved.config.baseUrl).toBe("https://api.deepseek.com/v1");
      expect(resolved.config.model).toBe("deepseek-chat");
      expect(resolved.providerType).toBe("rule");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves apiKeyEnv by name into the runtime apiKey (file tier)", async () => {
    const dir = await tempDir();
    vi.stubEnv("DEEPSEEK_API_KEY", "sk-file-secret");
    await writeFile(join(dir, "judge.json"), JSON.stringify(standalone));
    try {
      const resolved = await loadJudgeConfig(["--judge-config", "judge.json"], { cwd: dir });
      expect(resolved.config.apiKey).toBe("sk-file-secret");
      expect(resolved.jury![0]!.apiKey).toBeUndefined();
      expect(resolved.jury![1]!.apiKey).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("file tier NEVER inherits the ambient PERFECTMAN_LLM_API_KEY (secrets resolve only via apiKeyEnv)", async () => {
    const dir = await tempDir();
    vi.stubEnv("PERFECTMAN_LLM_API_KEY", "sk-ambient");
    await writeFile(join(dir, "judge.json"), JSON.stringify({ providerType: "openai-compatible", modelName: "m", baseUrl: "http://other-host/v1" }));
    try {
      const resolved = await loadJudgeConfig(["--judge-config", "judge.json"], { cwd: dir });
      expect(resolved.config.apiKey).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("envOnly skips both file tiers (compat path is immune to stray config/index.json files)", async () => {
    const dir = await tempDir();
    await writeSimConfig(dir, section);
    const filePath = join(dir, "judge.json");
    await writeFile(filePath, JSON.stringify(standalone));
    vi.stubEnv("PERFECTMAN_JUDGE_MODEL", "env-model");
    try {
      const resolved = await loadJudgeConfig(["--judge-config", filePath], { cwd: dir, envOnly: true });
      expect(resolved.config.model).toBe("env-model");
      expect(resolved.providerType).toBe("rule");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("warns on validated-but-unconsumed keys and unknown keys (typo surface), still resolving", async () => {
    const dir = await tempDir();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeFile(
      join(dir, "judge.json"),
      JSON.stringify({
        providerType: "openai-compatible",
        modelName: "m",
        responseFormatJson: true,
        retryCount: 2,
        baseURL: "http://typo-host/v1",
      }),
    );
    try {
      const resolved = await loadJudgeConfig(["--judge-config", "judge.json"], { cwd: dir });
      expect(resolved.config.model).toBe("m");
      expect(warn).toHaveBeenCalled();
      const joined = warn.mock.calls.map((c) => String(c[0])).join("\n");
      expect(joined).toMatch(/responseFormatJson/);
      expect(joined).toMatch(/retryCount/);
      expect(joined).toMatch(/baseURL/);
    } finally {
      warn.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not warn on the env tier", async () => {
    const dir = await tempDir();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await loadJudgeConfig([], { cwd: dir });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves a per-entry maxTokens and leaves it undefined when unset, without warning", async () => {
    const dir = await tempDir();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await writeFile(
      join(dir, "judge.json"),
      JSON.stringify({
        ...standalone,
        jury: [
          { providerType: "openai-compatible", modelName: "glm", label: "glm", maxTokens: 4000 },
          { providerType: "openai-compatible", modelName: "qwen", label: "qwen" },
        ],
      }),
    );
    try {
      const resolved = await loadJudgeConfig(["--judge-config", "judge.json"], { cwd: dir });
      expect(resolved.config.maxTokens).toBeUndefined();
      expect(resolved.jury?.[0]?.maxTokens).toBe(4000);
      expect(resolved.jury?.[1]?.maxTokens).toBeUndefined();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves each jury entry's own apiKeyEnv", async () => {
    const dir = await tempDir();
    vi.stubEnv("JURY_KEY", "sk-jury-secret");
    await writeFile(join(dir, "judge.json"), JSON.stringify(standalone));
    try {
      const resolved = await loadJudgeConfig(["--judge-config", "judge.json"], { cwd: dir });
      expect(resolved.jury![1]!.apiKey).toBe("sk-jury-secret");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("tier 3: env-only resolution is byte-identical to the pre-pivot judgeConfig()", async () => {
    const dir = await tempDir();
    vi.stubEnv("PERFECTMAN_LLM_PROVIDER", "local");
    vi.stubEnv("PERFECTMAN_JUDGE_BASE_URL", "https://api.deepseek.com/v1");
    vi.stubEnv("PERFECTMAN_LLM_BASE_URL", "http://localhost:11434/v1");
    vi.stubEnv("PERFECTMAN_JUDGE_MODEL", "deepseek-chat");
    vi.stubEnv("PERFECTMAN_LLM_MODEL", "qwen3:1.7b");
    vi.stubEnv("PERFECTMAN_JUDGE_TEMPERATURE", "0");
    vi.stubEnv("PERFECTMAN_LLM_API_KEY", "sk-env");
    try {
      const resolved = await loadJudgeConfig([], { cwd: dir });
      expect(resolved.config).toEqual({
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
        apiKey: "sk-env",
        temperature: 0,
        timeoutMs: 90000,
      });
      expect(resolved.providerType).toBe("rule");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("env tier: PERFECTMAN_LLM_PROVIDER=deepseek is the endpoint shortcut, not a provider type", async () => {
    const dir = await tempDir();
    vi.stubEnv("PERFECTMAN_LLM_PROVIDER", "deepseek");
    try {
      const resolved = await loadJudgeConfig([], { cwd: dir });
      expect(resolved.config.baseUrl).toBe("https://api.deepseek.com/v1");
      expect(resolved.config.model).toBe("deepseek-chat");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("tier 4: defaults — clean env + no file yields the local qwen3 endpoint with the bench default temperature", async () => {
    const dir = await tempDir();
    try {
      const resolved = await loadJudgeConfig([], { cwd: dir });
      expect(resolved.config).toEqual({
        baseUrl: "http://localhost:11434/v1",
        model: "qwen3:8b",
        apiKey: undefined,
        temperature: 1.0,
        timeoutMs: 90000,
      });
      expect(resolved.providerType).toBe("rule");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the calibration default at temperature 0 (defaultTemperature option)", async () => {
    const dir = await tempDir();
    try {
      const resolved = await loadJudgeConfig([], { cwd: dir, defaultTemperature: 0 });
      expect(resolved.config.temperature).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("env temperature parsing matches the pre-pivot judgeConfig exactly (empty/unset → default)", async () => {
    const dir = await tempDir();
    vi.stubEnv("PERFECTMAN_JUDGE_TEMPERATURE", "");
    try {
      const resolved = await loadJudgeConfig([], { cwd: dir });
      expect(resolved.config.temperature).toBe(1.0);
    } finally {
      await rm(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
    const dir2 = await tempDir();
    vi.stubEnv("PERFECTMAN_JUDGE_TEMPERATURE", "  ");
    try {
      const resolved = await loadJudgeConfig([], { cwd: dir2 });
      expect(resolved.config.temperature).toBe(1.0);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it("env tier: PERFECTMAN_JUDGE_TIMEOUT_MS overrides the 90s default (slow local models need more)", async () => {
    const dir = await tempDir();
    vi.stubEnv("PERFECTMAN_JUDGE_TIMEOUT_MS", "300000");
    try {
      const resolved = await loadJudgeConfig([], { cwd: dir });
      expect(resolved.config.timeoutMs).toBe(300000);
    } finally {
      await rm(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  });

  it("env tier: an empty/non-numeric PERFECTMAN_JUDGE_TIMEOUT_MS falls back to the 90s default", async () => {
    const dir = await tempDir();
    vi.stubEnv("PERFECTMAN_JUDGE_TIMEOUT_MS", "");
    try {
      expect((await loadJudgeConfig([], { cwd: dir })).config.timeoutMs).toBe(90000);
    } finally {
      vi.unstubAllEnvs();
    }
    vi.stubEnv("PERFECTMAN_JUDGE_TIMEOUT_MS", "not-a-number");
    try {
      expect((await loadJudgeConfig([], { cwd: dir })).config.timeoutMs).toBe(90000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("intentionally does NOT read a judge.json without --judge-config (section is the only file fallback)", async () => {
    const dir = await tempDir();
    await writeFile(join(dir, "judge.json"), JSON.stringify(standalone));
    try {
      const resolved = await loadJudgeConfig([], { cwd: dir });
      expect(resolved.config.model).toBe("qwen3:8b");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("applyJudgeShorthand", () => {
  const resolved = { providerType: "openai-compatible" as const, config: { baseUrl: "x", model: "m" } };

  it("maps --judge llm to openai-compatible", () => {
    expect(applyJudgeShorthand(resolved, "llm")).toBe("openai-compatible");
  });

  it("maps --judge rule to rule", () => {
    expect(applyJudgeShorthand(resolved, "rule")).toBe("rule");
  });

  it("keeps the resolved providerType when no flag is passed", () => {
    expect(applyJudgeShorthand(resolved, undefined)).toBe("openai-compatible");
    expect(applyJudgeShorthand({ ...resolved, providerType: "mock" }, undefined)).toBe("mock");
  });
});
