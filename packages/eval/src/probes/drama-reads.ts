/**
 * What the drama probes share: the input, the per-act ledger, the two clocks, the scene a thing belongs to and
 * who is dead when. Pure reads over `DramaEvent[]` (see `drama/events.ts`); no band, no verdict.
 */
import {
  rungIndex,
  type ActBeatEvent,
  type ActDoneEvent,
  type ActReactionEvent,
  type ActStartedEvent,
  type DramaEvent,
  type DramaFailureId,
} from "../drama/index.js";
import type { ProbeResult } from "./types.js";

export type DramaProbeInput = {
  /** In time order (as `extractDramaEvents` returns them). */
  events: readonly DramaEvent[];
  /** Actor refs; humans are not judged. */
  actorIds: readonly string[];
  /** Refs of humans, beyond the `h:<id>` names the extractor gives them. */
  humanIds?: readonly string[];
  /** Length of the run in ms. Default: the span of the events. */
  durationMs?: number;
  /**
   * The scene lets a human be the target of an act with no consent chip (`may_target_humans`, act-contract 7.4 HUM-2; the run summary's `drama.humans_targetable` is absent when it is
   * on). An act at a human that started with no chip is then not a consent violation and needs no `take`; one that did show a chip still does. Default false: the chip.
   */
  chiplessHumans?: boolean;
  /** SAFE-4's N (`PERFECTMAN_DRAMA_HARM_MAX`): landed violent acts on humans allowed per room per window. Default 3. */
  harmMax?: number;
  /** SAFE-4's window in ms (`PERFECTMAN_DRAMA_HARM_WINDOW_SECS`). Default 300 000. */
  harmWindowMs?: number;
};

export type DramaProbeResult = ProbeResult & {
  /** The failure codes the evidence points at; empty when nothing went wrong. */
  codes: DramaFailureId[];
  /** The reading behind the verdict: offending act ids, counts. */
  evidence: Record<string, unknown>;
};

/** Wraps a reading in a banded `DramaProbeResult`; `codes` gets whether the band passed. */
export type ResultFn = (
  probe: string,
  label: string,
  measured: number,
  evidence: Record<string, unknown>,
  codes: (passed: boolean) => DramaFailureId[],
  note?: string,
) => DramaProbeResult;

export const ratio = (n: number, d: number): number => (d === 0 ? 0 : n / d);

export const spanMs = (events: readonly DramaEvent[]): number => {
  if (events.length === 0) return 0;
  const times = events.map((e) => e.atMs);
  return Math.max(...times) - Math.min(...times);
};

/** A human is named `h:<id>` by the extractor, or listed in `humanIds`. */
export function humansOf(input: DramaProbeInput): (ref: string) => boolean {
  const named = new Set(input.humanIds);
  return (ref) => ref.startsWith("h:") || named.has(ref);
}

/** Each act once, in the order its start was first logged. A blocked act has no start and is not here. */
export function actsOf(events: readonly DramaEvent[]): ActStartedEvent[] {
  const seen = new Set<string>();
  const acts: ActStartedEvent[] = [];
  for (const e of events) {
    if (e.kind !== "act_started" || seen.has(e.actId)) continue;
    seen.add(e.actId);
    acts.push(e);
  }
  return acts;
}

/** The scene a started act belongs to: its `scene`, else (frames from before the contract) its room. */
export const sceneOf = (e: { scene?: string; room?: string }): string => e.scene ?? e.room ?? "";

// ── the two clocks ───────────────────────────────────────────────────────────

export type Clock = "hotel_at" | "ts_ms";

/** From `a` to `b` in ms on the hotel's own `at` when both carry one, else on the frame log's stamp. */
export function gapMs(a: { atMs: number; hotelAt?: number }, b: { atMs: number; hotelAt?: number }): { ms: number; clock: Clock } {
  return a.hotelAt !== undefined && b.hotelAt !== undefined ? { ms: b.hotelAt - a.hotelAt, clock: "hotel_at" } : { ms: b.atMs - a.atMs, clock: "ts_ms" };
}

/** Which clock a set of readings used, for the evidence: `none` for no readings. */
export function clockOf(clocks: readonly Clock[]): Clock | "mixed" | "none" {
  if (clocks.length === 0) return "none";
  const hotel = clocks.filter((c) => c === "hotel_at").length;
  return hotel === clocks.length ? "hotel_at" : hotel === 0 ? "ts_ms" : "mixed";
}

// ── the per-act ledger ───────────────────────────────────────────────────────

export type ActLedger = {
  actId: string;
  started?: ActStartedEvent;
  /** The first contact; the clock of every deadline. An act that never made contact has none and is not judged for reactions. */
  beat?: ActBeatEvent;
  done?: ActDoneEvent;
  reactions: ActReactionEvent[];
};

/** One ledger per act id, in the order the id was first seen. Blocked acts (a `done` and nothing else) have one too. */
export function ledgerOf(events: readonly DramaEvent[]): Map<string, ActLedger> {
  const ledgers = new Map<string, ActLedger>();
  const of = (actId: string): ActLedger => {
    const known = ledgers.get(actId);
    if (known !== undefined) return known;
    const fresh: ActLedger = { actId, reactions: [] };
    ledgers.set(actId, fresh);
    return fresh;
  };
  for (const e of events) {
    switch (e.kind) {
      case "act_started":
        of(e.actId).started ??= e;
        break;
      case "act_beat":
        of(e.actId).beat ??= e;
        break;
      case "act_done":
        of(e.actId).done ??= e;
        break;
      case "act_reaction":
        of(e.actId).reactions.push(e);
        break;
      default:
        break;
    }
  }
  return ledgers;
}

