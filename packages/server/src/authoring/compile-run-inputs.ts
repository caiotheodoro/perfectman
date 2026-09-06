/**
 * Façade over the compilers: uploaded files → a validated config plus seeds.
 *
 * This is what `POST /api/compile` calls, and it is deliberately side-effect
 * free — the preview panel runs it on every change, and starting a run runs it
 * again. Nothing here touches the filesystem or the network.
 */
import { parseSimulationConfig } from "../config/simulation-config.js";
import type { SimulationAppConfig } from "../config/simulation-config.js";
import type { LLMConfig } from "../llm/llm-config.js";
import { assembleSimulationConfig, type RunSeeds } from "./assemble-config.js";
import { DiagnosticBag, blocksRun, type Diagnostic } from "./diagnostics.js";
import { compilePersonaMarkdown, type CompiledPersona } from "./persona-md-compiler.js";
import { compileScenarioMarkdown } from "./scenario-md-compiler.js";

export type UploadedFile = { filename: string; text: string };

export type RunInputs =
  | {
      kind: "markdown";
      personas: UploadedFile[];
      scenario: UploadedFile;
      /** Per-persona-file language override from the UI. */
      languageOverrides?: Record<string, string>;
    }
  | {
      /** Escape hatch: a config the compilers never touch. */
      kind: "raw-json";
      config: unknown;
      seeds?: Partial<RunSeeds>;
    };

export type CompileSummary = {
  agents: Array<{ id: string; displayName: string; archetype: string; personaFile: string }>;
  channels: Array<{ id: string; name: string; type: string; members: string[] }>;
  maxPulses: number;
  seed: number;
  /** Per persona file, so the UI can show the detected value with an override. */
  languages: Record<string, { language: string; confidence: number; source: string }>;
};

export type CompileResult = {
  ok: boolean;
  config: SimulationAppConfig | null;
  seeds: RunSeeds;
  diagnostics: Diagnostic[];
  summary: CompileSummary | null;
};

const EMPTY_SEEDS: RunSeeds = { memoriesByAgent: {}, priorEvents: [] };
const DEFAULT_RAW_JSON_MAX_PULSES = 24;

export function compileRunInputs(
  inputs: RunInputs,
  context: { llm: LLMConfig; simulationId: string },
): CompileResult {
  return inputs.kind === "raw-json"
    ? compileRawJson(inputs, context.simulationId)
    : compileMarkdown(inputs, context);
}

function compileMarkdown(
  inputs: Extract<RunInputs, { kind: "markdown" }>,
  context: { llm: LLMConfig; simulationId: string },
): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const personas = new Map<string, CompiledPersona>();
  const languages: CompileSummary["languages"] = {};

  for (const file of inputs.personas) {
    const compiled = compilePersonaMarkdown(file.text, file.filename, {
      ...(inputs.languageOverrides?.[file.filename]
        ? { languageOverride: inputs.languageOverrides[file.filename] }
        : {}),
    });
    diagnostics.push(...compiled.diagnostics);
    // Reachable by filename and by the persona id inside it, so a scenario can
    // name either without the author having to think about which.
    personas.set(file.filename, compiled);
    if (compiled.pack) {
      personas.set(compiled.pack.personaId, compiled);
      languages[file.filename] = {
        language: compiled.pack.language,
        confidence: compiled.language?.confidence ?? 1,
        source: compiled.language?.source ?? "frontmatter",
      };
    }
  }

  const { scenario, diagnostics: scenarioDiagnostics } = compileScenarioMarkdown(
    inputs.scenario.text,
    inputs.scenario.filename,
  );
  diagnostics.push(...scenarioDiagnostics);

  if (!scenario || blocksRun(diagnostics)) {
    return { ok: false, config: null, seeds: EMPTY_SEEDS, diagnostics, summary: null };
  }

  const assembled = assembleSimulationConfig({
    scenario,
    personas,
    llm: context.llm,
    simulationId: context.simulationId,
  });
  diagnostics.push(...assembled.diagnostics);

  const validated = validate(assembled.config, diagnostics, new DiagnosticBag("<config>"));

  return {
    ok: validated !== null && !blocksRun(diagnostics),
    config: validated,
    seeds: assembled.seeds,
    diagnostics,
    summary: validated ? summarize(validated, scenario.maxPulses, languages) : null,
  };
}

function compileRawJson(
  inputs: Extract<RunInputs, { kind: "raw-json" }>,
  simulationId: string,
): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const bag = new DiagnosticBag("<raw-json>");
  const validated = validate(inputs.config, diagnostics, bag);
  if (!validated) {
    return { ok: false, config: null, seeds: EMPTY_SEEDS, diagnostics, summary: null };
  }

  // A raw config may pin an id; a run always gets a fresh one, because the
  // LLM budget singleton is keyed by simulation id and reset on every build.
  const config: SimulationAppConfig = {
    ...validated,
    simulation: { ...validated.simulation, id: simulationId },
  };
  const seeds: RunSeeds = {
    memoriesByAgent: inputs.seeds?.memoriesByAgent ?? {},
    priorEvents: inputs.seeds?.priorEvents ?? [],
  };

  return {
    ok: true,
    config,
    seeds,
    diagnostics,
    summary: summarize(config, DEFAULT_RAW_JSON_MAX_PULSES, {}),
  };
}

/** Runs the real validator and turns its throw into a diagnostic. */
function validate(
  candidate: unknown,
  diagnostics: Diagnostic[],
  bag: DiagnosticBag,
): SimulationAppConfig | null {
  if (candidate === null || candidate === undefined) return null;
  try {
    // Gateways are injected as instances by the run controller, so a web config
    // legitimately names none.
    return parseSimulationConfig(candidate, { allowNoGateways: true });
  } catch (err) {
    bag.error(`Config rejected by the validator: ${(err as Error).message}`, {
      hint: "This is the same validation a `config/index.json` goes through, so the message names the offending field.",
    });
    diagnostics.push(...bag.all);
    return null;
  }
}

function summarize(
  config: SimulationAppConfig,
  maxPulses: number,
  languages: CompileSummary["languages"],
): CompileSummary {
  return {
    agents: config.agents.map((a) => ({
      id: a.id,
      displayName: a.promptProfile.displayName,
      archetype: a.persona.archetype,
      personaFile: a.persona.id,
    })),
    channels: config.channels.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      members: c.memberAgentIds,
    })),
    maxPulses,
    seed: config.simulation.seed,
    languages,
  };
}
