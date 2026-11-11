import {
  compilePersonaMarkdown,
  compileRunInputs,
  defaultPresetsRoot,
  loadSlimKbFromEnv,
  parseMarkdown,
  draftStory,
  loadPresets,
  StoryDraftError,
} from "@perfectman/server/hotel";
import type { BeatSheet, SlimKb } from "@perfectman/shared";
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
import { compileBeatSheet, settleSheetDrama } from "./beat-sheet.js";
import { buildSheetLinks, sheetMode } from "./beat-sheet-links.js";
import { generateBeatSheet, sheetInputHashOf } from "./beat-sheet-generate.js";
import type { SheetBrief, SheetLink } from "./beat-sheet-generate.js";
import { FREE_PLAY_DRAMA, HUMAN_TARGETS_ENV, compileDramaForm, compileSceneDrama, defaultSceneDrama, withHumansFlag } from "./scenario-drama.js";
import type { DramaCompile, DramaExt, DramaMode, SceneCastMember, ScenarioDrama } from "./scenario-drama.js";
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
  /**
   * The beat sheet's director step (Contract A). On with a real provider (`PERFECTMAN_BEAT_SHEET=0` turns it off, `mock` writes the deterministic sheet); `mode` overrides the env. `model` is
   * `PERFECTMAN_BEATSHEET_MODEL` when not given. `kb` is the reference KB for the craft context (`undefined` reads `PERFECTMAN_KB_SLIM`, `null` none).
   */
  sheet?: { mode?: "off" | "mock" | "llm"; model?: string; kb?: SlimKb | null; deadlineMs?: number };
};

/** What the scene's `drama` block and `beats` leave after compile, the body's `drama_mode`, and the warnings of both. `rawSheet` is the `beat_sheet` the scene wrote, before it is read against the cast. */
type DramaPart = { drama?: ScenarioDrama | undefined; dramaMode?: DramaMode | undefined; dramaExt?: DramaExt | undefined; beats?: ScenarioBeat[] | undefined; dramaWarnings: PathMessage[]; rawSheet?: unknown };

const toRows = (diagnostics: readonly Diagnostic[], level: "error" | "warning"): PathMessage[] =>
  diagnostics
    .filter((d) => (level === "error" ? d.level === "error" : d.level !== "error"))
    .map((d) => ({ path: [d.file, d.path].filter(Boolean).join(":") || "scenario", message: d.message }));

/**
 * validate, compile, draft, autolook and presets over the server's authoring
 * pipeline (hotel-package.md 14). Pure JSON in and out; the HTTP listener is
 * `AuthoringServer`. Authoring needs no Director connection.
 */
/** Sheets this process wrote lately, by what they were written from: the hotel may compile one source more than once (preview, save, start) and a model call is money. */
const SHEET_CACHE_MS = 30 * 60_000;
const SHEET_CACHE_MAX = 32;

export class AuthoringService {
  private readonly sheetCache = new Map<string, { at: number; sheet: BeatSheet }>();

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
    return { ...this.settleDrama(result, form.beats, people), ...(form.beat_sheet !== undefined ? { rawSheet: form.beat_sheet } : {}) };
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
  private dramaPart(result: { drama?: ScenarioDrama; ext?: DramaExt; warnings: PathMessage[] } | undefined, script: { beats: ScenarioBeat[]; warnings: PathMessage[] } | undefined): DramaPart {
    return { ...(result?.drama ? { drama: result.drama } : {}), ...(result?.ext ? { dramaExt: result.ext } : {}), ...(script && script.beats.length > 0 ? { beats: script.beats } : {}), dramaWarnings: [...(result?.warnings ?? []), ...(script?.warnings ?? [])] };
  }

