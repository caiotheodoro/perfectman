/**
 * Drama probes: deterministic checks over `DramaEvent[]` (see `drama/events.ts`), no LLM.
 *
 * Each probe is a pure function of a `DramaProbeInput` and returns its measured value plus the
 * evidence behind it (offending act ids, counts), so a human or a judge can trace a verdict to
 * events. Bands live in `PROBE_BANDS` (calibration-pending seeds, like every band there) and
 * `runDramaProbes` wraps the readings in the same `ProbeResult` shape the other probes use.
 *
 * Time is run-relative milliseconds, as `DramaEvent.atMs` is. A scene is a room.
 */
import type { ActStartedEvent, DramaEvent } from "../drama/index.js";

export type DramaProbeInput = {
  /** In time order (as `extractDramaEvents` returns them). */
  events: readonly DramaEvent[];
  /** Actor refs; humans are not judged. */
  actorIds: readonly string[];
  /** Length of the run in ms. Default: the span of the events. */
  durationMs?: number;
};

const MINUTE_MS = 60_000;
/** A scene shorter than this counts as this long, so one act in a quiet scene is not extrapolated to dozens a minute. */
const MIN_SCENE_MS = MINUTE_MS;
const MIN_ACTS_FOR_DIVERSITY = 5;
/** Gestures that are the body at rest, not a body act (the baseline leaves them out too). */
const REST_GESTURES = new Set(["stand", "idle", "stop"]);

const ratio = (n: number, d: number): number => (d === 0 ? 0 : n / d);
const sceneOf = (e: { room?: string }): string => e.room ?? "";

const spanMs = (events: readonly DramaEvent[]): number => {
  if (events.length === 0) return 0;
  const times = events.map((e) => e.atMs);
  return Math.max(...times) - Math.min(...times);
};

/** Each act once, in the order its start was first logged. */
function actsOf(events: readonly DramaEvent[]): ActStartedEvent[] {
  const seen = new Set<string>();
  const acts: ActStartedEvent[] = [];
  for (const e of events) {
    if (e.kind !== "act_started" || seen.has(e.actId)) continue;
    seen.add(e.actId);
    acts.push(e);
  }
  return acts;
}

// ── body-act-rate ────────────────────────────────────────────────────────────

export type BodyActRateReading = { measured: number; bodyActs: number; actorMinutes: number };

/**
 * Body acts (gestures, expressions, pairs, appearance changes) per actor-minute. Informational: read
 * before/after against the baseline aggregate (`bodyActsPerActorMinute`), which credits every actor
 * the whole run and leaves out standing, idling and stopping.
 */
export function bodyActRate(input: DramaProbeInput): BodyActRateReading {
  const actors = new Set(input.actorIds);
  let bodyActs = 0;
  for (const e of input.events) {
    if (e.kind !== "body_act" || e.act === "pair_reaction" || !actors.has(e.actor)) continue;
    if (e.act === "gesture" && REST_GESTURES.has(e.name)) continue;
    bodyActs += 1;
  }
  const actorMinutes = (actors.size * (input.durationMs ?? spanMs(input.events))) / MINUTE_MS;
  return { measured: ratio(bodyActs, actorMinutes), bodyActs, actorMinutes };
}

// ── act-rate ─────────────────────────────────────────────────────────────────

export type SceneActRate = { acts: number; minutes: number; perMinute: number };
export type ActRateReading = {
  /** Acts started per minute in the busiest scene. */
  measured: number;
  worstScene: string | undefined;
  perScene: Record<string, SceneActRate>;
};

/** `act_started` per scene-minute (D6). The busiest scene is the reading: spam in one room is not diluted by a quiet one. */
export function actRate(input: DramaProbeInput): ActRateReading {
  const counts = new Map<string, number>();
  for (const a of actsOf(input.events)) counts.set(sceneOf(a), (counts.get(sceneOf(a)) ?? 0) + 1);
  const perScene: Record<string, SceneActRate> = {};
  let measured = 0;
  let worstScene: string | undefined;
  for (const [scene, acts] of counts) {
    const windowMs = input.durationMs ?? spanMs(input.events.filter((e) => sceneOf(e) === scene));
    const minutes = Math.max(windowMs, MIN_SCENE_MS) / MINUTE_MS;
    const perMinute = acts / minutes;
    perScene[scene] = { acts, minutes, perMinute };
    if (worstScene === undefined || perMinute > measured) {
      measured = perMinute;
      worstScene = scene;
    }
  }
  return { measured, worstScene, perScene };
}

// ── verb-diversity ───────────────────────────────────────────────────────────

export type VerbDiversityReading = { measured: number; judged: boolean; acts: number; distinct: number };

/** Distinct verbs over acts, judged from 5 acts on; below that it reads 1 and `judged` is false. */
export function verbDiversity(input: DramaProbeInput): VerbDiversityReading {
  const acts = actsOf(input.events);
  const distinct = new Set(acts.map((a) => a.verb)).size;
  const judged = acts.length >= MIN_ACTS_FOR_DIVERSITY;
  return { measured: judged ? distinct / acts.length : 1, judged, acts: acts.length, distinct };
}
