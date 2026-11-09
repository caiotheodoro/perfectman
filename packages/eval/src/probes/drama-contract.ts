/**
 * The drama probes the act contract (docs/drama/act-contract.md revision 2) makes checkable, one per rule the
 * hotel promises and a sidecar can verify from the frames alone:
 *
 *  - `owed-missed-empty`           REA-10   every `act_done.owed_missed` is empty
 *  - `blocked-reason-audit`        FRM-2    every blocked or aborted act names a reason from the contract's enums
 *  - `chip-timeout-dodge`          CHIP-3   a chip that timed out ended `dodged` (`timeout` for a hug)
 *  - `human-untouched-without-take` HUM-1, CHIP-6   no physical act touched a human who did not `take`
 *  - `scene-cut-revive`            DEATH-7  a scene cut revives the dead it says it revives, in order
 *  - `down-window-exact`           DOWN-3   a `human_up` follows its `human_down` by `ms`
 *
 * Same shape as the probes in `drama.ts`: a pure reading each, then `runContractProbes` banding them.
 */
import {
  ABORT_REASONS,
  BLOCKED_REASONS,
  rungIndex,
  type DramaEvent,
  type DramaFailureId,
  type HumanDownEvent,
  type HumanUpEvent,
  type OwedDebt,
  type SceneCutEvent,
} from "../drama/index.js";
import { actsOf, clockOf, gapMs, humansOf, ledgerOf, lifelinesOf, type Clock, type DramaProbeInput, type DramaProbeResult, type ResultFn } from "./drama-reads.js";

const SHOVE_RUNG = rungIndex("shove");
/** DEATH-1: a `dying` actor is a `body` this long after `actor_death`; DEATH-7 revives bodies. */
const BODY_AFTER_MS = 2000;
/** TBL-9: the act scheduler runs a step at most 100 ms after its due instant, and the down timer is one of its entries. */
export const DOWN_TOLERANCE_MS = 100;

const noCodes = (): DramaFailureId[] => [];

// ── owed-missed-empty ────────────────────────────────────────────────────────

export type OwedMissedReading = {
  /** Reactions still owed when a window closed, over every `act_done`; the contract says 0 for a table-driven act. */
  measured: number;
  /** Acts that ended (blocked ones included). */
  judged: number;
  offenders: Array<{ actId: string; owedMissed: OwedDebt[] }>;
};

export function owedMissedEmpty(input: DramaProbeInput): OwedMissedReading {
  const offenders: OwedMissedReading["offenders"] = [];
  let judged = 0;
  let measured = 0;
  for (const ledger of ledgerOf(input.events).values()) {
    if (ledger.done === undefined) continue;
    judged += 1;
    const missed = ledger.done.owedMissed ?? [];
    if (missed.length === 0) continue;
    measured += missed.length;
    offenders.push({ actId: ledger.actId, owedMissed: missed });
  }
  return { measured, judged, offenders };
}

// ── blocked-reason-audit ─────────────────────────────────────────────────────

export type BlockedAuditReading = {
  /** Blocked or aborted acts whose reason is missing or not in the contract's enum for that outcome. */
  measured: number;
  blocked: number;
  aborted: number;
  blockedByReason: Record<string, number>;
  abortedByReason: Record<string, number>;
  invalid: Array<{ actId: string; outcome: "blocked" | "aborted"; reason: string | undefined }>;
  /** Blocked acts that nevertheless have an `act_started` (FRM-2 says they have none). Informational. */
  blockedWithStart: string[];
};

export function blockedReasonAudit(input: DramaProbeInput): BlockedAuditReading {
  const blockedByReason: Record<string, number> = {};
  const abortedByReason: Record<string, number> = {};
  const invalid: BlockedAuditReading["invalid"] = [];
  const blockedWithStart: string[] = [];
  let blocked = 0;
  let aborted = 0;
  for (const ledger of ledgerOf(input.events).values()) {
    const done = ledger.done;
    if (done === undefined || (done.outcome !== "blocked" && done.outcome !== "aborted")) continue;
    const known: readonly string[] = done.outcome === "blocked" ? BLOCKED_REASONS : ABORT_REASONS;
    const tally = done.outcome === "blocked" ? blockedByReason : abortedByReason;
    if (done.outcome === "blocked") {
      blocked += 1;
      if (ledger.started !== undefined) blockedWithStart.push(ledger.actId);
    } else aborted += 1;
    const reason = done.reason;
    tally[reason ?? "(none)"] = (tally[reason ?? "(none)"] ?? 0) + 1;
    if (reason === undefined || !known.includes(reason)) invalid.push({ actId: ledger.actId, outcome: done.outcome, reason });
  }
  return { measured: invalid.length, blocked, aborted, blockedByReason, abortedByReason, invalid, blockedWithStart };
}

