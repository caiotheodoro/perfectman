import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileSceneBeats, compileSceneDrama, countCuts } from "@perfectman/hotel/drama";
import type { DramaTuning, ScenarioDrama } from "@perfectman/hotel/drama";
import { compileRunInputs, loadPresets, parseMarkdown } from "@perfectman/server/hotel";
import type { LLMConfig } from "@perfectman/server/hotel";
import type { AgentState, RelationalState } from "@perfectman/shared";
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

/** What a prior message does to the people it was said to, by the tone its author gave it (`payload.tone`, `payload.personTargets`). */
export type PriorEvent = { actorId: string; minutesAgo: number; tone: string; targets: readonly string[] };

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Turns the scene's prior messages into what the director reads: a grievance (`resentment`, `lastNegativeAt`) toward whoever said the thing, or
 * warmth. The tones are `hostile`, `accusing`, `betrayal`, `humiliating`, `tender` and `romantic`; any other tone changes nothing. `startMs` is the sim's
 * clock at the start, so `minutesAgo` becomes a time the director's window (LAD-6, 300 s) can count from.
 */
export function appraise(states: ReadonlyMap<string, AgentState>, events: readonly PriorEvent[], startMs: number): Map<string, AgentState> {
  const out = new Map([...states].map(([ref, s]) => [ref, { ...s, socialEmotions: { ...s.socialEmotions }, relationalStates: new Map([...s.relationalStates].map(([k, v]) => [k, { ...v }])) }]));
  for (const e of events) {
    const at = startMs - e.minutesAgo * 60_000;
    for (const ref of e.targets) {
      const s = out.get(ref);
      const rel = s?.relationalStates.get(e.actorId);
      if (!s || !rel || ref === e.actorId) continue;
      const move = (d: Partial<Record<keyof RelationalState, number>>): void => {
        for (const [k, v] of Object.entries(d) as Array<[keyof RelationalState, number]>) {
          const prev = rel[k];
          if (typeof prev === "number") (rel as Record<string, unknown>)[k] = k === "trust" ? Math.max(-1, Math.min(1, prev + v)) : clamp01(prev + v);
        }
      };
      switch (e.tone) {
        case "hostile":
          move({ resentment: 0.3, threat: 0.1, trust: -0.25 });
          rel.lastNegativeAt = at;
          break;
        case "accusing":
          move({ resentment: 0.25, suspicion: 0.3, trust: -0.3 });
          rel.lastNegativeAt = at;
          break;
        case "betrayal":
          move({ resentment: 0.5, threat: 0.15, trust: -0.5 });
          s.socialEmotions.humiliation = clamp01(s.socialEmotions.humiliation + 0.1);
          rel.lastNegativeAt = at;
          break;
        case "humiliating":
          move({ resentment: 0.2, trust: -0.2 });
          s.socialEmotions.humiliation = clamp01(s.socialEmotions.humiliation + 0.5);
          s.socialEmotions.shame = clamp01(s.socialEmotions.shame + 0.2);
          rel.lastNegativeAt = at;
          break;
        case "tender":
          move({ affection: 0.3, comfort: 0.2, trust: 0.15, attraction: 0.15 });
          rel.lastPositiveAt = at;
          break;
        case "romantic":
          move({ affection: 0.2, comfort: 0.1, trust: 0.1, attraction: 0.6 });
          rel.lastPositiveAt = at;
          break;
        default:
          break;
      }
    }
  }
  return out;
}

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
  if (front["drama"] !== undefined) {
    const read = compileSceneDrama(front["drama"], people, { sceneCuts: countCuts(front["beats"]) });
    if (read.errors.length > 0) throw new Error(`scene ${sceneId} has a bad drama block: ${read.errors.map((e) => `${e.path}: ${e.message}`).join("; ")}`);
    drama = read.drama;
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
    ...(beats.length > 0 ? { beats } : {}),
    ...(o.dramaOn === false ? { dramaOn: false } : {}),
    ...(o.tuning ? { tuning: o.tuning } : {}),
  };
}
