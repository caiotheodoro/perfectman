/**
 * The façade `POST /api/compile` calls, checked at the seam the preview panel
 * actually reads: the summary.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileRunInputs, type RunInputs } from "../compile-run-inputs.js";
import type { LLMConfig } from "../../llm/llm-config.js";

const FIXTURES = join(__dirname, "fixtures");
const SCENARIO = readFileSync(join(FIXTURES, "dinner.scenario.md"), "utf8");
const IRIS = readFileSync(join(FIXTURES, "iris.persona.md"), "utf8");

const LLM: LLMConfig = {
  providerType: "mock",
  modelName: "mock",
  maxInputTokens: 4096,
  maxOutputTokens: 512,
  temperature: 0.8,
  timeoutMs: 1000,
  retryCount: 0,
};

/** The fixture's cast names `bruno` for two members, by pack id rather than filename. */
const BRUNO = IRIS.replace("personaId: iris", "personaId: bruno").replace(
  "displayName: Íris",
  "displayName: Bruno",
);

function markdown(): RunInputs {
  return {
    kind: "markdown",
    personas: [
      { filename: "iris.persona.md", text: IRIS },
      { filename: "bruno.persona.md", text: BRUNO },
    ],
    scenario: { filename: "dinner.scenario.md", text: SCENARIO },
  };
}

function compile(inputs: RunInputs = markdown()) {
  return compileRunInputs(inputs, { llm: LLM, simulationId: "sim_test" });
}

describe("compileRunInputs — the summary the preview panel reads", () => {
  it("names the uploaded file an agent came from, not its calibration source", () => {
    // `persona.id` is the canonical persona the 19 engine fields were inherited
    // from — usually a name the author never typed. Reporting it as the source
    // file also breaks the language lookup, which is keyed by filename.
    const { summary } = compile();
    const iris = summary?.agents.find((a) => a.id === "iris");
    expect(iris?.personaFile).toBe("iris.persona.md");
    expect(iris?.calibrationFrom).not.toBe("iris.persona.md");
  });

  it("resolves a cast member that names a persona by pack id", () => {
    const { summary } = compile();
    expect(summary?.agents.find((a) => a.id === "bruno")?.personaFile).toBe("bruno.persona.md");
  });

  it("keys the language table by the same filename the agents point at", () => {
    const { summary } = compile();
    const looked = (summary?.agents ?? []).map((a) => summary?.languages[a.personaFile]?.language);
    expect(looked).toEqual(["pt-BR", "pt-BR", "pt-BR"]);
  });

  it("reports the detected language and where it came from", () => {
    const { summary } = compile();
    expect(summary?.languages["iris.persona.md"]).toMatchObject({
      language: "pt-BR",
      source: "frontmatter",
    });
  });

  it("returns no summary and no config when the scenario does not compile", () => {
    const result = compile({
      kind: "markdown",
      personas: [],
      scenario: { filename: "broken.md", text: "---\nname: x\n---\n" },
    });
    expect(result.ok).toBe(false);
    expect(result.config).toBeNull();
    expect(result.summary).toBeNull();
    expect(result.diagnostics.some((d) => d.level === "error")).toBe(true);
  });

  it("gives a raw-JSON config a fresh simulation id", () => {
    // The LLM budget singleton is keyed by simulation id, so a pinned id from a
    // pasted config would corrupt accounting for the next run.
    const built = compile();
    const result = compile({
      kind: "raw-json",
      config: { ...built.config, simulation: { ...built.config?.simulation, id: "local-dev" } },
    });
    expect(result.ok).toBe(true);
    expect(result.config?.simulation.id).toBe("sim_test");
  });
});
