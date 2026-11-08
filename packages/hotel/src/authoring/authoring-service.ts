import {
  compilePersonaMarkdown,
  compileRunInputs,
  defaultPresetsRoot,
  draftStory,
  loadPresets,
  StoryDraftError,
} from "@perfectman/server/hotel";
import type { CompileResult, Diagnostic } from "@perfectman/server/hotel";
import { createHash } from "node:crypto";
import type { AutolookRequest, AutolookResponse, CompileResponse, ValidateRequest, ValidateResponse, PresetList, PathMessage } from "../director/index.js";
import type { LlmEnv } from "../config.js";
import { hashString } from "../util/stats.js";
import { hostLlmConfig } from "../llm/env.js";
import { parseBundle, makeBundle } from "./source-bundle.js";
import { MAX_BODY_BYTES, SCENARIO_BODY_VERSION, parseScenarioBody, placeholderLlm } from "../run/scenario-body.js";
import type { ScenarioBody } from "../run/scenario-body.js";
import { draftToFiles } from "./draft-to-files.js";
import { formArrivals, formStage, formToDraft, parseForm } from "./scenario-form.js";
import type { FormLooks, ScenarioStage } from "./scenario-form.js";

export class AuthoringError extends Error {
  constructor(
    readonly status: 400 | 404 | 422 | 503 | 504,
    readonly code: "bad_request" | "bad_scenario" | "not_found" | "llm_unavailable" | "timeout",
    message: string,
    readonly errors?: PathMessage[],
  ) {
    super(message);
    this.name = "AuthoringError";
  }
}

export type AuthoringDeps = {
  llm: LlmEnv;
  /** The key's value, read from `PERFECTMAN_LLM_API_KEY` by the caller (never logged). */
  apiKey: string | undefined;
  presetsRoot?: string;
  fetchImpl?: typeof fetch;
};

const toRows = (diagnostics: readonly Diagnostic[], level: "error" | "warning"): PathMessage[] =>
  diagnostics
    .filter((d) => (level === "error" ? d.level === "error" : d.level !== "error"))
    .map((d) => ({ path: [d.file, d.path].filter(Boolean).join(":") || "scenario", message: d.message }));

/**
 * validate, compile, draft, autolook and presets over the server's authoring
 * pipeline (hotel-package.md 14). Pure JSON in and out; the HTTP listener is
 * `AuthoringServer`. Authoring needs no Director connection.
 */
export class AuthoringService {
  constructor(private readonly deps: AuthoringDeps) {}

  /** A builder form (JSON) becomes the file bundle with `roomFiles`; a markdown bundle is read as is. */
  private resolveSource(source: string): { bundle: ReturnType<typeof parseBundle>; looks: FormLooks; arrivals: Record<string, number>; stage?: ScenarioStage } {
    const form = parseForm(source);
    if (!form) return { bundle: parseBundle(source), looks: {}, arrivals: {} };
    const { draft, looks } = formToDraft(form);
    try {
      return { bundle: parseBundle(makeBundle(draftToFiles(draft))), looks, arrivals: formArrivals(form), ...(formStage(form) ? { stage: formStage(form) as ScenarioStage } : {}) };
    } catch (err) {
      throw new AuthoringError(422, "bad_scenario", "scenario did not compile", [{ path: "form", message: err instanceof Error ? err.message : String(err) }]);
    }
  }

  private compileSource(source: string): { result: CompileResult; delays: Record<string, [number, number]>; looks: FormLooks; arrivals: Record<string, number>; stage?: ScenarioStage } {
    const { bundle, looks, arrivals, stage } = this.resolveSource(source);
    if (!bundle.scenario) throw new AuthoringError(400, "bad_request", "source has no scenario file");
    const result = compileRunInputs(
      { kind: "markdown", scenario: bundle.scenario, personas: bundle.personas },
      { llm: placeholderLlm(), simulationId: "preview" },
    );
    const delays: Record<string, [number, number]> = {};
    if (result.ok && result.summary) {
      const byFile = new Map(bundle.personas.map((p) => [p.filename, p]));
      for (const a of result.summary.agents) {
        const file = byFile.get(a.personaFile);
        const pack = file ? compilePersonaMarkdown(file.text, file.filename).pack : null;
        const range = pack?.presenceProfile.responseDelayMs;
        if (range) delays[a.id] = [range[0], range[1]];
      }
    }
    return { result, delays, looks, arrivals, ...(stage ? { stage } : {}) };
  }

  validate(req: ValidateRequest): ValidateResponse {
    if (req.body !== undefined && req.body !== null) {
      const parsed = parseScenarioBody(req.body);
      return parsed.ok ? { ok: true, errors: [], warnings: [] } : { ok: false, errors: parsed.errors, warnings: [] };
    }
    if (typeof req.source !== "string") throw new AuthoringError(400, "bad_request", "validate needs source or body");
    let result: CompileResult;
    try {
      ({ result } = this.compileSource(req.source));
    } catch (err) {
      if (err instanceof AuthoringError && err.errors) return { ok: false, errors: err.errors, warnings: [] };
      throw err;
    }
    return { ok: result.ok, errors: toRows(result.diagnostics, "error"), warnings: toRows(result.diagnostics, "warning") };
  }

