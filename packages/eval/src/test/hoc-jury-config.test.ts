import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JudgeAppConfigSchema } from "@perfectman/shared";

// The committed jury file is what the hidden-objective protocol runs with;
// it once shipped without `providerType` on the jurors and died at parse
// time on the first real run. Parse it the way the loader does.
describe("examples/eval/hoc-jury.json", () => {
  const path = fileURLToPath(new URL("../../../../examples/eval/hoc-jury.json", import.meta.url));
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;

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
});
