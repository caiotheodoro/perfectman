import { cleanBeats } from "../authoring/scenario-beats.js";
import type { ScenarioBeat } from "../authoring/scenario-beats.js";
import { DRAMA_OFF, cleanDrama, cleanDramaExt, defaultSceneDrama, isDramaOff } from "../authoring/scenario-drama.js";
import type { DramaExt } from "../authoring/scenario-drama.js";
import type { DramaMode, ScenarioDrama } from "../authoring/scenario-drama.js";
import { cleanVisit } from "../authoring/scenario-form.js";
import type { ScenarioStage } from "../authoring/scenario-form.js";
import { parseSimulationConfig } from "@perfectman/server/hotel";
import type { RunSeeds, SimulationAppConfig } from "@perfectman/server/hotel";
import type { LLMConfig } from "@perfectman/server/hotel";

export const SCENARIO_BODY_VERSION = 1;
/** Placeholder the compiler writes; replaced by the host's config at run start (D16). */
export const HOST_MODEL_PLACEHOLDER = "__host__";
export const MAX_BODY_BYTES = 256 * 1024;

/** The compiled scenario stored in `scenario_versions.body`. */
export type ScenarioBody = {
  v: typeof SCENARIO_BODY_VERSION;
  title: string;
  config: SimulationAppConfig;
  seeds: RunSeeds;
  maxPulses: number;
  /** Per agent: outfit chosen by autolook or the author. Absent means the hotel's procedural look. */
  looks?: Record<string, { figure: string; effect?: string }>;
  /** Per agent: the persona's `presenceProfile.responseDelayMs`, for typing and landing time. */
  responseDelays?: Record<string, [number, number]>;
  /** Per agent: ms after the run starts that the builder's "after N s" entrance asks for. Absent means the run's natural stagger. */
  arrivals?: Record<string, number>;
  /** Where the builder's stage step lets the cast go. Absent means every room the hotel names (older scenarios, presets). */
  stage?: ScenarioStage;
  /** The drama block (act-contract.md section 7), refs as agent ids. Absent is free play (a body saved before the default existed). Additive and optional, so the body version stays 1. */
  drama?: ScenarioDrama;
  /**
   * Where `drama` came from when the author did not write it: `default` (the conservative block the compile derives for a scene of two or more actors
   * that declares none) or `off` (`drama: off`). Absent is a block the author wrote. The hotel never reads it (it ignores unknown keys and enforces
   * `drama`); the sidecar reads it for the run summary and, for `off`, to start no act at all.
   */
  drama_mode?: DramaMode;
  /**
   * What the sidecar reads beside the block and the hotel never sees (`DramaExt`): whether a human can be the target of an act without the consent chip (`may_target_humans`, default true) and
   * the scene's climax deadline for the ladder's pressure floor (`pressure_floor`). Additive and optional; the hotel reads `drama` strictly, so these cannot ride inside it.
   */
  drama_ext?: DramaExt;
  /** The scene's script (errata P4-01): authored acts and scene cuts the sidecar plays on the run's clock. Absent is no script. Additive and optional like `drama`, and the hotel never reads it. */
  beats?: ScenarioBeat[];
};

export type ParsedBody = { ok: true; body: ScenarioBody } | { ok: false; errors: { path: string; message: string }[] };

export function placeholderLlm(): LLMConfig {
  return {
    providerType: "mock",
    modelName: HOST_MODEL_PLACEHOLDER,
    maxInputTokens: 4096,
    maxOutputTokens: 512,
    temperature: 0.8,
    timeoutMs: 20_000,
    retryCount: 1,
  };
}

/** Accepts the object or its JSON text (the hotel stores `body TEXT`). */
export function parseScenarioBody(raw: unknown): ParsedBody {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (err) {
      return fail("", `body is not valid JSON: ${(err as Error).message}`);
    }
  }
  if (value === null || typeof value !== "object") return fail("", "body must be an object");
  const o = value as Record<string, unknown>;
  if (o["v"] !== SCENARIO_BODY_VERSION) return fail("v", `unsupported body version ${String(o["v"])}`);
  let config: SimulationAppConfig;
  try {
    config = parseSimulationConfig(o["config"], { allowNoGateways: true });
  } catch (err) {
    return fail("config", (err as Error).message);
  }
  const seeds = (o["seeds"] ?? { memoriesByAgent: {}, priorEvents: [] }) as RunSeeds;
  if (config.agents.length === 0) return fail("config.agents", "a scenario needs at least one character");
  return {
    ok: true,
    body: {
      v: SCENARIO_BODY_VERSION,
      title: typeof o["title"] === "string" ? o["title"] : config.simulation.name,
      config,
      seeds,
      maxPulses: typeof o["maxPulses"] === "number" ? o["maxPulses"] : 24,
      ...(o["looks"] ? { looks: o["looks"] as ScenarioBody["looks"] & object } : {}),
      ...(o["responseDelays"] ? { responseDelays: o["responseDelays"] as ScenarioBody["responseDelays"] & object } : {}),
      ...(o["arrivals"] && typeof o["arrivals"] === "object" ? { arrivals: cleanArrivals(o["arrivals"] as Record<string, unknown>) } : {}),
      ...cleanStage(o["stage"]),
      ...cleanDramaAndMode(o, config.agents.map((a) => a.id)),
      ...(cleanDramaExt(o["drama_ext"]) ? { drama_ext: cleanDramaExt(o["drama_ext"]) as DramaExt } : {}),
      ...cleanBeats(o["beats"], config.agents.map((a) => a.id)),
    },
  };
}

/**
 * `drama` and its `drama_mode`. `off` (the mode, or the word as the block) always reads as the off block: a body that says off is never read
 * looser. `default` is kept only while the block that survived the strict read is the one `defaultSceneDrama` derives for this cast, so a mode never
 * outlives its block and the run summary never calls an edited block the default.
 */
function cleanDramaAndMode(o: Record<string, unknown>, agentIds: readonly string[]): { drama?: ScenarioDrama; drama_mode?: DramaMode } {
  if (o["drama_mode"] === "off" || isDramaOff(o["drama"])) return { drama: DRAMA_OFF, drama_mode: "off" };
  const { drama } = cleanDrama(o["drama"], agentIds);
  const isDefault = o["drama_mode"] === "default" && drama !== undefined && JSON.stringify(drama) === JSON.stringify(defaultSceneDrama(agentIds));
  return drama === undefined ? {} : { drama, ...(isDefault ? { drama_mode: "default" as const } : {}) };
}

/** Finite, non-negative ms only; a bad entry is dropped, never a reason to refuse the scenario. */
function cleanArrivals(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, ms] of Object.entries(raw)) if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) out[id] = Math.min(ms, 600_000);
  return out;
}

function cleanStage(raw: unknown): { stage?: ScenarioStage } {
  if (!raw || typeof raw !== "object") return {};
  const o = raw as Record<string, unknown>;
  if (typeof o["travel"] !== "boolean") return {};
  return { stage: { travel: o["travel"], rooms: o["travel"] && Array.isArray(o["rooms"]) ? cleanVisit(o["rooms"]) : [] } };
}

function fail(path: string, message: string): ParsedBody {
  return { ok: false, errors: [{ path, message }] };
}