  private compileSource(source: string): { result: CompileResult; delays: Record<string, [number, number]>; looks: FormLooks; arrivals: Record<string, number>; stage?: ScenarioStage; sheet?: BeatSheet; sheetStale?: boolean; brief?: SheetBrief } & DramaPart {
    const { bundle, looks, arrivals, stage, drama, dramaMode, dramaExt, beats, dramaWarnings, rawSheet } = this.resolveSource(source);
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
    const part = scene ?? { drama, dramaMode, dramaExt, beats, dramaWarnings: [] };
    const sheetPart = this.settleSheet(scene?.rawSheet ?? rawSheet, result, part, source);
    const finalDrama = sheetPart.drama ?? part.drama;
    // `null` from the sheet: the block was widened to cover it, so it is no longer the default block.
    const finalMode = sheetPart.dramaMode === undefined ? part.dramaMode : (sheetPart.dramaMode ?? undefined);
    return {
      result, delays, looks, arrivals,
      dramaWarnings: [...dramaWarnings, ...part.dramaWarnings, ...sheetPart.warnings],
      ...(stage ? { stage } : {}),
      ...(finalDrama ? { drama: finalDrama } : {}),
      ...(finalMode ? { dramaMode: finalMode } : {}),
      ...(part.dramaExt ? { dramaExt: part.dramaExt } : {}),
      ...(part.beats ? { beats: part.beats } : {}),
      ...(sheetPart.sheet ? { sheet: sheetPart.sheet } : {}),
      ...(sheetPart.stale ? { sheetStale: true } : {}),
      ...(sheetPart.brief ? { brief: sheetPart.brief } : {}),
    };
  }

  /**
   * The scene's `beat_sheet`, if it wrote one (or saved one before): read against the cast and the scene's block. An error fails the compile as a script's
   * does. A sheet this service wrote (`generated_by.input_hash`) for inputs that have since changed is stale: it is dropped (`sheetStale`) and the caller writes a
   * new one; a sheet with no `generated_by` is the author's and stays, whatever else changes. A sheet that holds widens the scene's default block just enough to cover its acts.
   */
  private settleSheet(raw: unknown, result: CompileResult, part: DramaPart, source: string): { sheet?: BeatSheet; stale?: boolean; drama?: ScenarioDrama; dramaMode?: "default" | null; warnings: PathMessage[]; brief?: SheetBrief } {
    if (!result.ok || !result.summary || !result.config || result.config.agents.length < 2) return { warnings: [] };
    const brief = this.sheetBrief(result, part, source);
    if (raw === undefined || raw === null) return { warnings: [], brief };
    // `beat_sheet: "regenerate"` is the author asking for a new roll without changing the scenario.
    if (raw === "regenerate") return { stale: true, warnings: [], brief };
    if ((part.beats?.length ?? 0) > 0) throw new AuthoringError(422, "bad_scenario", "scenario did not compile", [{ path: "beat_sheet", message: "beat_sheet and beats are two scripts for the same scene: write one" }]);
    if (part.dramaMode === "off") throw new AuthoringError(422, "bad_scenario", "scenario did not compile", [{ path: "beat_sheet", message: "drama is off, so the scene has no acts to sheet" }]);
    const people = result.summary.agents.map((a) => ({ id: a.id, displayName: a.displayName }));
    const compiled = compileBeatSheet(raw, people, { drama: part.dramaMode === "default" || part.drama === undefined ? "derive" : part.drama, room: brief.room });
    const warnings = compiled.warnings.map((w) => ({ path: w.path, message: w.message }));
    if (!compiled.sheet) {
      // A sheet the model wrote that no longer holds (the rules moved on, the cast changed) is written again; the author's own is an error they can read.
      const mine = typeof raw === "object" && raw !== null && typeof (raw as { generated_by?: { input_hash?: unknown } }).generated_by?.input_hash === "string";
      if (mine) return { stale: true, warnings: [{ path: "beat_sheet", message: "beat_sheet.stale: the saved sheet no longer holds and is written again" }], brief };
      throw new AuthoringError(422, "bad_scenario", "scenario did not compile", compiled.errors);
    }
    const hash = compiled.sheet.generated_by?.input_hash;
    if (hash !== undefined && hash !== sheetInputHashOf(brief)) return { stale: true, warnings: [{ path: "beat_sheet", message: "beat_sheet.stale: the scenario changed since the sheet was written, so it is written again" }], brief };
    const settled = settleSheetDrama(compiled.sheet, part.drama, part.dramaMode === "default" ? "default" : undefined);
    return { sheet: compiled.sheet, warnings, ...(settled ? { drama: settled.drama, dramaMode: settled.drama_mode ?? null } : {}), brief };
  }

