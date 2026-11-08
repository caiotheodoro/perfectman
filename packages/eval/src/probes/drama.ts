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
import { rungIndex, type ActStartedEvent, type DramaEvent, type DramaFailureId } from "../drama/index.js";
import type { PositionLookup } from "./embodiment.js";
import { checkProbe, PROBE_BANDS, type ProbeResult } from "./types.js";

export type DramaProbeInput = {
  /** In time order (as `extractDramaEvents` returns them). */
  events: readonly DramaEvent[];
  /** Actor refs; humans are not judged. */
  actorIds: readonly string[];
  /** Refs of humans, beyond the `h:<id>` names the extractor gives them. */
  humanIds?: readonly string[];
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
const SHOVE_RUNG = rungIndex("shove");
/** The ladder a scene starts from: calm, one step under the first rung that is a glare. */
const SCENE_START_RUNG = 0;
/** At most one physical beat (shove and above) per scene per this long. */
const BEAT_SPACING_MS = 20_000;
const MAX_KILLS_PER_SCENE = 1;
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

/** A human is named `h:<id>` by the extractor, or listed in `humanIds`. */
function humansOf(input: DramaProbeInput): (ref: string) => boolean {
  const named = new Set(input.humanIds);
  return (ref) => ref.startsWith("h:") || named.has(ref);
}

type Death = { atMs: number; via: "death" | "kill" };

/** When each actor died: by an `actor_death`, or by a kill act that landed on them (at its `act_done`). The earliest wins. */
function deathsOf(events: readonly DramaEvent[], acts: readonly ActStartedEvent[]): Map<string, Death> {
  const died = new Map<string, Death>();
  const mark = (actor: string, death: Death): void => {
    const known = died.get(actor);
    if (known === undefined || death.atMs < known.atMs) died.set(actor, death);
  };
  const victims = new Map<string, string>();
  for (const a of acts) if (rungIndex(a.verb) === KILL_RUNG && a.with !== undefined) victims.set(a.actId, a.with);
  for (const e of events) {
    if (e.kind === "actor_death") mark(e.actor, { atMs: e.atMs, via: "death" });
    else if (e.kind === "act_done" && e.outcome === "landed") {
      const victim = victims.get(e.actId);
      if (victim !== undefined) mark(victim, { atMs: e.atMs, via: "kill" });
    }
  }
  return died;
}

const deadBy = (died: ReadonlyMap<string, Death>, ref: string, atMs: number): boolean => (died.get(ref)?.atMs ?? Infinity) <= atMs;

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
  /** `D1` when a target never reacted. */
  codes: DramaFailureId[];
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
  const died = deathsOf(input.events, acts);
  const isHuman = humansOf(input);
  const targetMs: number[] = [];
  const unreactedActIds: string[] = [];
  const witnessMs: number[] = [];
  const d1ActIds: string[] = [];
  for (const act of acts) {
    const reacted = reactions.get(act.actId) ?? new Map<string, number>();
    const target = act.with;
    if (target !== undefined && reacted.size === 0) d1ActIds.push(act.actId);
    if (target !== undefined && !isHuman(target) && !deadBy(died, target, act.atMs)) {
      const at = reacted.get(target);
      if (at === undefined) {
        unreactedActIds.push(act.actId);
        targetMs.push(UNREACTED_MS);
      } else targetMs.push(at - act.atMs);
    }
    for (const [who, at] of reacted) if (who !== act.actor && who !== target) witnessMs.push(at - act.atMs);
  }
  return {
    codes: unreactedActIds.length > 0 ? ["D1"] : [],
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
  const died = deathsOf(input.events, acts);
  const isHuman = humansOf(input);
  const uncovered: WitnessCoverageReading["uncovered"] = [];
  const unjudgedActIds: string[] = [];
  let judged = 0;
  let covered = 0;
  for (const act of acts) {
    const from = positionOf(act.actor, act.atMs, act.room);
    const owed: string[] = [];
    if (from !== undefined) {
      for (const ref of input.actorIds) {
        if (ref === act.actor || ref === act.with || isHuman(ref) || deadBy(died, ref, act.atMs)) continue;
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

// ── ladder-compliance ────────────────────────────────────────────────────────

export type LadderReason = "rung_skip" | "beat_budget" | "kill_budget";
export type LadderReading = {
  /** Compliant acts over judged acts (acts whose verb is on the ladder); 1 when nothing was judged. */
  measured: number;
  judged: number;
  compliant: number;
  offendingActIds: string[];
  offenders: Array<{ actId: string; reasons: LadderReason[] }>;
  /** `D3` for a skipped rung, `D6` for a breached budget. */
  codes: DramaFailureId[];
};

function codeOfReason(reason: LadderReason): DramaFailureId {
  switch (reason) {
    case "rung_skip":
      return "D3";
    case "beat_budget":
    case "kill_budget":
      return "D6";
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

/**
 * Whether the conflict climbs the escalation ladder in order and inside its budget. Per scene, an act
 * may rise at most one rung over the highest rung seen so far in that scene (a scene starts calm: glare
 * or insult may open it), unless it carries `authoredSkip`. The budget holds regardless of authoring: at
 * most one physical beat (shove and above) per 20 s, and at most one kill, per scene. An act counts when
 * it starts, whatever came of it. An offending act still raises the scene's height, so a single jump is
 * charged once.
 */
export function ladderCompliance(input: DramaProbeInput): LadderReading {
  const acts = actsOf(input.events)
    .map((act, order) => ({ act, order }))
    .sort((x, y) => x.act.atMs - y.act.atMs || x.order - y.order)
    .map((x) => x.act);
  const highest = new Map<string, number>();
  const lastBeat = new Map<string, number>();
  const kills = new Map<string, number>();
  const offenders: LadderReading["offenders"] = [];
  let judged = 0;
  for (const act of acts) {
    const rung = rungIndex(act.verb);
    if (rung < 0) continue;
    judged += 1;
    const scene = sceneOf(act);
    const reasons: LadderReason[] = [];
    if (rung > (highest.get(scene) ?? SCENE_START_RUNG) + 1 && act.authoredSkip !== true) reasons.push("rung_skip");
    highest.set(scene, Math.max(highest.get(scene) ?? SCENE_START_RUNG, rung));
    if (rung >= SHOVE_RUNG) {
      const previous = lastBeat.get(scene);
      if (previous !== undefined && act.atMs - previous < BEAT_SPACING_MS) reasons.push("beat_budget");
      lastBeat.set(scene, act.atMs);
    }
    if (rung === KILL_RUNG) {
      const killsSoFar = (kills.get(scene) ?? 0) + 1;
      kills.set(scene, killsSoFar);
      if (killsSoFar > MAX_KILLS_PER_SCENE) reasons.push("kill_budget");
    }
    if (reasons.length > 0) offenders.push({ actId: act.actId, reasons });
  }
  const codes = [...new Set(offenders.flatMap((o) => o.reasons.map(codeOfReason)))].sort();
  return {
    measured: judged === 0 ? 1 : (judged - offenders.length) / judged,
    judged,
    compliant: judged - offenders.length,
    offendingActIds: offenders.map((o) => o.actId),
    offenders,
    codes,
  };
}

// ── dead-speech ──────────────────────────────────────────────────────────────

export type DeadSpeech = { actor: string; atMs: number; diedAtMs: number; via: "death" | "kill" };
export type DeadSpeechReading = {
  /** Speech events (any mode) by an actor strictly after it died. */
  measured: number;
  offenders: DeadSpeech[];
  /** `D4` when anyone spoke after dying. */
  codes: DramaFailureId[];
};

/** Speech by an actor after its `actor_death`, or after a kill act landed on it (D4). Speaking at the instant of death is allowed. */
export function deadSpeech(input: DramaProbeInput): DeadSpeechReading {
  const died = deathsOf(input.events, actsOf(input.events));
  const offenders: DeadSpeech[] = [];
  for (const e of input.events) {
    if (e.kind !== "speech") continue;
    const death = died.get(e.actor);
    if (death !== undefined && e.atMs > death.atMs) offenders.push({ actor: e.actor, atMs: e.atMs, diedAtMs: death.atMs, via: death.via });
  }
  return { measured: offenders.length, offenders, codes: offenders.length > 0 ? ["D4"] : [] };
}

// ── consent-violation ────────────────────────────────────────────────────────

export type ConsentReading = {
  /** Violent acts that landed on a human without their consent. */
  measured: number;
  offendingActIds: string[];
  /** Violent acts on a human that never finished, so whether they landed is unknown. */
  unresolvedActIds: string[];
  /** `D7` when any act offended. */
  codes: DramaFailureId[];
};

/**
 * A violent act (shove and above) on a human target is a violation when it landed without a consent chip
 * answered `take` for that act (answered by the time the act was done). An act that carries
 * `targetOptIn: false` is a violation even with a chip. Acts that did not land (dodged, blocked, declined,
 * timed out) put nothing on the human and are not flagged.
 */
export function consentViolation(input: DramaProbeInput): ConsentReading {
  const acts = actsOf(input.events);
  const isHuman = humansOf(input);
  const outcomes = new Map<string, { outcome: string; atMs: number }>();
  const takes = new Map<string, number[]>();
  for (const e of input.events) {
    if (e.kind === "act_done") outcomes.set(e.actId, { outcome: e.outcome, atMs: e.atMs });
    else if (e.kind === "consent_chip" && e.phase === "answered" && e.answer === "take" && e.actId !== undefined) takes.set(e.actId, [...(takes.get(e.actId) ?? []), e.atMs]);
  }
  const offendingActIds: string[] = [];
  const unresolvedActIds: string[] = [];
  for (const act of acts) {
    if (rungIndex(act.verb) < SHOVE_RUNG || act.with === undefined || !isHuman(act.with)) continue;
    const done = outcomes.get(act.actId);
    if (done === undefined) {
      unresolvedActIds.push(act.actId);
      continue;
    }
    if (done.outcome !== "landed") continue;
    const consented = (takes.get(act.actId) ?? []).some((at) => at <= done.atMs) && act.targetOptIn !== false;
    if (!consented) offendingActIds.push(act.actId);
  }
  return { measured: offendingActIds.length, offendingActIds, unresolvedActIds, codes: offendingActIds.length > 0 ? ["D7"] : [] };
}

// ── aggregate ────────────────────────────────────────────────────────────────

export type DramaProbeResult = ProbeResult & {
  /** The failure codes the evidence points at; empty when nothing went wrong. */
  codes: DramaFailureId[];
  /** The reading behind the verdict: offending act ids, counts. */
  evidence: Record<string, unknown>;
};

/** Every drama probe as a `ProbeResult` with its evidence. `witness-coverage` needs `positionOf` and is left out without it. */
export function runDramaProbes(input: DramaProbeInput): DramaProbeResult[] {
  const result = (probe: string, label: string, measured: number, evidence: Record<string, unknown>, codes: (passed: boolean) => DramaFailureId[], note?: string): DramaProbeResult => {
    const checked = checkProbe(probe, label, measured, PROBE_BANDS[probe]!, note);
    return { ...checked, codes: codes(checked.passed), evidence };
  };
  const noCodes = (): DramaFailureId[] => [];
  const bodyActs = bodyActRate(input);
  const latency = reactionLatencyP90(input);
  const rate = actRate(input);
  const diversity = verbDiversity(input);
  const ladder = ladderCompliance(input);
  const dead = deadSpeech(input);
  const consent = consentViolation(input);

  const results: DramaProbeResult[] = [
    result("body-act-rate", "Body acts per actor-minute", bodyActs.measured, { ...bodyActs }, noCodes),
    result("act-rate", "Acts started per scene-minute (busiest scene)", rate.measured, { ...rate }, (passed) => (passed ? [] : ["D6"])),
    result("reaction-latency-p90-target", "p90 ms from act to the target's reaction", latency.target.p90, { ...latency }, () => latency.codes),
    result("reaction-latency-p90-witness", "p90 ms from act to witnesses' reactions", latency.witness.p90, { ...latency.witness, d1ActIds: latency.d1ActIds }, noCodes),
  ];
  if (input.positionOf !== undefined) {
    const coverage = witnessCoverage(input);
    results.push(
      result("witness-coverage", "Acts every actor in earshot reacted to", coverage.measured, { ...coverage }, (passed) => (passed ? [] : ["D1"]), coverage.judged === 0 ? "no act had a witness in earshot" : undefined),
    );
  }
  results.push(
    result("verb-diversity", "Distinct verbs over acts", diversity.measured, { ...diversity }, noCodes, diversity.judged ? undefined : `not judged: fewer than ${MIN_ACTS_FOR_DIVERSITY} acts`),
    result("ladder-compliance", "Acts inside the escalation ladder and budget", ladder.measured, { ...ladder }, () => ladder.codes),
    result("dead-speech", "Speech by actors after they died", dead.measured, { ...dead }, () => dead.codes),
    result("consent-violation", "Landed violence on humans without consent", consent.measured, { ...consent }, () => consent.codes),
  );
  return results;
}
