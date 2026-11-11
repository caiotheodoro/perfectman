import type { ActVerb } from "@perfectman/shared";
import { ladderRung } from "@perfectman/shared";
import type { EmotionReading, RelationReading } from "./ports.js";
import type { Driver, DramaTuning } from "./tuning.js";

/** The emotion state read as ladder pressure (verb-bible 4.3 and 4.5): a volition, a threshold, a grievance. */

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

function read(driver: Driver, emotion: EmotionReading, relation: RelationReading | undefined): number {
  const [layer, field] = driver.source.split(".") as [string, string];
  const raw =
    layer === "act" ? (emotion.actionEmotions as Record<string, number | undefined>)[field]
    : layer === "social" ? (emotion.social as Record<string, number | undefined> | undefined)?.[field]
    : (relation as Record<string, number | null | undefined> | undefined)?.[field];
  return typeof raw === "number" ? clamp01(raw) * driver.weight : 0;
}

/** The slap: no unlock opens a rung above it (errata P8). The punch and the kill stay the model's or the author's. */
export const UNLOCK_MAX_RUNG = 4;

/** True when the scene spine has opened `verb`'s rung toward this person (errata P8). Off-ladder verbs are never opened. */
function unlockedFor(verb: ActVerb, relation: RelationReading | undefined): boolean {
  const rung = ladderRung(verb);
  return rung !== undefined && relation?.unlocked !== undefined && rung <= Math.min(relation.unlocked, UNLOCK_MAX_RUNG);
}

/**
 * `v`: the max over the verb's drivers, each in [0, 1], the `rel.*` ones read toward the target (4.5). A verb with no driver has `v = 0`. A rung the scene spine opened
 * toward this person (errata P8) reads `provocation.unlock.volition`: the slap has no driver the cast's talk can reach, so this is how a heated pair gets to it.
 */
export function volition(verb: ActVerb, emotion: EmotionReading, relation: RelationReading | undefined, tuning: DramaTuning, floor = 0): number {
  const drivers = tuning.drivers[verb] ?? [];
  let v = 0;
  for (const driver of drivers) v = Math.max(v, read(driver, emotion, relation));
  if (unlockedFor(verb, relation)) v = Math.max(v, tuning.provocation.unlock.volition);
  if (floorReaches(verb, relation, floor, tuning)) v = Math.max(v, floor);
  return clamp01(v);
}

/**
 * The scene's pressure floor at `ageMs` into the scene (`DramaTuning.pressure`): 0 until `startFrac` of the climax deadline, then linear to `max` at the deadline and past it.
 * `climaxAtMs` undefined (free play, or a scene with no deadline) is always 0.
 */
export function pressureFloor(ageMs: number, climaxAtMs: number | undefined, tuning: DramaTuning, max?: number): number {
  if (climaxAtMs === undefined || !(climaxAtMs > 0)) return 0;
  const f = tuning.pressure.floor;
  const u = (ageMs / climaxAtMs - f.startFrac) / (1 - f.startFrac);
  return clamp01(u) * Math.min(f.max, max ?? f.max);
}

/** The pair has heat: something was said, the spine opened a rung, or the actor holds a resentment of at least `pressure.floor.heat`. Without heat the floor reaches nobody. */
function heated(relation: RelationReading | undefined, tuning: DramaTuning): boolean {
  return relation !== undefined && ((relation.provocation ?? 0) > 0 || (relation.unlocked ?? 0) > 0 || relation.resentment >= tuning.pressure.floor.heat);
}

function floorReaches(verb: ActVerb, relation: RelationReading | undefined, floor: number, tuning: DramaTuning): boolean {
  const rung = ladderRung(verb);
  return floor > 0 && rung !== undefined && rung <= tuning.pressure.floor.maxRung && heated(relation, tuning);
}

/**
 * `theta(rung)` with the two modifiers: `strategicPatience` raises it by up to `patienceBoost`, and arousal momentum
 * moves it the other way (rising lowers it). Off-ladder verbs have no rung and no threshold.
 */
export function theta(verb: ActVerb, emotion: EmotionReading, tuning: DramaTuning): number | undefined {
  const rung = ladderRung(verb);
  if (rung === undefined) return undefined;
  const base = tuning.theta[rung as 1 | 2 | 3 | 4 | 5 | 6];
  const patience = clamp01(emotion.actionEmotions.strategicPatience) * tuning.patienceBoost;
  const momentum = Math.min(1, Math.max(-1, emotion.core?.momentumArousal ?? 0));
  return Math.min(1, Math.max(0, base + patience - tuning.momentumGain * momentum));
}

/** Rungs from `grievance.minRung` up need `rel.resentment >= 0.5` or a negative event inside the window (4.5). */
export function hasGrievance(verb: ActVerb, relation: RelationReading | undefined, now: number, tuning: DramaTuning, floor = 0): boolean {
  const rung = ladderRung(verb);
  if (rung === undefined || rung < tuning.grievance.minRung) return true;
  if (!relation) return false;
  // Late in a scene with a climax deadline the floor stands in for the grievance of a pair with heat (it never opens a rung above the slap, nor a pair with none).
  if (floor >= tuning.pressure.floor.grievanceAt && floorReaches(verb, relation, floor, tuning)) return true;
  // What was said to the actor opens the grievance for the first rungs only (insult, shove): a slap and above still need a real resentment (errata P7).
  if ((relation.provocation ?? 0) >= tuning.provocation.grievanceAt && rung <= tuning.provocation.maxRung) return true;
  if (unlockedFor(verb, relation)) return true;
  if (relation.resentment >= tuning.grievance.resentment) return true;
  return relation.lastNegativeAt !== null && relation.lastNegativeAt !== undefined && now - relation.lastNegativeAt <= tuning.grievance.windowMs;
}

export type Motive = { ok: true; v: number; theta: number } | { ok: false; v: number; theta: number; why: "volition" | "grievance" };

/** LAD-6 for one verb toward one target. Off-ladder verbs have no motive gate and always pass (`v` and `theta` 0). */
export function motive(verb: ActVerb, emotion: EmotionReading, relation: RelationReading | undefined, now: number, tuning: DramaTuning, floor = 0): Motive {
  const t = theta(verb, emotion, tuning);
  if (t === undefined) return { ok: true, v: 0, theta: 0 };
  const v = volition(verb, emotion, relation, tuning, floor);
  if (v < t) return { ok: false, v, theta: t, why: "volition" };
  if (!hasGrievance(verb, relation, now, tuning, floor)) return { ok: false, v, theta: t, why: "grievance" };
  return { ok: true, v, theta: t };
}

/** `core.arousal` is the intensity of an act (verb-bible 4.4); two decimals, absent when the reading has none. */
export function intensityOf(emotion: EmotionReading | undefined): number | undefined {
  const a = emotion?.core?.arousal;
  return typeof a === "number" && Number.isFinite(a) ? Math.round(clamp01(a) * 100) / 100 : undefined;
}