/** The first reaction `who` gave at or after the beat, with its distance from the beat; a reaction before contact does not count. */
export function firstReactionAfter(ledger: ActLedger, who: string): { ms: number; clock: Clock } | undefined {
  const beat = ledger.beat;
  if (beat === undefined) return undefined;
  let best: { ms: number; clock: Clock } | undefined;
  for (const r of ledger.reactions) {
    if (r.who !== who) continue;
    const gap = gapMs(beat, r);
    if (gap.ms >= 0 && (best === undefined || gap.ms < best.ms)) best = gap;
  }
  return best;
}

// ── who is dead when ─────────────────────────────────────────────────────────

const KILL_RUNG = rungIndex("kill");

export type DeathVia = "death" | "kill";
/** Dead from `from` (exclusive) to `to` (exclusive): speaking at the instant of death, or at the instant of the revive, is allowed. */
export type DeadSpan = { from: number; to: number; via: DeathVia };

export type Lifelines = {
  spans: ReadonlyMap<string, readonly DeadSpan[]>;
  deadAt: (ref: string, atMs: number) => boolean;
};

/**
 * When each actor was dead. An `actor_death` opens a span; a kill act that landed on an actor opens one at its
 * `act_done` when no `actor_death` came with it (an older stream); an `actor_revive` closes it. A killed human
 * is not dead: `human_down` and `human_up` frame the down state, and no span is opened for a human.
 */
export function lifelinesOf(events: readonly DramaEvent[], isHuman: (ref: string) => boolean): Lifelines {
  const ledgers = ledgerOf(events);
  type Mark = { atMs: number; mark: "die" | "revive"; via: DeathVia };
  const marks = new Map<string, Mark[]>();
  const add = (ref: string, mark: Mark): void => {
    if (isHuman(ref)) return;
    marks.set(ref, [...(marks.get(ref) ?? []), mark]);
  };
  for (const e of events) {
    if (e.kind === "actor_death") add(e.actor, { atMs: e.atMs, mark: "die", via: "death" });
    else if (e.kind === "actor_revive") add(e.actor, { atMs: e.atMs, mark: "revive", via: "death" });
  }
  for (const ledger of ledgers.values()) {
    const { started, done } = ledger;
    const verb = started?.verb ?? done?.verb;
    const victim = started?.with ?? done?.with;
    if (verb === undefined || rungIndex(verb) !== KILL_RUNG || victim === undefined || done?.outcome !== "landed") continue;
    const from = started?.atMs ?? done.atMs;
    const explicit = (marks.get(victim) ?? []).some((m) => m.mark === "die" && m.atMs >= from && m.atMs <= done.atMs);
    if (!explicit) add(victim, { atMs: done.atMs, mark: "die", via: "kill" });
  }
  const spans = new Map<string, DeadSpan[]>();
  for (const [ref, list] of marks) {
    const out: DeadSpan[] = [];
    let open: { from: number; via: DeathVia } | undefined;
    for (const m of [...list].sort((a, b) => a.atMs - b.atMs || (a.mark === b.mark ? 0 : a.mark === "die" ? -1 : 1))) {
      if (m.mark === "die" && open === undefined) open = { from: m.atMs, via: m.via };
      else if (m.mark === "revive" && open !== undefined) {
        out.push({ from: open.from, to: m.atMs, via: open.via });
        open = undefined;
      }
    }
    if (open !== undefined) out.push({ from: open.from, to: Infinity, via: open.via });
    spans.set(ref, out);
  }
  return {
    spans,
    deadAt: (ref, atMs) => (spans.get(ref) ?? []).some((s) => s.from < atMs && atMs < s.to),
  };
}

/**
 * Who this very act killed, and when (run-relative ms): the actors an `actor_death` names this act for, else the victim of a
 * kill that landed on an actor, at its `act_done` (an older stream with no death frame). A target's missing reaction is
 * excused by a death only when the act caused it (REA-10 drops a reactor that dies before its step; the table's `die` is
 * the victim's half of the act): a death some other act caused is no excuse.
 */
export function killedByAct(events: readonly DramaEvent[], ledger: ActLedger, isHuman: (ref: string) => boolean): ReadonlyMap<string, number> {
  const died = new Map<string, number>();
  const verb = ledger.started?.verb ?? ledger.done?.verb;
  const victim = ledger.started?.with ?? ledger.done?.with;
  const isKill = verb !== undefined && rungIndex(verb) === KILL_RUNG;
  // A death frame names its act; an older stream's names none, and is read as this act's only when this is a kill on that actor.
  for (const e of events) if (e.kind === "actor_death" && !died.has(e.actor) && (e.actId === ledger.actId || (e.actId === undefined && isKill && e.actor === victim))) died.set(e.actor, e.atMs);
  if (isKill && victim !== undefined && !isHuman(victim) && ledger.done?.outcome === "landed" && !died.has(victim)) died.set(victim, ledger.done.atMs);
  return died;
}
