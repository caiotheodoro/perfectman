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
import { SAY_CLEAR_TILES, chebyshev } from "@perfectman/engine";
import { rungIndex, type ActStartedEvent, type DramaEvent } from "../drama/index.js";
import type { PositionLookup } from "./embodiment.js";

export type DramaProbeInput = {
  /** In time order (as `extractDramaEvents` returns them). */
  events: readonly DramaEvent[];
  /** Actor refs; humans are not judged. */
  actorIds: readonly string[];
  /** Length of the run in ms. Default: the span of the events. */
  durationMs?: number;
  /** Where actors stood, for the probes that need earshot (see `positionLookup`). */
  positionOf?: PositionLookup;
};

const MINUTE_MS = 60_000;
/** A scene shorter than this counts as this long, so one act in a quiet scene is not extrapolated to dozens a minute. */
const MIN_SCENE_MS = MINUTE_MS;
const MIN_ACTS_FOR_DIVERSITY = 5;
/** What a target that never reacted counts as in the latency percentile: finite, so it survives JSON, and far past any band. */
export const UNREACTED_MS = 1e9;
const KILL_RUNG = rungIndex("kill");
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

// ── shared reads ─────────────────────────────────────────────────────────────

/** A human is named `h:<id>` by the extractor. */
const isHuman = (ref: string): boolean => ref.startsWith("h:");

/** When each actor died: by an `actor_death`, or by a kill act that landed on them (at its `act_done`). The earliest wins. */
function deathTimes(events: readonly DramaEvent[], acts: readonly ActStartedEvent[]): Map<string, number> {
  const died = new Map<string, number>();
  const mark = (actor: string, atMs: number): void => {
    const known = died.get(actor);
    if (known === undefined || atMs < known) died.set(actor, atMs);
  };
  const kills = new Map(acts.filter((a) => rungIndex(a.verb) === KILL_RUNG && a.with !== undefined).map((a) => [a.actId, a.with!]));
  for (const e of events) {
    if (e.kind === "actor_death") mark(e.actor, e.atMs);
    else if (e.kind === "act_done" && e.outcome === "landed" && kills.has(e.actId)) mark(kills.get(e.actId)!, e.atMs);
  }
  return died;
}

/** For each act, the first moment each reactor reacted at or after the act began. */
function reactionsByAct(events: readonly DramaEvent[], acts: readonly ActStartedEvent[]): Map<string, Map<string, number>> {
  const startOf = new Map(acts.map((a) => [a.actId, a.atMs]));
  const byAct = new Map<string, Map<string, number>>();
  for (const e of events) {
    if (e.kind !== "act_reaction") continue;
    const start = startOf.get(e.actId);
    if (start === undefined || e.atMs < start) continue;
    const who = byAct.get(e.actId) ?? new Map<string, number>();
    const first = who.get(e.who);
    if (first === undefined || e.atMs < first) who.set(e.who, e.atMs);
    byAct.set(e.actId, who);
  }
  return byAct;
}

/** Nearest-rank 90th percentile; 0 for no samples. */
function p90(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((9 * sorted.length) / 10) - 1]!;
}

// ── reaction-latency-p90 ─────────────────────────────────────────────────────

export type TargetLatency = { p90: number; samples: number; unreactedActIds: string[] };
export type WitnessLatency = { p90: number; samples: number };
export type ReactionLatencyReading = {
  /** From `act_started` to the target's first reaction. A target that never reacted counts as `UNREACTED_MS`. */
  target: TargetLatency;
  /** From `act_started` to each reacting witness's first reaction (who never reacted is `witness-coverage`'s to name). */
  witness: WitnessLatency;
  /** Acts that had a target and drew no reaction from anyone (D1). */
  d1ActIds: string[];
};

/**
 * How long a physical act takes to be reacted to: the target's p90 must be within 1500 ms, the witnesses'
 * within 3000 ms. Acts with no target, a human target (humans do not emit reactions) or a target that was
 * already dead are not judged for the target side.
 */
export function reactionLatencyP90(input: DramaProbeInput): ReactionLatencyReading {
  const acts = actsOf(input.events);
  const reactions = reactionsByAct(input.events, acts);
  const died = deathTimes(input.events, acts);
  const targetMs: number[] = [];
  const unreactedActIds: string[] = [];
  const witnessMs: number[] = [];
  const d1ActIds: string[] = [];
  for (const act of acts) {
    const reacted = reactions.get(act.actId) ?? new Map<string, number>();
    const target = act.with;
    if (target !== undefined && reacted.size === 0) d1ActIds.push(act.actId);
    if (target !== undefined && !isHuman(target) && !((died.get(target) ?? Infinity) <= act.atMs)) {
      const at = reacted.get(target);
      if (at === undefined) {
        unreactedActIds.push(act.actId);
        targetMs.push(UNREACTED_MS);
      } else targetMs.push(at - act.atMs);
    }
    for (const [who, at] of reacted) if (who !== act.actor && who !== target) witnessMs.push(at - act.atMs);
  }
  return {
    target: { p90: p90(targetMs), samples: targetMs.length, unreactedActIds },
    witness: { p90: p90(witnessMs), samples: witnessMs.length },
    d1ActIds,
  };
}

// ── witness-coverage ─────────────────────────────────────────────────────────

export type WitnessCoverageReading = {
  /** Judged acts where everyone owed a reaction gave one, over judged acts; 1 when nothing was judged. */
  measured: number;
  judged: number;
  covered: number;
  uncovered: Array<{ actId: string; missing: string[] }>;
  /** Acts with nobody owing a reaction, or whose actor's position is unknown. */
  unjudgedActIds: string[];
  /** Why nothing was judged, when the reason is missing input rather than a quiet scene. */
  skipped?: string;
};

/**
 * Fraction of acts where every actor within earshot (`SAY_CLEAR_TILES`, in the actor's room, at the act's
 * instant) produced an `act_reaction`. The actor, the target, the dead and the humans owe none; an actor whose
 * position is unknown is not asked.
 */
export function witnessCoverage(input: DramaProbeInput): WitnessCoverageReading {
  const { positionOf } = input;
  const acts = actsOf(input.events);
  if (positionOf === undefined) return { measured: 1, judged: 0, covered: 0, uncovered: [], unjudgedActIds: [], skipped: "no positions" };
  const reactions = reactionsByAct(input.events, acts);
  const died = deathTimes(input.events, acts);
  const uncovered: WitnessCoverageReading["uncovered"] = [];
  const unjudgedActIds: string[] = [];
  let judged = 0;
  let covered = 0;
  for (const act of acts) {
    const from = positionOf(act.actor, act.atMs, act.room);
    const owed: string[] = [];
    if (from !== undefined) {
      for (const ref of input.actorIds) {
        if (ref === act.actor || ref === act.with || isHuman(ref) || (died.get(ref) ?? Infinity) <= act.atMs) continue;
        const at = positionOf(ref, act.atMs, act.room);
        if (at !== undefined && at.room === from.room && chebyshev(from.tile, at.tile) <= SAY_CLEAR_TILES) owed.push(ref);
      }
    }
    if (owed.length === 0) {
      unjudgedActIds.push(act.actId);
      continue;
    }
    judged += 1;
    const reacted = reactions.get(act.actId) ?? new Map<string, number>();
    const missing = owed.filter((ref) => !reacted.has(ref));
    if (missing.length === 0) covered += 1;
    else uncovered.push({ actId: act.actId, missing });
  }
  return { measured: judged === 0 ? 1 : covered / judged, judged, covered, uncovered, unjudgedActIds };
}
