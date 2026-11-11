/**
 * Drama probes: deterministic checks over `DramaEvent[]` (see `drama/events.ts`), no LLM.
 *
 * Each probe is a pure function of a `DramaProbeInput` and returns its measured value plus the
 * evidence behind it (offending act ids, counts), so a human or a judge can trace a verdict to
 * events. Bands live in `PROBE_BANDS` (calibration-pending seeds, like every band there) and
 * `runDramaProbes` wraps the readings in the same `ProbeResult` shape the other probes use.
 *
 * Time is run-relative milliseconds, as `DramaEvent.atMs` is. A scene is the contract's `scene`
 * (`<run>.<n>`), not a room: the ladder, the 20 s spacing and the kill budget reset at a scene cut.
 * Reaction deadlines run from the contact (`act_beat`) and what is owed is `act_beat.owed`, never
 * inferred from the verb or the target; a probe prefers the hotel's own `at` and falls back to the
 * frame log's stamp, and says which in its evidence.
 */
import { rungIndex, type ActStartedEvent, type DramaEvent, type DramaFailureId } from "../drama/index.js";
import { runContractProbes } from "./drama-contract.js";
import {
  actsOf,
  clockOf,
  firstReactionAfter,
  gapMs,
  humansOf,
  killedByAct,
  ledgerOf,
  lifelinesOf,
  ratio,
  sceneOf,
  spanMs,
  type Clock,
  type DramaProbeInput,
  type DramaProbeResult,
  type ResultFn,
} from "./drama-reads.js";
import { checkProbe, PROBE_BANDS } from "./types.js";

export type { DramaProbeInput, DramaProbeResult } from "./drama-reads.js";

const MINUTE_MS = 60_000;
/** A scene shorter than this counts as this long, so one act in a quiet scene is not extrapolated to dozens a minute. */
const MIN_SCENE_MS = MINUTE_MS;
const MIN_ACTS_FOR_DIVERSITY = 5;
/** What a target that never reacted counts as in the latency percentile: finite, so it survives JSON, and far past any band. */
export const UNREACTED_MS = 1e9;
/** REA-1: how long after contact a target, and a witness, may take to react. */
const TARGET_DEADLINE_MS = 1500;
const WITNESS_DEADLINE_MS = 3000;
const KILL_RUNG = rungIndex("kill");
const SHOVE_RUNG = rungIndex("shove");
const INSULT_VERB = "insult";
/** The ladder a scene starts from: calm, one step under the first rung that is a glare. */
const SCENE_START_RUNG = 0;
/** At most one physical beat (shove and above) per scene per this long. */
const BEAT_SPACING_MS = 20_000;
const MAX_KILLS_PER_SCENE = 1;
/** Gestures that are the body at rest, not a body act (the baseline leaves them out too). */
const REST_GESTURES = new Set(["stand", "idle", "stop"]);

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
  /** Acts left out of the rate because they paid a reaction another act owed. */
  reactionActs: number;
};

/** Longest an owed reaction's `act_started` may sit before its `act_reaction` row (the planner logs both in the same tick). */
const REACTION_ACT_WINDOW_MS = 500;

/**
 * Acts that are a reaction the contract owes: an actor starts an act and, at the same moment, an `act_reaction` of
 * `cmd:act` is logged for that actor against a different act. They are mandatory (D1), so they are not spam (D6).
 */
function reactionActIds(acts: readonly ActStartedEvent[], events: readonly DramaEvent[]): Set<string> {
  const reactions = events.filter((e) => e.kind === "act_reaction" && e.reaction.startsWith("cmd:act"));
  const owed = new Set<string>();
  for (const a of acts) {
    const paid = reactions.some(
      (r) => r.kind === "act_reaction" && r.who === a.actor && r.actId !== a.actId && sceneOf(r) === sceneOf(a) && r.atMs >= a.atMs && r.atMs - a.atMs <= REACTION_ACT_WINDOW_MS,
    );
    if (paid) owed.add(a.actId);
  }
  return owed;
}