// ── chip-timeout-dodge ───────────────────────────────────────────────────────

/** CHIP-3 and CHIP-5: what an unanswered chip ends as, by verb. Nothing else has a chip. */
const OUTCOME_AFTER_TIMEOUT: Readonly<Record<string, "dodged" | "timeout">> = {
  shove: "dodged",
  slap: "dodged",
  punch: "dodged",
  kill: "dodged",
  insult: "dodged",
  kiss: "dodged",
  hug: "timeout",
};

export type ChipTimeoutReading = {
  /** Timed-out chips that ended as the contract says, over timed-out chips that ended; 1 when none did. */
  measured: number;
  judged: number;
  compliant: number;
  offenders: Array<{ actId: string; verb: string; expected: "dodged" | "timeout"; outcome: string }>;
  /** Timed-out chips whose act has no `act_done`, or ended `aborted`: nothing to compare. */
  unresolvedActIds: string[];
};

/** The 4000 ms are not checked here: the contract gives the instant (`shown + 4000`) but no tolerance for it. */
export function chipTimeoutDodge(input: DramaProbeInput): ChipTimeoutReading {
  const timedOut = new Set<string>();
  for (const e of input.events) {
    if (e.kind === "consent_chip" && e.phase === "answered" && e.rawAnswer === "timeout" && e.actId !== undefined) timedOut.add(e.actId);
  }
  const ledgers = ledgerOf(input.events);
  for (const ledger of ledgers.values()) if (ledger.done?.answer === "timeout") timedOut.add(ledger.actId);
  const shownVerb = new Map<string, string>();
  for (const e of input.events) if (e.kind === "consent_chip" && e.phase === "shown" && e.actId !== undefined) shownVerb.set(e.actId, e.pairKind);
  const offenders: ChipTimeoutReading["offenders"] = [];
  const unresolvedActIds: string[] = [];
  let judged = 0;
  for (const actId of timedOut) {
    const ledger = ledgers.get(actId);
    const verb = ledger?.started?.verb ?? ledger?.done?.verb ?? shownVerb.get(actId);
    const expected = verb === undefined ? undefined : OUTCOME_AFTER_TIMEOUT[verb];
    if (verb === undefined || expected === undefined) continue;
    const done = ledger?.done;
    if (done === undefined || done.outcome === "aborted") {
      unresolvedActIds.push(actId);
      continue;
    }
    judged += 1;
    if (done.outcome !== expected) offenders.push({ actId, verb, expected, outcome: done.outcome });
  }
  const compliant = judged - offenders.length;
  return { measured: judged === 0 ? 1 : compliant / judged, judged, compliant, offenders, unresolvedActIds };
}

// ── human-untouched-without-take ─────────────────────────────────────────────

export type Touch = "landed" | "contact" | "down";
export type UntouchedReading = {
  /** Physical acts (shove, slap, punch, kill) that touched a human who had not answered `take` for that act. */
  measured: number;
  /** Physical acts aimed at a human. */
  judged: number;
  offenders: Array<{ actId: string; verb: string; human: string; touched: Touch[] }>;
};

/**
 * A human is touched by a physical act only after they `take` it. Touched means the act `landed`, reached its
 * `act_beat` (contact), or put the human `down`. The `take` must be a `drama_consent` for that act_id answered
 * no later than the first of those. Unlike `consent-violation` this does not look at an `insult` (nobody is moved by
 * it), and it catches contact that did not end `landed`.
 */
