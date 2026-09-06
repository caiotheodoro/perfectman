import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JudgeAppConfigSchema } from "@perfectman/shared";

// The committed jury file is what the hidden-objective protocol runs with;
// it once shipped without `providerType` on the jurors and died at parse
// time on the first real run. Parse it the way the loader does.
describe("examples/eval/hoc-jury.json", () => {
  const path = fileURLToPath(new URL("../../../../examples/eval/hoc-jury.json", import.meta.url));
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));

  it("parses under JudgeAppConfigSchema", () => {
    expect(JudgeAppConfigSchema.safeParse(raw).success).toBe(true);
  });

  it("seats three independently-sourced jurors and flags the generator's family", () => {
    const config = JudgeAppConfigSchema.parse(raw);
    const models = (config.jury ?? []).map((j) => j.modelName);
    expect(models).toHaveLength(3);
    expect(new Set(models).size).toBe(3);
    const deepseek = (config.jury ?? []).find((j) => j.modelName.includes("deepseek"));
    expect(deepseek?.label).toMatch(/same family/);
    expect((config.jury ?? []).every((j) => j.apiKeyEnv === "PERFECTMAN_LLM_API_KEY")).toBe(true);
  });

  it("gives glm-5.3-flash the output headroom its un-switchable reasoning needs", () => {
    const config = JudgeAppConfigSchema.parse(raw);
    const glm = (config.jury ?? []).find((j) => j.modelName.includes("glm"));
    expect(glm?.maxTokens).toBe(8000);
    expect(glm?.timeoutMs).toBe(300000);
  });
});