/**
 * `act_started` per scene-minute (D6). The busiest scene is the reading: spam in one scene is not diluted by a quiet one.
 * A blocked act has no `act_started` and is not an act here (FRM-2); an aborted one started and counts. An act that pays
 * a reaction another act owed is not counted (`reactionActs` in the evidence): D1 demands it, so D6 cannot also punish it.
 */
export function actRate(input: DramaProbeInput): ActRateReading {
  const acts = actsOf(input.events);
  const owed = reactionActIds(acts, input.events);
  const sceneOfAct = new Map(acts.map((a) => [a.actId, sceneOf(a)]));
  const sceneOfEvent = (e: DramaEvent): string => ("actId" in e && e.actId !== undefined ? sceneOfAct.get(e.actId) : undefined) ?? sceneOf(e);
  const counts = new Map<string, number>();
  for (const a of acts) if (!owed.has(a.actId)) counts.set(sceneOf(a), (counts.get(sceneOf(a)) ?? 0) + 1);
  const perScene: Record<string, SceneActRate> = {};
  let measured = 0;
  let worstScene: string | undefined;
  for (const [scene, n] of counts) {
    const windowMs = input.durationMs ?? spanMs(input.events.filter((e) => sceneOfEvent(e) === scene));
    const minutes = Math.max(windowMs, MIN_SCENE_MS) / MINUTE_MS;
    const perMinute = n / minutes;
    perScene[scene] = { acts: n, minutes, perMinute };
    if (worstScene === undefined || perMinute > measured) {
      measured = perMinute;
      worstScene = scene;
    }
  }
  return { measured, worstScene, perScene, reactionActs: owed.size };
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
  /** From `act_beat` to the first reaction of each target `act_beat.owed` lists. A target that never reacted counts as `UNREACTED_MS`. */
  target: TargetLatency;
  /** From `act_beat` to the first reaction of each owed witness that reacted (who never reacted is `witness-coverage`'s to name). */
  witness: WitnessLatency;
  /** Acts with a contact beat that owed someone a reaction and drew one from nobody (D1). */
  d1ActIds: string[];
  /** Acts judged: those with an `act_beat`. An aborted or blocked act has none and is not judged. */
  judged: number;
  /** Which clock the latencies are on: the hotel's `at`, the frame log's `ts_ms`, or both (`mixed`). */
  clock: Clock | "mixed" | "none";
  /** Reactions that came before the contact, which owe nothing and count for nothing (REA-7). */
  beforeContact: Array<{ actId: string; who: string }>;
};

/**
 * How long a physical act takes to be reacted to, from its contact: the target's p90 must be within 1500 ms,
 * the witnesses' within 3000 ms. Only acts with an `act_beat` are judged, and only the actors `act_beat.owed`
 * lists owe anything: a human target, a solo verb's absent target and a witness that was lying, dead or busy
 * are never asked. A target that died before its deadline is dropped from the ledger by the hotel (REA-10) and here.
 */
export function reactionLatencyP90(input: DramaProbeInput): ReactionLatencyReading {
  const isHuman = humansOf(input);
  const targetMs: number[] = [];
  const witnessMs: number[] = [];
  const unreactedActIds: string[] = [];
  const d1ActIds: string[] = [];
  const beforeContact: ReactionLatencyReading["beforeContact"] = [];
  const clocks: Clock[] = [];
  let judged = 0;
  for (const ledger of ledgerOf(input.events).values()) {
    const beat = ledger.beat;
    if (beat === undefined) continue;
    judged += 1;
    let anyReacted = false;
    for (const debt of beat.owed) {
      const reacted = firstReactionAfter(ledger, debt.who);
      const early = ledger.reactions.some((r) => r.who === debt.who && gapMs(beat, r).ms < 0);
      if (early) beforeContact.push({ actId: ledger.actId, who: debt.who });
      if (reacted !== undefined) {
        anyReacted = true;
        clocks.push(reacted.clock);
        (debt.role === "target" ? targetMs : witnessMs).push(reacted.ms);
      } else if (debt.role === "target" && !((killedByAct(input.events, ledger, isHuman).get(debt.who) ?? Infinity) <= beat.atMs + TARGET_DEADLINE_MS)) {
        unreactedActIds.push(ledger.actId);
        targetMs.push(UNREACTED_MS);
      }
    }
    if (beat.owed.length > 0 && !anyReacted) d1ActIds.push(ledger.actId);
  }
  return {
    codes: unreactedActIds.length > 0 ? ["D1"] : [],
    target: { p90: p90(targetMs), samples: targetMs.length, unreactedActIds },
    witness: { p90: p90(witnessMs), samples: witnessMs.length },
    d1ActIds,
    judged,
    clock: clockOf(clocks),
    beforeContact,
  };
}