export function humanUntouchedWithoutTake(input: DramaProbeInput): UntouchedReading {
  const isHuman = humansOf(input);
  const ledgers = ledgerOf(input.events);
  const takes = new Map<string, Array<{ atMs: number; hotelAt?: number }>>();
  const downs = new Map<string, HumanDownEvent>();
  for (const e of input.events) {
    if (e.kind === "consent_chip" && e.phase === "answered" && e.rawAnswer === "take" && e.actId !== undefined) takes.set(e.actId, [...(takes.get(e.actId) ?? []), e]);
    else if (e.kind === "human_down" && e.actId !== undefined && !downs.has(e.actId)) downs.set(e.actId, e);
  }
  const offenders: UntouchedReading["offenders"] = [];
  let judged = 0;
  for (const act of actsOf(input.events)) {
    const human = act.with;
    if (rungIndex(act.verb) < SHOVE_RUNG || human === undefined || !isHuman(human)) continue;
    judged += 1;
    const ledger = ledgers.get(act.actId);
    const touched: Touch[] = [];
    if (ledger?.beat !== undefined) touched.push("contact");
    if (downs.has(act.actId)) touched.push("down");
    if (ledger?.done?.outcome === "landed") touched.push("landed");
    if (touched.length === 0) continue;
    const touchAt = ledger?.beat ?? downs.get(act.actId) ?? ledger?.done;
    const taken = touchAt !== undefined && (takes.get(act.actId) ?? []).some((take) => gapMs(take, touchAt).ms >= 0);
    if (!taken) offenders.push({ actId: act.actId, verb: act.verb, human, touched });
  }
  return { measured: offenders.length, judged, offenders };
}

// ── scene-cut-revive ─────────────────────────────────────────────────────────

export type SceneCutIssue = "revive_missing" | "revive_without_cut" | "revive_of_living" | "body_left_standing";
export type SceneCutReviveReading = {
  /** Contract breaches around scene cuts. */
  measured: number;
  cuts: number;
  revives: number;
  offenders: Array<{ issue: SceneCutIssue; actor: string; scene?: string }>;
};

/**
 * DEATH-7. At a `scene_cut` every actor that was a body (dead for 2 s) is revived (`actor_revive`, after the cut,
 * naming the new scene) or removed (permadeath: listed in `removed`); a revive without its cut, or for an actor that
 * was not dead, is a breach too. Speech after a revive is `dead-speech`'s to leave alone, not this probe's.
 */
export function sceneCutRevive(input: DramaProbeInput): SceneCutReviveReading {
  const lives = lifelinesOf(input.events, humansOf(input));
  const cuts: Array<{ cut: SceneCutEvent; index: number }> = [];
  const revives: Array<{ actor: string; scene?: string; atMs: number; index: number }> = [];
  input.events.forEach((e, index) => {
    if (e.kind === "scene_cut") cuts.push({ cut: e, index });
    else if (e.kind === "actor_revive") revives.push({ actor: e.actor, atMs: e.atMs, index, ...(e.scene !== undefined ? { scene: e.scene } : {}) });
  });
  const offenders: SceneCutReviveReading["offenders"] = [];
  for (const { cut, index } of cuts) {
    const gone = new Set([...cut.revived, ...cut.removed]);
    for (const actor of cut.revived) {
      const came = revives.some((r) => r.actor === actor && r.index > index && (r.scene === undefined || r.scene === cut.scene));
      if (!came) offenders.push({ issue: "revive_missing", actor, scene: cut.scene });
    }
    for (const [actor, spans] of lives.spans) {
      const body = spans.some((s) => s.from < cut.atMs && cut.atMs - s.from >= BODY_AFTER_MS && s.to >= cut.atMs);
      if (body && !gone.has(actor)) offenders.push({ issue: "body_left_standing", actor, scene: cut.scene });
    }
  }
  for (const r of revives) {
    const cut = cuts.find(({ cut: c, index }) => index < r.index && c.revived.includes(r.actor) && (r.scene === undefined || r.scene === c.scene));
    if (cut === undefined) offenders.push({ issue: "revive_without_cut", actor: r.actor, ...(r.scene !== undefined ? { scene: r.scene } : {}) });
    else if (!(lives.spans.get(r.actor) ?? []).some((s) => s.to === r.atMs)) offenders.push({ issue: "revive_of_living", actor: r.actor, scene: cut.cut.scene });
  }
  return { measured: offenders.length, cuts: cuts.length, revives: revives.length, offenders };
}

// ── down-window-exact ────────────────────────────────────────────────────────