  compile(req: { source?: unknown }): CompileResponse {
    if (typeof req.source !== "string") throw new AuthoringError(400, "bad_request", "compile needs source");
    const { result, delays, looks, arrivals, stage } = this.compileSource(req.source);
    if (!result.ok || !result.config || !result.summary) {
      throw new AuthoringError(422, "bad_scenario", "scenario did not compile", toRows(result.diagnostics, "error"));
    }
    const body: ScenarioBody = {
      v: SCENARIO_BODY_VERSION,
      title: result.config.simulation.name,
      config: result.config,
      seeds: result.seeds,
      maxPulses: result.summary.maxPulses,
      ...(Object.keys(delays).length > 0 ? { responseDelays: delays } : {}),
      ...(Object.keys(looks).length > 0 ? { looks } : {}),
      ...(Object.keys(arrivals).length > 0 ? { arrivals } : {}),
      ...(stage ? { stage } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
      throw new AuthoringError(422, "bad_scenario", "compiled scenario is larger than 256 KiB", [{ path: "body", message: "too large" }]);
    }
    return { body, schema_version: SCENARIO_BODY_VERSION };
  }

  async draft(req: { brief?: unknown; language?: unknown; cast_size?: unknown }): Promise<{ source: string }> {
    if (typeof req.brief !== "string" || req.brief.trim().length < 8) {
      throw new AuthoringError(400, "bad_request", "brief needs a sentence or two");
    }
    const cast = typeof req.cast_size === "number" ? req.cast_size : undefined;
    const draftLanguage: "en" | "pt-BR" = req.language === "en" ? "en" : "pt-BR";
    if (this.deps.llm.provider === "mock") {
      return { source: makeBundle(draftToFiles(mockStory(req.brief, draftLanguage))) };
    }
    try {
      const story = await draftStory(
        {
          idea: req.brief,
          ...(cast !== undefined ? { people: cast } : {}),
          // The builder is pt-BR first (owner, 2026-11-07): a draft is Portuguese unless the caller asks for English.
          language: draftLanguage,
          llm: {
            providerType: "openai-compatible",
            baseUrl: this.deps.llm.baseUrl,
            modelName: hostLlmConfig(this.deps.llm).modelName,
            ...(this.deps.apiKey ? { apiKey: this.deps.apiKey } : {}),
          },
        },
        this.deps.fetchImpl,
      );
      return { source: makeBundle(draftToFiles(story)) };
    } catch (err) {
      if (err instanceof StoryDraftError) {
        throw err.status === 422 ? new AuthoringError(400, "bad_request", err.message) : new AuthoringError(503, "llm_unavailable", err.message);
      }
      throw err;
    }
  }

  /** Deterministic for now (hash of name and traits over the hotel's catalog); an LLM pass is Phase 3. */
  autolook(req: AutolookRequest): AutolookResponse {
    if (!Array.isArray(req.catalog) || req.catalog.length === 0) throw new AuthoringError(400, "bad_request", "autolook needs a catalog");
    return {
      looks: req.characters.map((c) => ({
        name: c.name,
        figure: req.catalog[hashString(`${c.name}|${c.traits}`) % req.catalog.length] ?? "",
      })),
    };
  }

  /**
   * The ready-made scenes the builder offers. Only the ones written in Portuguese are listed: the builder is
   * pt-BR (owner, 2026-11-07), so an English scene is not surfaced. The language is the scene file's own `language:`.
   */
  async presets(): Promise<PresetList> {
    const lib = await loadPresets(this.deps.presetsRoot ?? defaultPresetsRoot());
    const portuguese = lib.scenes.filter((s) => s.files.some((f) => f.filename.endsWith(".scenario.md") && /^language:\s*["']?pt-BR/m.test(f.text)));
    return { presets: portuguese.map((s) => ({ key: s.id, title: s.title, language: "pt-BR" as const, mode: "default" as const })) };
  }

  async preset(key: string): Promise<{ source: string }> {
    const lib = await loadPresets(this.deps.presetsRoot ?? defaultPresetsRoot());
    const scene = lib.scenes.find((s) => s.id === key);
    if (!scene) throw new AuthoringError(404, "not_found", `no preset "${key}"`);
    const cast = scene.cast ? lib.casts.find((c) => c.id === scene.cast) : undefined;
    return { source: makeBundle([...scene.files, ...(cast?.files ?? [])]) };
  }
}

/** sha256 of a compiled body, for the replay manifest. */
export function bodyDigest(body: unknown): string {
  return createHash("sha256").update(typeof body === "string" ? body : JSON.stringify(body)).digest("hex");
}

function mockStory(brief: string, language: "en" | "pt-BR") {
  const names = language === "pt-BR" ? ["Duda", "Rafa", "Gabi"] : ["Alex", "Sam", "Robin"];
  return {
    title: brief.slice(0, 60),
    situation: brief,
    language,
    people: [
      { name: names[0] ?? "A", role: "connector" as const, goal: "Keep the peace.", voice: "", lines: [] as string[] },
      { name: names[1] ?? "B", role: "skeptic" as const, goal: "Get a straight answer.", voice: "", lines: [] as string[] },
      { name: names[2] ?? "C", role: "performer" as const, goal: "Be the center of attention.", voice: "", lines: [] as string[] },
    ],
  };
}