  /** What the director step is told about the scene: the compiled cast (their goals and secrets), the situation, the language, the block, and the places the builder named. */
  private sheetBrief(result: CompileResult, part: DramaPart, source: string): SheetBrief {
    const agents = result.config?.agents ?? [];
    const form = parseForm(source);
    const places = (form?.stage?.places ?? []).flatMap((p) => (typeof p === "string" ? [p] : p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string" ? [(p as { name: string }).name] : []));
    const goals = new Map((form?.cast ?? []).map((c) => [String(c?.name ?? "").trim().toLowerCase(), { goal: typeof c?.goal === "string" ? c.goal : undefined, voice: typeof c?.voice === "string" ? c.voice : undefined }]));
    return {
      title: result.config?.simulation.name ?? "",
      situation: agents[0]?.promptProfile.scenarioContext?.roomContext ?? "",
      language: agents[0]?.promptProfile.language === "en" ? "en" : "pt-BR",
      cast: agents.map((a) => {
        const own = goals.get(a.promptProfile.displayName.trim().toLowerCase());
        return { id: a.id, name: a.promptProfile.displayName, goal: own?.goal, voice: own?.voice, objective: a.promptProfile.hiddenObjective };
      }),
      drama: part.dramaMode === "default" || part.drama === undefined ? "derive" : part.drama,
      ...(places.length > 0 ? { room: { places } } : {}),
    };
  }

  /** SCN-5 for a markdown scenario's frontmatter `drama` and `beats`; the beats that cut the scene are the cuts SCN-6 asks for. Errors fail the compile, as a form's do. */
  private sceneScript(text: string, agents: readonly { id: string; displayName: string }[]): DramaPart {
    const front = parseMarkdown(text).frontmatter;
    const result = front["drama"] === undefined ? undefined : compileSceneDrama(front["drama"], agents, { sceneCuts: countCuts(front["beats"]) });
    return { ...this.settleDrama(result, front["beats"], agents), ...(front["beat_sheet"] !== undefined ? { rawSheet: front["beat_sheet"] } : {}) };
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

  /** The compiled body, with a hand-written (or saved, still current) `beat_sheet` in it; sync, so it never calls a model. */
  compile(req: { source?: unknown }): CompileResponse {
    return this.compileCore(req).response;
  }

  private compileCore(req: { source?: unknown }): { response: CompileResponse; body: ScenarioBody; brief?: SheetBrief; stale: boolean; regenerate: boolean } {
    if (typeof req.source !== "string") throw new AuthoringError(400, "bad_request", "compile needs source");
    const { result, delays, looks, arrivals, stage, drama, dramaMode, dramaExt, beats, sheet, sheetStale, brief } = this.compileSource(req.source);
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
      ...(drama ? { drama: this.withHumans(drama, dramaExt, dramaMode) } : {}),
      ...(dramaMode ? { drama_mode: dramaMode } : {}),
      ...(dramaExt || sheet ? { drama_ext: this.withSheetPressure(dramaExt, sheet) } : {}),
      ...(beats ? { beats } : {}),
      ...(sheet ? { beat_sheet: sheet } : {}),
    };
    this.checkSize(body);
    return { response: { body, schema_version: SCENARIO_BODY_VERSION }, body, ...(brief ? { brief } : {}), stale: sheetStale === true, regenerate: parseForm(req.source)?.beat_sheet === "regenerate" };
  }

  private checkSize(body: ScenarioBody): void {
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_BODY_BYTES) {
      throw new AuthoringError(422, "bad_scenario", "compiled scenario is larger than 256 KiB", [{ path: "body", message: "too large" }]);
    }
  }

  /**
   * `compile` plus the director step (Contract A): a scene of two or more actors that has no authored `beats`, is not `drama: off` and carries no current
   * `beat_sheet` gets one written by a model here, with the cost cap and the timeout of `generateBeatSheet`. It never fails the compile: a sheet that could
   * not be had leaves the body without one and with `beat_sheet_error` saying why, and the run then plays the old scene spine (`beat_sheet_fallback`).
   * Called again for a new version of the scenario, it writes a new sheet; a saved sheet written for the same inputs is kept as it is.
   */
  async compileWithSheet(req: { source?: unknown }): Promise<CompileResponse> {
    const core = this.compileCore(req);
    const { body, brief } = core;
    const mode = this.sheetMode();
    if (!brief || body.beat_sheet || mode === "off" || (body.beats?.length ?? 0) > 0 || body.drama_mode === "off") return core.response;
    // The same source compiled again within half an hour keeps the sheet it got (a new roll is `beat_sheet: "regenerate"`).
    const key = `${mode}|${this.env("PERFECTMAN_BEATSHEET_MODEL") ?? ""}|${sheetInputHashOf(brief)}`;
    const cached = core.regenerate ? undefined : this.sheetCache.get(key);
    let sheet: BeatSheet;
    if (cached && Date.now() - cached.at < SHEET_CACHE_MS) sheet = cached.sheet;
    else {
      const generated = await generateBeatSheet(brief, { links: mode === "mock" ? [] : this.sheetLinks(), mock: mode === "mock", kb: this.sheetKb(), ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}), ...(this.deps.sheet?.deadlineMs !== undefined ? { deadlineMs: this.deps.sheet.deadlineMs } : {}) });
      if (!generated.ok) {
        body.beat_sheet_error = `${generated.reason}: ${generated.detail}`.slice(0, 700);
        return { body, schema_version: SCENARIO_BODY_VERSION };
      }
      sheet = generated.sheet;
      this.sheetCache.set(key, { at: Date.now(), sheet });
      for (const [k, v] of this.sheetCache) if (this.sheetCache.size > SHEET_CACHE_MAX || Date.now() - v.at > SHEET_CACHE_MS) this.sheetCache.delete(k);
    }
    body.beat_sheet = sheet;
    body.drama_ext = this.withSheetPressure(body.drama_ext, sheet);
    // The block as the sheet reads it has no `may_target_humans`: that is written last, so "still the default block" is judged on the four keys.
    const plain = body.drama === undefined ? undefined : (({ may_target_humans: _flag, ...rest }) => rest)(body.drama);
    const settled = settleSheetDrama(sheet, plain, body.drama_mode);
    if (settled) {
      body.drama = this.withHumans(settled.drama, body.drama_ext, settled.drama_mode);
      if (settled.drama_mode) body.drama_mode = settled.drama_mode;
      else delete body.drama_mode;
    }
    this.checkSize(body);
    return { body, schema_version: SCENARIO_BODY_VERSION };
  }

  /** A sheet is a climax deadline: the ladder's pressure floor rises toward `arc.climax_at_ms` unless the author wrote a deadline of their own (`drama.pressure_floor`). */
  private withSheetPressure(ext: DramaExt | undefined, sheet: BeatSheet | undefined): DramaExt {
    if (!sheet || ext?.pressure_floor) return ext ?? {};
    return { ...(ext ?? {}), pressure_floor: { climax_at_ms: sheet.arc.climax_at_ms } };
  }

  /** The block with the hotel's `may_target_humans` written out (see `withHumansFlag`), from the scene's flag and the process's `PERFECTMAN_HUMAN_TARGETS`. */
  private withHumans(drama: ScenarioDrama, ext: DramaExt | undefined, mode: DramaMode | undefined): ScenarioDrama {
    return withHumansFlag(drama, ext, mode, { [HUMAN_TARGETS_ENV]: this.env(HUMAN_TARGETS_ENV) }) ?? drama;
  }

  private env(name: string): string | undefined {
    return (this.deps.env ?? ((n: string) => process.env[n]))(name);
  }

  private sheetMode(): "off" | "mock" | "llm" {
    return this.deps.sheet?.mode ?? sheetMode(this.deps.llm.provider, (n) => this.env(n));
  }

  private sheetKb(): SlimKb | null | undefined {
    return this.deps.sheet?.kb !== undefined ? this.deps.sheet.kb : loadSlimKbFromEnv();
  }

  /** The models the director step may call: see `buildSheetLinks`. The legacy single link reads its key from the service's own `apiKey`. */
  private sheetLinks(): SheetLink[] {
    const llm = this.deps.llm;
    const legacy = !llm.chain || llm.chain.length === 0;
    return buildSheetLinks({
      llm,
      env: (name) => (legacy && name === llm.apiKeyEnv && this.deps.apiKey ? this.deps.apiKey : this.env(name)),
      model: this.env("PERFECTMAN_BEATSHEET_MODEL") ?? this.deps.sheet?.model,
      extraBody: this.env("PERFECTMAN_BEATSHEET_EXTRA_BODY"),
      price: this.env("PERFECTMAN_BEATSHEET_PRICE"),
    });
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
