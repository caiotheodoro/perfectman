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
    },
  };
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
