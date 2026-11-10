import {
  compilePersonaMarkdown,
  compileRunInputs,
  defaultPresetsRoot,
  parseMarkdown,
  draftStory,
  loadPresets,
  StoryDraftError,
} from "@perfectman/server/hotel";
import type { CompileResult, Diagnostic, DraftChain, StoryDraft } from "@perfectman/server/hotel";
import { createHash, randomUUID } from "node:crypto";
import type { AutolookRequest, AutolookResponse, CompileResponse, ValidateRequest, ValidateResponse, PresetList, PathMessage } from "../director/index.js";
import type { LlmEnv } from "../config.js";
import { hashString } from "../util/stats.js";
import { linkHeaders } from "../llm/chain-config.js";
import { hostLlmConfig } from "../llm/env.js";
import { parseBundle, makeBundle } from "./source-bundle.js";
import { MAX_BODY_BYTES, SCENARIO_BODY_VERSION, parseScenarioBody, placeholderLlm } from "../run/scenario-body.js";
import type { ScenarioBody } from "../run/scenario-body.js";
import { draftToFiles } from "./draft-to-files.js";
import { compileSceneBeats, countCuts } from "./scenario-beats.js";
import type { ScenarioBeat } from "./scenario-beats.js";
import { FREE_PLAY_DRAMA, compileDramaForm, compileSceneDrama, defaultSceneDrama } from "./scenario-drama.js";
import type { DramaCompile, DramaMode, SceneCastMember, ScenarioDrama } from "./scenario-drama.js";
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
  /** Reads a chain link's key by its env var NAME; defaults to `process.env`. Tests inject it so no real variable is touched. */
  env?: (name: string) => string | undefined;
};