export type DownWindowIssue = "off_window" | "never_up";
export type DownWindowReading = {
  /** Down windows that did not end when the contract says: late or early by more than the tolerance, or never. */
  measured: number;
  windows: number;
  /** Windows still open when the run ended, inside their `ms`: not judged. */
  openWindows: number;
  toleranceMs: number;
  /** The largest |actual - ms| over windows that ended by timer, in ms; 0 when none did. */
  worstDeviationMs: number;
  clock: Clock | "mixed" | "none";
  offenders: Array<{ human: string; actId?: string; ms: number; actualMs?: number; issue: DownWindowIssue }>;
};

/**
 * DOWN-3: a killed human stands up exactly `ms` after `human_down`, on a timer that nothing cancels. A `human_up`
 * with reason `timer` must come within `DOWN_TOLERANCE_MS` of that; `left` and `closed` end it early and are fine
 * any time up to `ms`. A window that was never closed, though the run lasted past it, is a human left lying.
 */
export function downWindowExact(input: DramaProbeInput): DownWindowReading {
  const runEnd = input.durationMs !== undefined ? input.durationMs : Math.max(0, ...input.events.map((e) => e.atMs));
  const ups: Array<{ up: HumanUpEvent; index: number }> = [];
  const downs: Array<{ down: HumanDownEvent; index: number }> = [];
  input.events.forEach((e: DramaEvent, index) => {
    if (e.kind === "human_up") ups.push({ up: e, index });
    else if (e.kind === "human_down") downs.push({ down: e, index });
  });
  const used = new Set<number>();
  const offenders: DownWindowReading["offenders"] = [];
  const clocks: Clock[] = [];
  let worst = 0;
  let open = 0;
  for (const { down, index } of downs) {
    const match = ups.find((u) => !used.has(u.index) && u.index > index && u.up.human === down.human && (u.up.actId === undefined || down.actId === undefined || u.up.actId === down.actId));
    const base = { human: down.human, ...(down.actId !== undefined ? { actId: down.actId } : {}), ms: down.ms };
    if (match === undefined) {
      if (runEnd - down.atMs > down.ms + DOWN_TOLERANCE_MS) offenders.push({ ...base, issue: "never_up" });
      else open += 1;
      continue;
    }
    used.add(match.index);
    const gap = gapMs(down, match.up);
    clocks.push(gap.clock);
    if (match.up.reason === "left" || match.up.reason === "closed") {
      if (gap.ms < 0 || gap.ms > down.ms + DOWN_TOLERANCE_MS) offenders.push({ ...base, actualMs: gap.ms, issue: "off_window" });
      continue;
    }
    const deviation = Math.abs(gap.ms - down.ms);
    worst = Math.max(worst, deviation);
    if (deviation > DOWN_TOLERANCE_MS) offenders.push({ ...base, actualMs: gap.ms, issue: "off_window" });
  }
  return { measured: offenders.length, windows: downs.length, openWindows: open, toleranceMs: DOWN_TOLERANCE_MS, worstDeviationMs: worst, clock: clockOf(clocks), offenders };
}

// ── aggregate ────────────────────────────────────────────────────────────────

/** The six contract probes as banded results, in the order above. */
export function runContractProbes(input: DramaProbeInput, result: ResultFn): DramaProbeResult[] {
  const missed = owedMissedEmpty(input);
  const audit = blockedReasonAudit(input);
  const chip = chipTimeoutDodge(input);
  const untouched = humanUntouchedWithoutTake(input);
  const cuts = sceneCutRevive(input);
  const down = downWindowExact(input);
  return [
    result("owed-missed-empty", "Reactions still owed when an act's window closed", missed.measured, { ...missed }, (passed) => (passed ? [] : ["D1"])),
    result("blocked-reason-audit", "Blocked or aborted acts without a reason from the contract's enums", audit.measured, { ...audit }, noCodes),
    result("chip-timeout-dodge", "Timed-out chips that ended as the contract says", chip.measured, { ...chip }, (passed) => (passed ? [] : ["D7"]), chip.judged === 0 ? "no chip timed out" : undefined),
    result("human-untouched-without-take", "Physical acts that touched a human who did not take them", untouched.measured, { ...untouched }, (passed) => (passed ? [] : ["D7"])),
    result("scene-cut-revive", "Scene cuts whose revives break the contract", cuts.measured, { ...cuts }, (passed) => (passed ? [] : ["D4"])),
    result("down-window-exact", "Down windows that did not end when the contract says", down.measured, { ...down }, noCodes, down.windows === 0 ? "no human went down" : undefined),
  ];
}
