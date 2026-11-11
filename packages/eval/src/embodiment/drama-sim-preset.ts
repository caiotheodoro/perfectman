import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileBeatSheet, compileSceneBeats, compileSceneDrama, countCuts, defaultSceneDrama, settleSheetDrama } from "@perfectman/hotel/drama";
import type { DramaMode, DramaTuning, ScenarioDrama } from "@perfectman/hotel/drama";
import { appraise, compileRunInputs, loadPresets, parseMarkdown } from "@perfectman/server/hotel";
import type { PriorEvent } from "@perfectman/server/hotel";
import type { LLMConfig } from "@perfectman/server/hotel";
import { mockBeatSheet } from "@perfectman/shared";
import type { ActVerb, AgentState, BeatSheet } from "@perfectman/shared";
import type { SimConfig } from "./drama-sim.js";
import { seedState } from "./sim-states.js";

/**
 * A scene preset (examples/presets/scenes/<id>) as a sim: the scene and its cast compiled the way an upload is, each actor's feelings
 * from the cast block (`mood`, `social`, `familiarity`), the scene's `drama` block read the way the authoring service reads it, the scene's
 * `priorEvents` appraised into grievances, and the `beats` of the scene read the way the authoring service reads them (`compileSceneBeats`) for the
 * sidecar's own `BeatPlayer` to play as the scene's script.
 */

/** The drama presets this packet ships, in the order a report lists them. */
export const DRAMA_PRESETS = ["tapa-na-cara", "confronto-da-traicao", "assassinato-na-festa", "reencontro-abraco", "anuncio-do-desmaio"] as const;

export const PRESETS_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../../examples/presets");

const MOCK_LLM: LLMConfig = { providerType: "mock", modelName: "mock", maxInputTokens: 4096, maxOutputTokens: 512, temperature: 0.8, timeoutMs: 1000, retryCount: 0 };


/** The appraisal is the run's own (`applySeeds` applies it), so the sim and a live run start from the same grievances. */
export { appraise };
export type { PriorEvent };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

export type PresetSimOptions = { root?: string; seed?: number; durationMs?: number; dramaOn?: boolean; tuning?: DramaTuning };