/** What the scene's `drama` block and `beats` leave after compile, the body's `drama_mode`, and the warnings of both. */
type DramaPart = { drama?: ScenarioDrama | undefined; dramaMode?: DramaMode | undefined; beats?: ScenarioBeat[] | undefined; dramaWarnings: PathMessage[] };

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
  private resolveSource(source: string): { bundle: ReturnType<typeof parseBundle>; looks: FormLooks; arrivals: Record<string, number>; stage?: ScenarioStage } & DramaPart {
    const form = parseForm(source);
    if (!form) return { bundle: parseBundle(source), looks: {}, arrivals: {}, dramaWarnings: [] };
    const { draft, looks } = formToDraft(form);
    const dramaPart = this.resolveDrama(form);
    try {
      return { bundle: parseBundle(makeBundle(draftToFiles(draft))), looks, arrivals: formArrivals(form), ...(formStage(form) ? { stage: formStage(form) as ScenarioStage } : {}), ...dramaPart };
    } catch (err) {
      throw new AuthoringError(422, "bad_scenario", "scenario did not compile", [{ path: "form", message: err instanceof Error ? err.message : String(err) }]);
    }
  }

  /**
   * The form's `drama` block and `beats` as the body carries them (SCN-5). Cast refs become the agent ids `person-N` that `formArrivals` uses. The
   * beats that cut the scene are the cuts SCN-6 asks of a scenario that can kill; a form without them warns `drama.no_scene_cut`.
   */
  private resolveDrama(form: NonNullable<ReturnType<typeof parseForm>>): DramaPart {
    const cast = Array.isArray(form.cast) ? form.cast : [];
    const people = cast.map((c, i) => ({ id: `person-${i + 1}`, displayName: typeof c?.name === "string" ? c.name : "" }));
    const result = form.drama === undefined ? undefined : compileDramaForm(form.drama, { names: people.map((p) => p.displayName), ids: people.map((p) => p.id) }, { sceneCuts: countCuts(form.beats) });
    return this.settleDrama(result, form.beats, people);
  }

  /**
   * The one place a scene's drama is settled, for a builder form and for a markdown scene alike. A scene that wrote no `drama` key gets the conservative
   * default (`defaultSceneDrama`: every ordered pair of its actors, up to a slap, nobody dies) and the beats are read against it; a scene that wrote
   * one keeps exactly that, `{}` and `off` included. `result` is undefined only when no `drama` key was written.
   */
  private settleDrama(result: DramaCompile | undefined, rawBeats: unknown, people: readonly SceneCastMember[]): DramaPart {
    const fallback = result === undefined ? defaultSceneDrama(people.map((p) => p.id)) : undefined;
    // A block that failed to compile has said so already: the beats are not told "no block" on top of it.
    const block = result === undefined ? fallback : (result.drama ?? FREE_PLAY_DRAMA);
    const script = rawBeats === undefined ? undefined : compileSceneBeats(rawBeats, people, { drama: block });
    const errors = [...(result?.errors ?? []), ...(script?.errors ?? [])];
    if (errors.length > 0) throw new AuthoringError(422, "bad_scenario", "scenario did not compile", errors);
    const part = this.dramaPart(result, script);
    if (fallback) return { ...part, drama: fallback, dramaMode: "default" };
    return result?.mode === "off" ? { ...part, dramaMode: "off" } : part;
  }

  /** The block and the script as the body keeps them, with the warnings of both. */
  private dramaPart(result: { drama?: ScenarioDrama; warnings: PathMessage[] } | undefined, script: { beats: ScenarioBeat[]; warnings: PathMessage[] } | undefined): DramaPart {
    return { ...(result?.drama ? { drama: result.drama } : {}), ...(script && script.beats.length > 0 ? { beats: script.beats } : {}), dramaWarnings: [...(result?.warnings ?? []), ...(script?.warnings ?? [])] };
  }

  private compileSource(source: string): { result: CompileResult; delays: Record<string, [number, number]>; looks: FormLooks; arrivals: Record<string, number>; stage?: ScenarioStage } & DramaPart {
    const { bundle, looks, arrivals, stage, drama, dramaMode, beats, dramaWarnings } = this.resolveSource(source);
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
    // A markdown scenario (a preset) carries its `drama` block and `beats` in the frontmatter, or none: it is settled here. A form was settled already.
    const scene = drama === undefined && beats === undefined && result.ok && result.summary ? this.sceneScript(bundle.scenario.text, result.summary.agents) : undefined;
    const part = scene ?? { drama, dramaMode, beats, dramaWarnings: [] };
    return { result, delays, looks, arrivals, dramaWarnings: [...dramaWarnings, ...part.dramaWarnings], ...(stage ? { stage } : {}), ...(part.drama ? { drama: part.drama } : {}), ...(part.dramaMode ? { dramaMode: part.dramaMode } : {}), ...(part.beats ? { beats: part.beats } : {}) };
  }

  /** SCN-5 for a markdown scenario's frontmatter `drama` and `beats`; the beats that cut the scene are the cuts SCN-6 asks for. Errors fail the compile, as a form's do. */
  private sceneScript(text: string, agents: readonly { id: string; displayName: string }[]): DramaPart {
    const front = parseMarkdown(text).frontmatter;
    const result = front["drama"] === undefined ? undefined : compileSceneDrama(front["drama"], agents, { sceneCuts: countCuts(front["beats"]) });
    return this.settleDrama(result, front["beats"], agents);
  }

  validate(req: ValidateRequest): ValidateResponse {
    if (req.body !== undefined && req.body !== null) {
      const parsed = parseScenarioBody(req.body);
      return parsed.ok ? { ok: true, errors: [], warnings: [] } : { ok: false, errors: parsed.errors, warnings: [] };
    }
    if (typeof req.source !== "string") throw new AuthoringError(400, "bad_request", "validate needs source or body");
    let result: CompileResult;
    let dramaWarnings: PathMessage[];
    try {
      ({ result, dramaWarnings } = this.compileSource(req.source));
    } catch (err) {
      if (err instanceof AuthoringError && err.errors) return { ok: false, errors: err.errors, warnings: [] };
      throw err;
    }
    return { ok: result.ok, errors: toRows(result.diagnostics, "error"), warnings: [...toRows(result.diagnostics, "warning"), ...dramaWarnings] };
  }

  compile(req: { source?: unknown }): CompileResponse {
    if (typeof req.source !== "string") throw new AuthoringError(400, "bad_request", "compile needs source");
    const { result, delays, looks, arrivals, stage, drama, dramaMode, beats } = this.compileSource(req.source);
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
      ...(drama ? { drama } : {}),
      ...(dramaMode ? { drama_mode: dramaMode } : {}),
      ...(beats ? { beats } : {}),
    };
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
      throw new AuthoringError(422, "bad_scenario", "compiled scenario is larger than 256 KiB", [{ path: "body", message: "too large" }]);
    }
    return { body, schema_version: SCENARIO_BODY_VERSION };
  }

  /**
   * The configured chain as the draft runs it: each link with its own key (`process.env[link.apiKeyEnv]`), the headers the chain
   * client sends it (`linkHeaders`, one fresh session id for this draft: OpenCode Go answers 400 MissingSessionID without it) and its
   * `extraBody`. A link whose variable is empty is left out and named in `skipped`. Undefined when no `PERFECTMAN_LLM_CHAIN` is set:
   * the draft then makes the one request the legacy `baseUrl` + `apiKey` describe.
   */
  private draftChain(): DraftChain | undefined {
    const chain = this.deps.llm.chain;
    if (!chain || chain.length === 0) return undefined;
    const read = this.deps.env ?? ((name: string) => process.env[name]);
    const sessionId = randomUUID();
    const links: DraftChain["links"][number][] = [];
    const skipped: string[] = [];
    for (const link of chain) {
      const apiKey = read(link.apiKeyEnv)?.trim();
      if (!apiKey) {
        skipped.push(`${link.name}: ${link.apiKeyEnv} is empty, skipped`);
        continue;
      }
      links.push({
        name: link.name,
        baseUrl: link.baseUrl,
        model: link.model,
        apiKey,
        headers: linkHeaders(link, sessionId),
        ...(link.extraBody ? { extraBody: link.extraBody } : {}),
        ...(link.timeoutMs !== undefined ? { timeoutMs: link.timeoutMs } : {}),
      });
    }
    return { links, skipped };
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
        this.draftChain(),
      );
      return { source: this.draftSource(story) };
    } catch (err) {
      if (err instanceof StoryDraftError) {
        // `detail` (each link's name and what its provider said, never a key) rides in `errors` so the operator can read it.
        throw err.status === 422
          ? new AuthoringError(400, "bad_request", err.message)
          : new AuthoringError(503, "llm_unavailable", err.message, err.detail ? [{ path: "draft", message: err.detail }] : undefined);
      }
      throw err;
    }
  }

  /**
   * The drafted story as the bundle the builder loads. A draft with a script is compiled here the way a loaded scene is: if the loader
   * refuses it, or the scene's own block would veto a beat or the scene could kill with no cut, the script is dropped and the story ships
   * without it (the compile then gives it the conservative default block, as it does any scene that writes none). `repairBeats` already made that unlikely; this is the proof, not the repair.
   */
  private draftSource(story: StoryDraft): string {
    const source = makeBundle(draftToFiles(story));
    if (!story.beats?.length) return source;
    try {
      const { result, dramaWarnings } = this.compileSource(source);
      if (result.ok && !dramaWarnings.some((w) => /drama\.(beat_vetoed|no_scene_cut)/.test(w.message))) return source;
    } catch {
      // The loader refused the script: fall through to the story without it.
    }
    const { beats: _script, ...plain } = story;
    return makeBundle(draftToFiles(plain));
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