// ── witness-coverage ─────────────────────────────────────────────────────────

export type WitnessCoverageReading = {
  /** Judged acts where every owed witness gave a reaction, over judged acts; 1 when nothing was judged. */
  measured: number;
  judged: number;
  covered: number;
  uncovered: Array<{ actId: string; missing: string[] }>;
  /** Acts that owed no witness a reaction, or never made contact. */
  unjudgedActIds: string[];
};

/**
 * Fraction of acts where every witness `act_beat.owed` lists gave an `act_reaction` (a table step and a planner
 * command both count). Nobody is asked who was not listed: the principals, humans, the dead, a witness out of earshot
 * or lying down. An owed witness that died before its deadline was dropped from the hotel's ledger and is dropped here.
 */
export function witnessCoverage(input: DramaProbeInput): WitnessCoverageReading {
  const lives = lifelinesOf(input.events, humansOf(input));
  const uncovered: WitnessCoverageReading["uncovered"] = [];
  const unjudgedActIds: string[] = [];
  let judged = 0;
  let covered = 0;
  for (const ledger of ledgerOf(input.events).values()) {
    const { beat, started } = ledger;
    if (beat === undefined) {
      if (started !== undefined) unjudgedActIds.push(ledger.actId);
      continue;
    }
    const owed = beat.owed.filter((d) => d.role === "witness" && !lives.deadAt(d.who, beat.atMs + WITNESS_DEADLINE_MS)).map((d) => d.who);
    if (owed.length === 0) {
      unjudgedActIds.push(ledger.actId);
      continue;
    }
    judged += 1;
    const missing = owed.filter((who) => firstReactionAfter(ledger, who) === undefined);
    if (missing.length === 0) covered += 1;
    else uncovered.push({ actId: ledger.actId, missing });
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
 * Whether the conflict climbs the escalation ladder in order and inside its budget. Per scene (the contract's
 * `scene`, which a scene cut renews), an act may rise at most one rung over the highest rung seen so far in that
 * scene (a scene starts calm: glare or insult may open it), unless it carries `authoredSkip`. The budget holds
 * regardless of authoring: at most one physical beat (shove and above) per 20 s, and at most one kill, per scene.
 * An act counts when it starts, whatever came of it (an aborted act counts, a blocked one never started). An
 * offending act still raises the scene's height, so a single jump is charged once.
 */
export function ladderCompliance(input: DramaProbeInput): LadderReading {
  const acts = actsOf(input.events)
    .map((act, order) => ({ act, order }))
    .sort((x, y) => x.act.atMs - y.act.atMs || x.order - y.order)
    .map((x) => x.act);
  const highest = new Map<string, number>();
  const lastBeat = new Map<string, ActStartedEvent>();
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
      if (previous !== undefined && gapMs(previous, act).ms < BEAT_SPACING_MS) reasons.push("beat_budget");
      lastBeat.set(scene, act);
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
  /** Speech events (any mode) by an actor strictly after it died and before it was revived. */
  measured: number;
  offenders: DeadSpeech[];
  /** `D4` when anyone spoke after dying. */
  codes: DramaFailureId[];
};

/**
 * Speech by an actor after its `actor_death` (or after a kill act landed on it) and until its `actor_revive` (D4).
 * Speaking at the instant of death, or from the instant of the revive, is allowed. A human is never dead: a killed
 * human is `human_down`, and chat is allowed while down.
 */
export function deadSpeech(input: DramaProbeInput): DeadSpeechReading {
  const lives = lifelinesOf(input.events, humansOf(input));
  const offenders: DeadSpeech[] = [];
  for (const e of input.events) {
    if (e.kind !== "speech") continue;
    const span = (lives.spans.get(e.actor) ?? []).find((s) => s.from < e.atMs && e.atMs < s.to);
    if (span !== undefined) offenders.push({ actor: e.actor, atMs: e.atMs, diedAtMs: span.from, via: span.via });
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
 * A violent act (shove and above, and an `insult` aimed at a human) on a human target is a violation when it
 * landed without a `drama_consent` answered `take` for that act_id (answered by the time the act was done). An act
 * that carries `targetOptIn: false` is a violation even with a chip. Acts that did not land (dodged, blocked,
 * declined, timed out, aborted) put nothing on the human and are not flagged; a `hug` that ended `timeout` is a
 * completed, non-violent act.
 */
export function consentViolation(input: DramaProbeInput): ConsentReading {
  const isHuman = humansOf(input);
  const takes = new Map<string, number[]>();
  for (const e of input.events) {
    if (e.kind === "consent_chip" && e.phase === "answered" && e.answer === "take" && e.actId !== undefined) takes.set(e.actId, [...(takes.get(e.actId) ?? []), e.atMs]);
  }
  const ledgers = ledgerOf(input.events);
  const offendingActIds: string[] = [];
  const unresolvedActIds: string[] = [];
  for (const act of actsOf(input.events)) {
    const violent = rungIndex(act.verb) >= SHOVE_RUNG || act.verb === INSULT_VERB;
    if (!violent || act.with === undefined || !isHuman(act.with)) continue;
    // A scene that lets a human be struck with no chip (HUM-2): an act that started with none asked for no consent.
    if (input.chiplessHumans === true && act.chip === false) continue;
    const done = ledgers.get(act.actId)?.done;
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

/** Every drama probe as a `ProbeResult` with its evidence. */
export function runDramaProbes(input: DramaProbeInput): DramaProbeResult[] {
  const result: ResultFn = (probe, label, measured, evidence, codes, note) => {
    const checked = checkProbe(probe, label, measured, PROBE_BANDS[probe]!, note);
    return { ...checked, codes: codes(checked.passed), evidence };
  };
  const noCodes = (): DramaFailureId[] => [];
  const bodyActs = bodyActRate(input);
  const latency = reactionLatencyP90(input);
  const coverage = witnessCoverage(input);
  const rate = actRate(input);
  const diversity = verbDiversity(input);
  const ladder = ladderCompliance(input);
  const dead = deadSpeech(input);
  const consent = consentViolation(input);

  return [
    result("body-act-rate", "Body acts per actor-minute", bodyActs.measured, { ...bodyActs }, noCodes),
    result("act-rate", "Acts started per scene-minute (busiest scene)", rate.measured, { ...rate }, (passed) => (passed ? [] : ["D6"])),
    result("reaction-latency-p90-target", "p90 ms from contact to the target's reaction", latency.target.p90, { ...latency }, () => latency.codes),
    result("reaction-latency-p90-witness", "p90 ms from contact to witnesses' reactions", latency.witness.p90, { ...latency.witness, clock: latency.clock, d1ActIds: latency.d1ActIds }, noCodes),
    result("witness-coverage", "Acts every owed witness reacted to", coverage.measured, { ...coverage }, (passed) => (passed ? [] : ["D1"]), coverage.judged === 0 ? "no act owed a witness a reaction" : undefined),
    result("verb-diversity", "Distinct verbs over acts", diversity.measured, { ...diversity }, noCodes, diversity.judged ? undefined : `not judged: fewer than ${MIN_ACTS_FOR_DIVERSITY} acts`),
    result("ladder-compliance", "Acts inside the escalation ladder and budget", ladder.measured, { ...ladder }, () => ladder.codes),
    result("dead-speech", "Speech by actors after they died", dead.measured, { ...dead }, () => dead.codes),
    result("consent-violation", "Landed violence on humans without consent", consent.measured, { ...consent }, () => consent.codes),
    ...runContractProbes(input, result),
  ];
}