export async function presetSimConfig(sceneId: string, o: PresetSimOptions = {}): Promise<SimConfig> {
  const lib = await loadPresets(o.root ?? PRESETS_ROOT);
  const scene = lib.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`no scene preset "${sceneId}" (have ${lib.scenes.map((s) => s.id).join(", ")})`);
  const cast = lib.casts.find((c) => c.id === scene.cast);
  if (!cast) throw new Error(`scene ${sceneId} names the cast "${scene.cast ?? ""}", which is not a preset`);
  const scenario = scene.files.find((f) => f.filename.endsWith(".scenario.md"));
  if (!scenario) throw new Error(`scene ${sceneId} has no scenario file`);
  const compiled = compileRunInputs({ kind: "markdown", personas: cast.files, scenario }, { llm: MOCK_LLM, simulationId: `sim_${sceneId}` });
  if (!compiled.ok || !compiled.config || !compiled.summary) throw new Error(`scene ${sceneId} does not compile: ${compiled.diagnostics.filter((d) => d.level === "error").map((d) => d.message).join("; ")}`);

  const front = parseMarkdown(scenario.text).frontmatter;
  const agents = compiled.config.agents;
  const refs = agents.map((a) => a.id);
  const names = new Map(compiled.summary.agents.map((a) => [a.id, a.displayName]));
  const people = refs.map((id) => ({ id, displayName: names.get(id) ?? id }));
  let drama: ScenarioDrama | undefined;
  let dramaMode: DramaMode | undefined;
  if (front["drama"] !== undefined) {
    const read = compileSceneDrama(front["drama"], people, { sceneCuts: countCuts(front["beats"]) });
    if (read.errors.length > 0) throw new Error(`scene ${sceneId} has a bad drama block: ${read.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
    drama = read.drama;
    dramaMode = read.mode;
  } else {
    // The compile's own rule for a scene that wrote no block (the authoring service's `settleDrama`): the conservative default.
    drama = defaultSceneDrama(refs);
    if (drama) dramaMode = "default";
  }
  const script = front["beats"] === undefined ? undefined : compileSceneBeats(front["beats"], people, { drama });
  if (script && script.errors.length > 0) throw new Error(`scene ${sceneId} has bad beats: ${script.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
  const beats = script?.beats ?? [];

  const startMs = 1_000_000;
  const seeded = new Map<string, AgentState>(
    agents.map((a) => {
      const base = seedState(a.id, { simulationId: `sim_${sceneId}`, mood: a.initialCoreMood, social: a.initialSocialEmotions, others: refs });
      return [a.id, { ...base, relationalStates: new Map(Object.entries(a.relationalStates ?? {}).map(([k, v]) => [k, { ...v }])) }];
    }),
  );
  const prior: PriorEvent[] = (compiled.seeds.priorEvents ?? []).flatMap((e) => {
    const payload = isRecord(e.payload) ? e.payload : {};
    const targets = Array.isArray(payload["personTargets"]) ? payload["personTargets"].filter((t): t is string => typeof t === "string") : [];
    return typeof payload["tone"] === "string" ? [{ actorId: e.actorId, minutesAgo: e.minutesAgo ?? 0, tone: payload["tone"], targets }] : [];
  });
  const states = appraise(seeded, prior, startMs);

  return {
    title: sceneId,
    seed: o.seed ?? compiled.config.simulation.seed,
    durationMs: o.durationMs ?? 240_000,
    actors: agents.map((a) => ({ ref: a.id, name: names.get(a.id) ?? a.id })),
    states,
    ...(drama ? { drama } : {}),
    ...(dramaMode ? { dramaMode } : {}),
    ...(beats.length > 0 ? { beats } : {}),
    ...(o.dramaOn === false ? { dramaOn: false } : {}),
    ...(o.tuning ? { tuning: o.tuning } : {}),
  };
}

export type SheetSimOptions = PresetSimOptions & {
  /** A sheet as a model or an author wrote it (cast names or refs). Absent: the deterministic one (`mockBeatSheet`). */
  sheet?: unknown;
  /** The mock sheet's climax verb and second. Defaults: a slap at 170 s. */
  climax?: ActVerb;
  climaxAtMs?: number;
};

/**
 * A scene preset played from a beat sheet (Contract A) in place of its `beats`: the preset's cast, feelings and grievances, the sheet's whole script. The sheet is read as the
 * authoring service reads it (names to refs, the ladder, the 20 s, the 4:00); the preset's own drama block and script are left behind (they were for another scene) and the
 * conservative default is widened just enough to cover the sheet's acts, as a compile does. Runs to 280 s by
 * default so the aftermath is on screen. Throws with the validator's rows when the sheet does not hold.
 */
export async function sheetSimConfig(sceneId: string, o: SheetSimOptions = {}): Promise<SimConfig> {
  const base = await presetSimConfig(sceneId, o);
  const people = base.actors.map((a) => ({ id: a.ref, displayName: a.name }));
  const raw = o.sheet ?? mockBeatSheet({ cast: base.actors.map((a) => ({ id: a.ref, name: a.name })), language: "pt-BR", ...(o.climax ? { climax: o.climax } : {}), ...(o.climaxAtMs ? { climaxAtMs: o.climaxAtMs } : {}) });
  // The preset's own block (and its script) belonged to its own scene: the sheet is a different script, so the scene starts from the conservative default and the sheet widens it, as a compile does.
  const def = defaultSceneDrama(base.actors.map((a) => a.ref));
  const read = compileBeatSheet(raw, people, { drama: "derive" });
  if (!read.sheet) throw new Error(`the sheet for ${sceneId} does not hold: ${read.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
  const settled = settleSheetDrama(read.sheet, def, "default");
  const { beats: _beats, drama: _drama, dramaMode: _mode, ...rest } = base;
  return {
    ...rest,
    durationMs: o.durationMs ?? 280_000,
    sheet: read.sheet as BeatSheet,
    ...(settled ? { drama: settled.drama, ...(settled.drama_mode ? { dramaMode: settled.drama_mode } : {}) } : {}),
  };
}
