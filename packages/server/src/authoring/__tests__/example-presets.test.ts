/**
 * The disk library the runner offers must compile the way an upload does.
 * A scene names its cast; pairing them here is what the picker does before
 * `POST /api/compile` ever sees the files.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileRunInputs } from "../compile-run-inputs.js";
import type { LLMConfig } from "../../llm/llm-config.js";
import { loadPresets } from "../../http/run/presets.js";

const PRESETS_ROOT = join(__dirname, "../../../../../examples/presets");

const LLM: LLMConfig = {
  providerType: "mock",
  modelName: "mock",
  maxInputTokens: 4096,
  maxOutputTokens: 512,
  temperature: 0.8,
  timeoutMs: 1000,
  retryCount: 0,
};

describe("example presets compile when a scene is paired with its named cast", () => {
  it("loads the headline library and the polite control", async () => {
    const library = await loadPresets(PRESETS_ROOT);
    expect(library.casts.map((c) => c.id).sort()).toEqual(["studio-partners", "the-group"]);
    expect(library.scenes.map((s) => s.id).sort()).toEqual([
      "live-que-nao-cai",
      "o-print",
      "the-slice",
      "ultima-proteina",
      "ultimo-thread",
      "velorio-no-grupo",
    ]);
  });

  it("compiles every scene against the cast it names, with no errors", async () => {
    const library = await loadPresets(PRESETS_ROOT);
    expect(library.scenes.length).toBeGreaterThan(0);

    for (const scene of library.scenes) {
      expect(scene.cast, `${scene.id} has no cast`).toBeTruthy();
      const cast = library.casts.find((c) => c.id === scene.cast);
      expect(cast, `${scene.id} names missing cast "${scene.cast}"`).toBeTruthy();

      const scenarioFile = scene.files.find((f) => f.filename.endsWith(".scenario.md"));
      expect(scenarioFile, `${scene.id} has no scenario markdown`).toBeTruthy();

      const result = compileRunInputs(
        {
          kind: "markdown",
          personas: cast!.files,
          scenario: scenarioFile!,
        },
        { llm: LLM, simulationId: `sim_preset_${scene.id}` },
      );

      const errors = result.diagnostics.filter((d) => d.level === "error");
      expect(errors, `${scene.id}: ${errors.map((e) => e.message).join("; ")}`).toEqual([]);
      expect(result.ok, `${scene.id} did not compile`).toBe(true);
      expect(result.config).not.toBeNull();
    }
  });
});
