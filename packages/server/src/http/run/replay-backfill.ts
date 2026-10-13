/**
 * Older runs wrote a replay without the scene clock, the scene look or the
 * persona profiles, but their `config.json` has most of them. Serving a replay
 * fills what is missing from there, so a run from before the film existed plays
 * with its own clock and its own people. Nothing already in the replay is
 * overwritten, and nothing is invented: a field the config does not have stays
 * absent.
 */
import { isSceneProp, isSceneSetting, type SceneLook } from "@perfectman/shared";
import type { AgentProfile, SimulationReplay } from "../../html/replay-types.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const LENGTHS = ["short", "medium", "long", "rapid_fire"] as const;

function clockOf(config: Record<string, unknown>): SimulationReplay["storyClock"] {
  const c = config["storyClock"];
  if (!isRecord(c)) return undefined;
  const start = c["start"], per = c["minutesPerPulse"];
  return typeof start === "string" && /^\d{1,2}:\d{2}$/.test(start) && typeof per === "number" && per > 0 ? { start, minutesPerPulse: per } : undefined;
}

function lookOf(config: Record<string, unknown>): SceneLook | undefined {
  const look: SceneLook = {};
  if (isSceneSetting(config["setting"])) look.setting = config["setting"];
  const nested = isRecord(config["look"]) ? config["look"] : {};
  if (isSceneSetting(nested["setting"])) look.setting = nested["setting"];
  if (Array.isArray(nested["props"]) && nested["props"].every(isSceneProp)) look.props = nested["props"];
  if (Array.isArray(nested["rooms"]) && nested["rooms"].every(isSceneSetting)) look.rooms = nested["rooms"];
  return Object.keys(look).length > 0 ? look : undefined;
}

function profilesOf(config: Record<string, unknown>): Record<string, AgentProfile> {
  const out: Record<string, AgentProfile> = {};
  const agents = Array.isArray(config["agents"]) ? config["agents"] : [];
  for (const a of agents) {
    if (!isRecord(a) || typeof a["id"] !== "string") continue;
    const persona = isRecord(a["persona"]) ? a["persona"] : {};
    const profile = isRecord(a["promptProfile"]) ? a["promptProfile"] : {};
    const name = text(persona["name"]), archetype = text(persona["archetype"]);
    if (!name || !archetype) continue;
    const style = text(persona["writingStyle"]), language = text(profile["language"]);
    const length = LENGTHS.find((l) => l === profile["messageLength"]);
    out[a["id"]] = { displayName: name, archetype, ...(style ? { writingStyle: style } : {}), ...(language ? { language } : {}), ...(length ? { messageLength: length } : {}) };
  }
  return out;
}

export function backfillReplay(replay: SimulationReplay, config: unknown): SimulationReplay {
  if (!isRecord(config)) return replay;
  const profiles = profilesOf(config);
  const merged = { ...profiles, ...(replay.agentProfiles ?? {}) };
  const storyClock = replay.storyClock ?? clockOf(config);
  const look = replay.look ?? lookOf(config);
  return {
    ...replay,
    ...(Object.keys(merged).length > 0 ? { agentProfiles: merged } : {}),
    ...(storyClock ? { storyClock } : {}),
    ...(look ? { look } : {}),
  };
}
